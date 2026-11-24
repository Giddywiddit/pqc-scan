import { Query } from 'web-tree-sitter';
import type { Node, Parser } from 'web-tree-sitter';
import type { LanguageAdapter } from '../../core/language.ts';
import { lookup as lookupValue, ruleFindings } from '../../core/match.ts';
import { type NameIndex, LineReporter, indexRules } from '../../core/matcher.ts';
import { escape, unreadableFindings } from '../../core/syntax.ts';
import { callSitesIn, markWrapper } from '../../core/wrappers.ts';
import { createParser } from '../../core/tree-sitter.ts';
import type { Finding, ModuleRules, Rule } from '../../core/types.ts';
import { type CLookup, cLookupFor } from '../c/api.ts';

let parser: Parser | undefined;
let query: Query | undefined;

/**
 * Every Go rule file together. Names are an import path, or an import path and a member (`crypto/sha256.New`), as Go's
 * own documentation writes them. A whole import path covers every member of that package. `functions` count where
 * they are called or built (`tls.Config{...}`), and mirrors read one import path as another
 * (`github.com/golang-jwt/jwt/v4` as `.../v5`).
 */
interface GoLookup extends NameIndex {
  /** Import paths that rules name, for the quick check on each file. */
  paths: Set<string>;
  /** C functions, called from Go through cgo as `C.name(...)`. */
  c: CLookup | null;
  /** A rule import path, or cgo with a known C function, anywhere in the text. A file without one cannot match. */
  mentioned: RegExp | null;
}

const lookups = new WeakMap<ModuleRules[], GoLookup>();

function lookupFor(rules: ModuleRules[]): GoLookup {
  if (lookups.has(rules)) return lookups.get(rules)!;
  const groups = rules.filter((group) => group.language === 'go');
  const paths = new Set(groups.flatMap((group) => group.module));
  const c = cLookupFor(rules.filter((group) => group.language === 'c'));
  const words = [...[...paths].map((path) => `"${escape(path)}"`), ...(c ? ['"C"'] : [])];
  const lookup = { ...indexRules(groups), paths, c, mentioned: words.length > 0 ? new RegExp(words.join('|')) : null };
  lookups.set(rules, lookup);
  return lookup;
}

/**
 * The name a package is used by when its import has no name of its own: the last element of the path, skipping a
 * major-version element (`jwt/v5` → `jwt`), without a `go-` prefix, and cut at the first character that cannot be in a
 * Go name (`go-jose.v2` → `jose`, `jwt-go` → `jwt`). This is the rule goimports uses (golang.org/x/tools,
 * internal/imports, ImportPathToAssumedName); goimports writes the name out whenever the real one differs.
 */
export function assumedName(importPath: string): string {
  const parts = importPath.split('/');
  let base = parts[parts.length - 1];
  if (/^v\d+$/.test(base) && parts.length > 1) base = parts[parts.length - 2];
  base = base.replace(/^go-/, '');
  const cut = base.search(/[^\p{L}\p{N}_]/u);
  return cut >= 0 ? base.slice(0, cut) : base;
}

/** What a file's imports bring in: each package name with its import path, the `import . "path"` packages, and cgo. */
interface Imports {
  byName: Map<string, string>;
  dot: string[];
  cgo: boolean;
}

function importsOf(captures: { name: string; node: Node }[]): Imports {
  const imports: Imports = { byName: new Map(), dot: [], cgo: false };
  for (const { name, node } of captures) {
    if (name !== 'import') continue;
    const pathNode = node.childForFieldName('path');
    const path = pathNode?.text.slice(1, -1);
    if (!path) continue;
    const local = node.childForFieldName('name');
    if (path === 'C' && !local) imports.cgo = true;
    else if (local?.type === 'dot') imports.dot.push(path);
    else if (local?.type !== 'blank_identifier') imports.byName.set(local?.text ?? assumedName(path), path);
  }
  return imports;
}

/** Where a name declared inside a function applies: the function, a block, or the statement that declares it. */
const SCOPES = ['function_declaration', 'method_declaration', 'func_literal', 'block', 'for_statement', 'if_statement',
  'expression_switch_statement', 'type_switch_statement', 'select_statement', 'expression_case', 'type_case', 'communication_case', 'default_case'];

/**
 * Names declared inside functions, by the scope they are declared in, each with where its declaration ends. A local
 * name hides a package of the same name from the end of its declaration on, as in Go: in
 * `h := sha256.New(); sha256 := h.Sum(nil)` the first `sha256` is still the package.
 */
function localsOf(captures: { name: string; node: Node }[]): Map<number, { name: string; end: number }[]> {
  const locals = new Map<number, { name: string; end: number }[]>();
  for (const { name, node } of captures) {
    if (name !== 'local') continue;
    let declaration = node.parent;
    while (declaration && !['parameter_declaration', 'short_var_declaration', 'range_clause', 'var_spec', 'const_spec', 'type_switch_statement', 'variadic_parameter_declaration'].includes(declaration.type)) declaration = declaration.parent;
    let scope = declaration?.parent;
    while (scope && !SCOPES.includes(scope.type)) scope = scope.parent;
    if (!declaration || !scope) continue;
    // A type switch's name (`switch k := v.(type)`) is declared at the start of the switch.
    const end = declaration.type === 'type_switch_statement' ? node.endIndex : declaration.endIndex;
    if (!locals.has(scope.id)) locals.set(scope.id, []);
    locals.get(scope.id)!.push({ name: node.text, end });
  }
  return locals;
}

/** The algorithm name an argument holds: a string as written, or a constant (`C.EVP_PKEY_RSA`, `jwt.X`) the table knows. */
function argumentNames(node: Node | undefined, values: Record<string, unknown>): string[] | null {
  if (!node) return null;
  let value = node;
  while (value.type === 'parenthesized_expression' && value.namedChild(0)) value = value.namedChild(0)!;
  if (value.type === 'interpreted_string_literal') return /^"[^"\\]*"$/.test(value.text) ? [value.text.slice(1, -1)] : null;
  if (value.type === 'raw_string_literal') return [value.text.slice(1, -1)];
  if (value.type === 'int_literal') return [value.text];
  const name = value.type === 'identifier' ? value.text : value.type === 'selector_expression' ? value.childForFieldName('field')?.text : undefined;
  return name !== undefined && lookupValue(values, name) !== undefined ? [name] : null;
}

function scanGoTree(root: Node, lookup: GoLookup, file: string, findings: Finding[]): void {
  const captures = query!.captures(root);
  const imports = importsOf(captures);
  const locals = localsOf(captures);
  const reporter = new LineReporter(file, findings);
  const errorRegions: Node[] = [];

  /** Whether a local variable, parameter or constant hides the package name `name` at `node`. */
  const shadowed = (node: Node, name: string): boolean => {
    for (let scope = node.parent; scope; scope = scope.parent) {
      if (locals.get(scope.id)?.some((local) => local.name === name && local.end <= node.startIndex)) return true;
    }
    return false;
  };

  /** The rule for `member` of the package imported as `path`: a function when called or built, else a name. */
  const ruleFor = (path: string, member: string, called: boolean): { rule: Rule; name: string; call: boolean } | undefined => {
    const mirror = lookup.mirrors.get(path);
    for (const tried of mirror ? [path, mirror] : [path]) {
      const fn = called ? lookup.functions.get(`${tried}.${member}`) : undefined;
      if (fn) return { rule: fn, name: `${path}.${member}`, call: true };
      const rule = lookup.names.get(`${tried}.${member}`) ?? lookup.names.get(tried);
      if (rule) return { rule, name: `${path}.${member}`, call: false };
    }
    return undefined;
  };

  /** The arguments when `node` is called (`f(x)`), or no arguments when it is built (`tls.Config{...}`). */
  const usage = (node: Node): Node[] | undefined => {
    let up = node;
    while (up.parent?.type === 'generic_type' || (up.parent?.type === 'parenthesized_expression')) up = up.parent;
    const parent = up.parent;
    if (parent?.type === 'call_expression' && parent.childForFieldName('function')?.equals(up)) return parent.childForFieldName('arguments')?.namedChildren ?? [];
    if (parent?.type === 'composite_literal' && parent.childForFieldName('type')?.equals(up)) return [];
    return undefined;
  };

  /** Reports `rule` at `node`. `args` is given for a call: the argument nodes the algorithm may be read from. */
  const report = (rule: Rule, name: string, node: Node, args?: Node[]): void => {
    const line = node.startPosition.row + 1;
    if (!args) return reporter.name(rule, line, `matched ${name}`);
    const findings = ruleFindings(rule, file, line, [{ note: `matched ${name}` }], () => ({
      names: argumentNames(args[rule.algorithmFrom!.arg], rule.values ?? {}),
      qualifiers: [],
    }));
    reporter.call(rule, line, rule.algorithmFrom ? markWrapper(findings, rule, args[rule.algorithmFrom.arg], file) : findings);
  };

  /** `pkg.Member`, written at `node`, where `pkg` is the package's name in this file. */
  const matchQualified = (pkg: string, member: string, node: Node, at: Node): void => {
    if (pkg === 'C' && imports.cgo && !imports.byName.has('C')) {
      const args = usage(node);
      const match = args && lookup.c?.byFunction.get(member);
      if (match) report(match.rule, `${match.library} function ${member} through cgo`, node, args);
      return;
    }
    const path = imports.byName.get(pkg);
    if (!path || shadowed(at, pkg)) return;
    const args = usage(node);
    const match = ruleFor(path, member, args !== undefined);
    if (match) report(match.rule, match.name, node, match.call ? args : undefined);
  };

  for (const { name, node } of captures) {
    if (name === 'error') errorRegions.push(node);
    else if (name === 'selector') {
      const operand = node.childForFieldName('operand');
      const field = node.childForFieldName('field');
      if (operand?.type === 'identifier' && field) matchQualified(operand.text, field.text, node, operand);
    } else if (name === 'qualified') {
      const pkg = node.childForFieldName('package');
      const member = node.childForFieldName('name');
      if (pkg && member) matchQualified(pkg.text, member.text, node, pkg);
    } else if (name === 'bare' && imports.dot.length > 0 && /^\p{Lu}/u.test(node.text)) {
      // With `import . "crypto/sha256"`, the package's exported names are written alone (`New()`).
      const parent = node.parent;
      if (parent && ['selector_expression', 'qualified_type'].includes(parent.type)) continue;
      if (parent?.childForFieldName('name')?.equals(node) || shadowed(node, node.text)) continue;
      const args = usage(node);
      for (const path of imports.dot) {
        const match = ruleFor(path, node.text, args !== undefined);
        if (match && match.name !== path) {
          report(match.rule, match.name, node, match.call ? args : undefined);
          break;
        }
      }
    }
  }

  // Code the parser could not read is checked for a rule package used through its name in this file (`rsa.`).
  const used = [...imports.byName].filter(([, path]) => lookup.paths.has(path) || lookup.mirrors.has(path)).map(([local]) => escape(local));
  if (imports.cgo && lookup.c) used.push('C');
  if (used.length > 0) findings.push(...unreadableFindings(errorRegions, [[new RegExp(`\\b((?:${used.join('|')})\\.\\w+)`), 'a use of']], file, '', reporter.reportedLines));
}

function scanSource(text: string, file: string, rules: ModuleRules[]): Finding[] {
  if (!parser || !query) throw new Error('The Go grammar is not loaded: call loadLanguages() before scanning.');
  const lookup = lookupFor(rules);
  // Every finding needs an import of a rule package (or of "C"), so a file without one is not parsed.
  if (!lookup.mentioned || !lookup.mentioned.test(text)) return [];
  const findings: Finding[] = [];
  const tree = parser.parse(text);
  if (!tree) throw new Error(`${file}: the Go parser returned no tree.`);
  scanGoTree(tree.rootNode, lookup, file, findings);
  // Trees live in the parser's WebAssembly memory, which JavaScript's garbage collector does not free.
  tree.delete();
  return findings.sort((left, right) => left.line - right.line);
}

export const go: LanguageAdapter = {
  id: 'go',
  extensions: ['.go'],
  alsoUsesRulesOf: ['c'],
  async load() {
    parser ??= await createParser('go');
    query ??= new Query(parser.language!, `
      (import_spec) @import
      (selector_expression) @selector
      (qualified_type) @qualified
      (identifier) @bare
      (type_identifier) @bare
      (parameter_declaration name: (identifier) @local)
      (variadic_parameter_declaration name: (identifier) @local)
      (short_var_declaration left: (expression_list (identifier) @local))
      (range_clause left: (expression_list (identifier) @local))
      (var_spec name: (identifier) @local)
      (const_spec name: (identifier) @local)
      (type_switch_statement alias: (expression_list (identifier) @local))
      (ERROR) @error`);
  },
  scanSource,
  callSites: (text) => callSitesIn(parser!, text),
};
