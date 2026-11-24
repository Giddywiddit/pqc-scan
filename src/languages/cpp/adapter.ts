import { Query } from 'web-tree-sitter';
import type { Node, Parser } from 'web-tree-sitter';
import type { LanguageAdapter } from '../../core/language.ts';
import { LineReporter } from '../../core/matcher.ts';
import { argumentsOf, escape, hasAncestor, segments, unreadableBytes, unreadableFindings } from '../../core/syntax.ts';
import { createParser } from '../../core/tree-sitter.ts';
import type { Finding, ModuleRules, Rule } from '../../core/types.ts';
import { type CLookup, callFindings, cLookupFor, grammar as cGrammar, loadC, passes, scanCTree } from '../c/api.ts';

let parser: Parser | undefined;
let query: Query | undefined;
let cxxOnly: Query | undefined;

/** One C++ rule file: the names in its namespace (`module: [CryptoPP]`), relative to that namespace. */
interface NamespaceRules {
  functions: Map<string, Rule>;
  types: Map<string, Rule>;
  /** A qualified use such as `CryptoPP::SHA256`, for the parse-error check. */
  used: RegExp;
}

interface CppLookup {
  c: CLookup | null;
  namespaces: Map<string, NamespaceRules>;
  /** A known C function or a rule namespace anywhere in the text. A file without one cannot produce a finding. */
  mentioned: RegExp | null;
}

const lookups = new WeakMap<ModuleRules[], CppLookup>();

function lookupFor(rules: ModuleRules[]): CppLookup {
  if (lookups.has(rules)) return lookups.get(rules)!;
  const c = cLookupFor(rules.filter((group) => group.language === 'c'));
  const namespaces = new Map<string, NamespaceRules>();
  for (const group of rules.filter((item) => item.language === 'cpp')) {
    const functions = new Map<string, Rule>();
    const types = new Map<string, Rule>();
    for (const rule of group.rules) {
      for (const name of rule.functions) if (!functions.has(name)) functions.set(name, rule);
      for (const name of rule.names ?? []) if (!types.has(name)) types.set(name, rule);
    }
    const names = [...functions.keys(), ...types.keys()].map(escape).join('|');
    namespaces.set(group.module[0], { functions, types, used: new RegExp(`\\b(${escape(group.module[0])}::(?:\\w+::)*?(?:${names}))\\b`) });
  }
  const words = [...(c ? c.byFunction.keys() : []), ...namespaces.keys()];
  const lookup = { c, namespaces, mentioned: words.length > 0 ? new RegExp(`\\b(${words.map(escape).join('|')})\\b`) : null };
  lookups.set(rules, lookup);
  return lookup;
}

/**
 * Blanks an export macro between `class` or `struct` and the class name (`class BOTAN_PUBLIC_API(3, 6) RSA_PublicKey`,
 * `class CRYPTOPP_DLL SHA256`), which the grammar cannot tell apart from the name. Spaces of the same length keep every
 * position in the file unchanged.
 */
export function blankExportMacros(source: string): string {
  return source.replace(/\b(class|struct)(\s+)([A-Z][A-Z0-9_]*[A-Z0-9])(\s*\([^()\n]*\))?(?=\s+[A-Za-z_])/g,
    (_match, keyword: string, space: string, name: string, args = '') => keyword + space + ' '.repeat(name.length + args.length));
}

/** The namespaces a file brings into scope with `using namespace`, `using X::Y` and `namespace a = X`. */
interface Scope {
  aliases: Map<string, string[]>;
  usingNamespaces: string[][];
  usingNames: Map<string, string[]>;
}

function scopeOf(captures: { name: string; node: Node }[]): Scope {
  const scope: Scope = { aliases: new Map(), usingNamespaces: [], usingNames: new Map() };
  const expand = (path: string[]) => (scope.aliases.has(path[0]) ? [...scope.aliases.get(path[0])!, ...path.slice(1)] : path);
  for (const { name, node } of captures) {
    if (name === 'alias') {
      const match = /namespace\s+(\w+)\s*=\s*([\w:\s]+);/.exec(node.text);
      if (match) scope.aliases.set(match[1], expand(segments(match[2])));
    } else if (name === 'using') {
      const match = /^using\s+(namespace\s+)?([\w:\s]+);/.exec(node.text);
      if (!match) continue;
      const path = expand(segments(match[2]));
      if (match[1]) scope.usingNamespaces.push(path);
      else scope.usingNames.set(path[path.length - 1], path);
    }
  }
  return scope;
}

function scanCppTree(root: Node, lookup: CppLookup, file: string, where: string, findings: Finding[], reportedLines: Set<number>): void {
  const captures = query!.captures(root);
  const scope = scopeOf(captures);
  const expand = (path: string[]) => (scope.aliases.has(path[0]) ? [...scope.aliases.get(path[0])!, ...path.slice(1)] : path);
  const reporter = new LineReporter(file, findings, reportedLines);
  const errorRegions: Node[] = [];

  /** Reports `rule` at `node`. `args` is given for a call: the argument nodes the algorithm may be read from. */
  const report = (rule: Rule, node: Node, note: string, args?: Node[]): void => {
    const line = node.startPosition.row + 1;
    if (args) reporter.call(rule, line, callFindings(args, line, rule, note, file, where));
    else reporter.name(rule, line, `matched ${note}${where}`);
  };

  /** A C library function called as `name(...)`, `::name(...)` or inside a rule namespace (`Botan::Sodium::name`). */
  const matchC = (name: string, node: Node, args: Node[]): boolean => {
    const match = lookup.c?.byFunction.get(name);
    if (match) report(match.rule, node, `${match.library} function ${name}`, args);
    return Boolean(match);
  };

  /** Matches `rest`, a name inside namespace `namespace`, as a function (when called) or else as a type. */
  const match = (namespace: string, rest: string[], node: Node, args?: Node[]): boolean => {
    const rules = lookup.namespaces.get(namespace);
    if (!rules || rest.length === 0) return false;
    const fn = args && rules.functions.get(rest.join('::'));
    if (fn) {
      report(fn, node, `${namespace} function ${rest.join('::')}`, args);
      return true;
    }
    for (let start = 0; start < rest.length; start++) {
      for (const length of [2, 1]) {
        const name = rest.slice(start, start + length).join('::');
        const rule = rest.length - start >= length ? rules.types.get(name) : undefined;
        if (rule) {
          report(rule, node, `${namespace} type ${name}`);
          return true;
        }
      }
    }
    return Boolean(args && rest.length > 1 && matchC(rest[rest.length - 1], node, args));
  };

  /** A name written with a namespace (`CryptoPP::SHA256`), or without one where `using` allows it. */
  const matchPath = (path: string[], node: Node, args?: Node[]): boolean => {
    if (args && path.length === 1 && matchC(path[0], node, args)) return true;
    const used = path.length === 1 ? scope.usingNames.get(path[0]) : undefined;
    if (used && match(used[0], used.slice(1), node, args)) return true;
    const full = expand(path);
    if (match(full[0], full.slice(1), node, args)) return true;
    return scope.usingNamespaces.some((prefix) => match(prefix[0], [...prefix.slice(1), ...full], node, args));
  };

  // C++'s "most vexing parse": `Wrapper w(EVP_PKEY_CTX_new_id(EVP_PKEY_DH, NULL));` is read as declaring a function
  // `w` whose parameter has a type named EVP_PKEY_CTX_new_id. Inside a function body that is almost always an object
  // built from a call, so such a "parameter" is matched as a call, with its own "parameters" as the arguments.
  const vexingArguments = (node: Node): Node[] | undefined => {
    const parameter = node.parent;
    if (parameter?.type !== 'parameter_declaration' || !parameter.childForFieldName('type')?.equals(node)) return undefined;
    const declarator = parameter.childForFieldName('declarator');
    if (declarator?.type !== 'abstract_function_declarator' || !hasAncestor(node, 'compound_statement')) return undefined;
    return (declarator.childForFieldName('parameters')?.namedChildren ?? []).map((item) => item.childForFieldName('type') ?? item);
  };

  for (const { name, node } of captures) {
    if (name === 'error') {
      errorRegions.push(node);
    } else if (name === 'callee') {
      matchPath([node.text], node, argumentsOf(node.parent!));
    } else if (name === 'qualified') {
      // Only the outermost part of `A::B::C` is matched, and `using` lines only bring names into scope.
      const parent = node.parent;
      if (!parent || parent.type === 'qualified_identifier' || parent.type === 'using_declaration') continue;
      const call = parent.type === 'call_expression' && parent.childForFieldName('function')?.equals(node) ? parent : undefined;
      matchPath(segments(node.text), node, call ? argumentsOf(call) : vexingArguments(node));
    } else if (name === 'type') {
      const parent = node.parent;
      if (!parent || parent.type === 'qualified_identifier' || (parent.type === 'template_type' && parent.parent?.type === 'qualified_identifier')) continue;
      if (['class_specifier', 'struct_specifier', 'alias_declaration', 'type_definition'].includes(parent.type) && parent.childForFieldName('name')?.equals(node)) continue;
      const args = vexingArguments(node);
      // A C function seen through the vexing parse, or a type without a namespace (`SHA256 h;`), which counts only
      // where `using` brings a rule namespace into scope.
      if (args) matchPath([node.text], node, args);
      else if (scope.usingNames.has(node.text) || scope.usingNamespaces.length > 0) matchPath([node.text], node);
    }
  }

  const patterns: [RegExp, string][] = [...(lookup.c ? [[lookup.c.called, 'a call to'] as [RegExp, string]] : []), ...[...lookup.namespaces.values()].map((rules) => [rules.used, 'a use of'] as [RegExp, string])];
  findings.push(...unreadableFindings(errorRegions, patterns, file, where, reportedLines));
}

/** Whether a C++ parse found code only C++ has, outside the parts it could not read. */
function looksLikeCpp(root: Node): boolean {
  return cxxOnly!.captures(root).some(({ node }) => !hasAncestor(node, 'ERROR'));
}

function scanSource(text: string, file: string, rules: ModuleRules[]): Finding[] {
  if (!parser || !query) throw new Error('The C++ grammar is not loaded: call loadLanguages() before scanning.');
  const lookup = lookupFor(rules);
  // Every finding needs a known C function or a rule namespace in the text, so a file without one is not parsed.
  if (!lookup.mentioned || !lookup.mentioned.test(text)) return [];
  const findings: Finding[] = [];
  const reportedLines = new Set<number>();
  for (const { source, where } of passes(text)) {
    const tree = parser.parse(blankExportMacros(source));
    if (!tree) throw new Error(`${file}: the C++ parser returned no tree.`);
    // A `.h` file may hold C or C++. If the C++ grammar could not read all of it and found nothing only C++ has
    // (namespace, class, template, using, ::), the C grammar is tried too and whichever reads more is used.
    // (C code read as C++ fails on names such as `new`.)
    const cTree = file.endsWith('.h') && tree.rootNode.hasError && lookup.c && !looksLikeCpp(tree.rootNode) ? cGrammar().parser.parse(source) : null;
    const errors = (root: Node, grammarQuery: Query) => grammarQuery.captures(root).filter((item) => item.name === 'error').map((item) => item.node);
    if (cTree && unreadableBytes(errors(cTree.rootNode, cGrammar().query)) < unreadableBytes(errors(tree.rootNode, query))) {
      scanCTree(cTree.rootNode, lookup.c!, file, where, findings, reportedLines);
    } else {
      scanCppTree(tree.rootNode, lookup, file, where, findings, reportedLines);
    }
    cTree?.delete();
    tree.delete();
  }
  return findings.sort((left, right) => left.line - right.line);
}

export const cpp: LanguageAdapter = {
  id: 'cpp',
  extensions: ['.cpp', '.cc', '.cxx', '.c++', '.h', '.hpp', '.hh', '.hxx', '.h++'],
  alsoUsesRulesOf: ['c'],
  async load() {
    await loadC();
    parser ??= await createParser('cpp');
    query ??= new Query(parser.language!, `
      (call_expression function: (identifier) @callee)
      (qualified_identifier) @qualified
      (type_identifier) @type
      (using_declaration) @using
      (namespace_alias_definition) @alias
      (ERROR) @error`);
    cxxOnly ??= new Query(parser.language!, '[(namespace_definition) (class_specifier) (template_declaration) (using_declaration) (qualified_identifier)] @cxx');
  },
  scanSource,
};
