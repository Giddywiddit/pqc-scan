import { Query } from 'web-tree-sitter';
import type { Node, Parser } from 'web-tree-sitter';
import type { LanguageAdapter } from '../../core/language.ts';
import { lookup as lookupValue, ruleFindings } from '../../core/match.ts';
import { type NameIndex, LineReporter, indexRules } from '../../core/matcher.ts';
import { argumentsOf, escape, hasAncestor, segments, unreadableFindings } from '../../core/syntax.ts';
import { createParser } from '../../core/tree-sitter.ts';
import type { Finding, ModuleRules, Rule } from '../../core/types.ts';

let parser: Parser | undefined;
let query: Query | undefined;

/**
 * Every Rust rule file together. Names are full paths from the crate (`sha2::Sha256`, `ring::digest::SHA256`), and a
 * name also covers every path below it (`p256` covers `p256::SecretKey`).
 */
interface RustLookup extends NameIndex {
  /** A rule crate anywhere in the text. A file without one cannot produce a finding. */
  mentioned: RegExp | null;
  /** A path from a rule crate (`ring::digest::SHA256`), for the parse-error check. */
  used: RegExp | null;
}

const lookups = new WeakMap<ModuleRules[], RustLookup>();

function lookupFor(rules: ModuleRules[]): RustLookup {
  if (lookups.has(rules)) return lookups.get(rules)!;
  const groups = rules.filter((group) => group.language === 'rust');
  const crates = [...new Set(groups.flatMap((group) => group.module))].map(escape).join('|');
  const lookup = {
    ...indexRules(groups),
    mentioned: crates ? new RegExp(`\\b(${crates})\\b`) : null,
    used: crates ? new RegExp(`\\b((?:${crates})::\\w+(?:::\\w+)*)`) : null,
  };
  lookups.set(rules, lookup);
  return lookup;
}

/** What the `use` lines of one block or module bring in: each name with the full path it stands for, and each `use x::*`. */
interface Scope {
  names: Map<string, string[]>;
  globs: string[][];
}

function addUse(node: Node, prefix: string[], scope: Scope): void {
  const withoutSelf = (path: string[]) => (path[path.length - 1] === 'self' ? path.slice(0, -1) : path);
  if (node.type === 'self') {
    if (prefix.length > 0) scope.names.set(prefix[prefix.length - 1], prefix);
  } else if (node.type === 'identifier' || node.type === 'scoped_identifier') {
    const path = withoutSelf([...prefix, ...segments(node.text)]);
    if (path.length > 0) scope.names.set(path[path.length - 1], path);
  } else if (node.type === 'use_as_clause') {
    const alias = node.childForFieldName('alias')?.text;
    const path = withoutSelf([...prefix, ...segments(node.childForFieldName('path')?.text ?? '')]);
    if (alias && alias !== '_' && path.length > 0) scope.names.set(alias, path);
  } else if (node.type === 'scoped_use_list') {
    const inner = [...prefix, ...segments(node.childForFieldName('path')?.text ?? '')];
    for (const child of node.childForFieldName('list')?.namedChildren ?? []) addUse(child, inner, scope);
  } else if (node.type === 'use_list') {
    for (const child of node.namedChildren) addUse(child, prefix, scope);
  } else if (node.type === 'use_wildcard') {
    scope.globs.push([...prefix, ...segments(node.text.replace(/\*$/, ''))]);
  }
}

/** Where a `use` line applies: the file, a module's body or a block, such as a function body. */
const SCOPES = ['source_file', 'declaration_list', 'block'];

function scopesOf(captures: { name: string; node: Node }[]): Map<number, Scope> {
  const scopes = new Map<number, Scope>();
  for (const { name, node } of captures) {
    if (name !== 'use' && name !== 'extern') continue;
    let container = node.parent;
    while (container && !SCOPES.includes(container.type)) container = container.parent;
    if (!container) continue;
    if (!scopes.has(container.id)) scopes.set(container.id, { names: new Map(), globs: [] });
    const scope = scopes.get(container.id)!;
    if (name === 'use') {
      const argument = node.childForFieldName('argument');
      if (argument) addUse(argument, [], scope);
    } else if (name === 'extern') {
      // `extern crate openssl as ssl;`
      const crate = node.childForFieldName('name')?.text;
      const alias = node.childForFieldName('alias')?.text;
      if (crate && alias) scope.names.set(alias, [crate]);
    }
  }
  return scopes;
}

/** Paths that start here, not at a crate: they cannot name a library. */
const LOCAL = new Set(['crate', 'self', 'super', 'Self']);
/** Parts of a longer path (`sha2` and `Sha256` in `sha2::Sha256`), which is matched as a whole. */
const PATHS = new Set(['scoped_identifier', 'scoped_type_identifier']);
/** Fields that define a name rather than use one (`fn name`, `let name`, `struct Name`). */
const DEFINING = ['name', 'pattern', 'macro'];
/**
 * Whether a name written alone can stand for something a `use` line brought in. Types and constants start with a
 * capital letter. A lower-case name is a module, function or variable, so it counts only when called: `if pss {` is a
 * variable even in a file with `use rsa::pss;`, while `compute(data)` after `use md5::compute;` is the function.
 */
const bareName = (name: string, called: boolean): boolean => called || /^[A-Z]/.test(name);

/** The algorithm name an argument holds: a string as written, or a name the rule's table knows. */
function argumentNames(node: Node | undefined, values: Record<string, unknown>): string[] | null {
  if (node?.type === 'string_literal') return /^"[^"\\]*"$/.test(node.text) ? [node.text.slice(1, -1)] : null;
  return node?.type === 'identifier' && lookupValue(values, node.text) !== undefined ? [node.text] : null;
}

/** Tokens inside a macro that are not code: their text is never read as a path. */
const NOT_CODE = new Set(['string_literal', 'raw_string_literal', 'char_literal', 'line_comment', 'block_comment']);

/** The tokens of a macro's token tree, in order. Strings and comments are kept whole, as one token each. */
function tokensOf(node: Node, out: Node[] = []): Node[] {
  for (const child of node.children) {
    if (child.childCount === 0 || NOT_CODE.has(child.type)) out.push(child);
    else tokensOf(child, out);
  }
  return out;
}
const isWord = (token: Node | undefined): token is Node => Boolean(token && !NOT_CODE.has(token.type) && /^[A-Za-z_]\w*$/.test(token.text));

function scanRustTree(root: Node, lookup: RustLookup, file: string, findings: Finding[]): void {
  const captures = query!.captures(root);
  const scopes = scopesOf(captures);
  // The scopes a node can see, innermost first. (An inner module is treated as seeing its file's `use` lines too, as
  // a test module usually does through `use super::*`.)
  const scopesAt = (node: Node): Scope[] => {
    const found: Scope[] = [];
    for (let current = node.parent; current; current = current.parent) if (scopes.has(current.id)) found.push(scopes.get(current.id)!);
    return found;
  };
  const reporter = new LineReporter(file, findings);
  const errorRegions: Node[] = [];

  /** The full paths `path` may stand for: through a `use`, from the crate root, or below a `use x::*`. */
  const candidates = (path: string[], visible: Scope[]): string[][] => {
    if (path.length === 0 || LOCAL.has(path[0])) return [];
    const used = visible.find((scope) => scope.names.has(path[0]))?.names.get(path[0]);
    if (used) return [[...used, ...path.slice(1)]];
    return [...(path.length > 1 ? [path] : []), ...visible.flatMap((scope) => scope.globs.map((glob) => [...glob, ...path]))];
  };

  /** The rule `path` matches: a function when called, else the longest name it starts with. Mirrors are tried last. */
  const ruleFor = (path: string[], called: boolean, visible: Scope[]): { rule: Rule; name: string; call: boolean } | undefined => {
    for (const full of candidates(path, visible)) {
      const mirror = lookup.mirrors.get(full[0]);
      for (const tried of mirror ? [full, [mirror, ...full.slice(1)]] : [full]) {
        const fn = called ? lookup.functions.get(tried.join('::')) : undefined;
        if (fn) return { rule: fn, name: full.join('::'), call: true };
        for (let length = tried.length; length > 0; length--) {
          const rule = lookup.names.get(tried.slice(0, length).join('::'));
          if (rule) return { rule, name: full.join('::'), call: false };
        }
      }
    }
    return undefined;
  };

  /** Reports one match: a use of a name, or a call with the argument it may read the algorithm from (`how` says where). */
  const report = (match: { rule: Rule; name: string; call: boolean }, line: number, argument: () => Node | string | undefined, how = ''): void => {
    if (!match.call) return reporter.name(match.rule, line, `matched ${match.name}`);
    reporter.call(match.rule, line, ruleFindings(match.rule, file, line, [{ note: `matched ${match.name}${how}` }], () => {
      const value = argument();
      return { names: typeof value === 'string' ? [value] : argumentNames(value, match.rule.values ?? {}), qualifiers: [] };
    }));
  };

  /** The call `node` is the function of, if any (`f(x)`, `f::<T>(x)`). */
  const callOf = (node: Node): Node | undefined => {
    let up = node;
    while (up.parent?.type === 'generic_function' && up.parent.childForFieldName('function')?.equals(up)) up = up.parent;
    return up.parent?.type === 'call_expression' && up.parent.childForFieldName('function')?.equals(up) ? up.parent : undefined;
  };

  const matchNode = (node: Node, path: string[], visible: Scope[]): void => {
    const call = callOf(node);
    const match = ruleFor(path, Boolean(call), visible);
    if (!match) return;
    report(match, node.startPosition.row + 1, () => argumentsOf(call!)[match.rule.algorithmFrom!.arg]);
  };

  const macros: Node[] = [];
  for (const { name, node } of captures) {
    if (name === 'error') errorRegions.push(node);
    else if (name === 'macro') macros.push(node);
    if (name !== 'path' && name !== 'name') continue;
    // Only the outermost part of `a::b::C` is matched; `Hmac` in `Hmac::<Sha256>::new` is part of the longer path.
    let up = node;
    while (up.parent?.type === 'generic_type' && up.parent.childForFieldName('type')?.equals(up)) up = up.parent;
    if (up.parent && PATHS.has(up.parent.type)) continue;
    // `use` lines only bring names into scope, and macro arguments are read separately below.
    if (hasAncestor(node, ['use_declaration', 'token_tree', 'extern_crate_declaration'])) continue;
    if (name === 'path') {
      // `<Sha256 as Digest>::digest`: the type inside the brackets is matched on its own.
      if (!node.text.startsWith('<')) matchNode(node, segments(node.text), scopesAt(node));
    } else if (!DEFINING.some((field) => node.parent?.childForFieldName(field)?.equals(node))) {
      // A name without a path (`Sha256`) counts only when a `use` line brings it in, and not where it is defined.
      const visible = scopesAt(node);
      if (bareName(node.text, Boolean(callOf(node))) && visible.some((scope) => scope.names.has(node.text) || scope.globs.length > 0)) matchNode(node, [node.text], visible);
    }
  }

  // A macro's arguments (`assert_eq!(Sha256::digest(b"abc"), ...)`) and the code a `macro_rules!` expands to are not
  // parsed as code, but the parser still splits them into tokens. Paths are read from those tokens: words joined by
  // `::`. Strings and comments are single tokens, so their text is never mistaken for code.
  for (const tree of macros) {
    const tokens = tokensOf(tree);
    const visible = scopesAt(tree);
    for (let start = 0; start < tokens.length; start++) {
      if (!isWord(tokens[start])) continue;
      const before = tokens[start - 1]?.text;
      // A later part of a path (`b` in `a::b`), a method or field (`.update`), or a macro variable (`$name`).
      if (before === '.' || before === '$' || (before === '::' && (isWord(tokens[start - 2]) || tokens[start - 2]?.text === '::'))) continue;
      const path = [tokens[start].text];
      let end = start;
      while (tokens[end + 1]?.text === '::' && isWord(tokens[end + 2])) {
        path.push(tokens[end + 2].text);
        end += 2;
      }
      const called = tokens[end + 1]?.text === '(';
      if (path.length === 1 && !(bareName(path[0], called) && visible.some((scope) => scope.names.has(path[0]) || scope.globs.length > 0))) continue;
      const match = ruleFor(path, called, visible);
      if (!match) continue;
      // Only a string written directly as the first argument can be read here.
      const first = tokens[end + 2];
      const literal = first?.type === 'string_literal' && /^"[^"\\]*"$/.test(first.text) ? first.text.slice(1, -1) : undefined;
      report(match, tokens[start].startPosition.row + 1, () => (match.rule.algorithmFrom!.arg === 0 ? literal : undefined), ' inside a macro');
    }
  }

  if (lookup.used) findings.push(...unreadableFindings(errorRegions, [[lookup.used, 'a use of']], file, '', reporter.reportedLines));
}

function scanSource(text: string, file: string, rules: ModuleRules[]): Finding[] {
  if (!parser || !query) throw new Error('The Rust grammar is not loaded: call loadLanguages() before scanning.');
  const lookup = lookupFor(rules);
  // Every finding needs a rule crate's name in the text, so a file without one is not parsed.
  if (!lookup.mentioned || !lookup.mentioned.test(text)) return [];
  const findings: Finding[] = [];
  const tree = parser.parse(text);
  if (!tree) throw new Error(`${file}: the Rust parser returned no tree.`);
  scanRustTree(tree.rootNode, lookup, file, findings);
  // Trees live in the parser's WebAssembly memory, which JavaScript's garbage collector does not free.
  tree.delete();
  return findings.sort((left, right) => left.line - right.line);
}

export const rust: LanguageAdapter = {
  id: 'rust',
  extensions: ['.rs'],
  async load() {
    parser ??= await createParser('rust');
    query ??= new Query(parser.language!, `
      (use_declaration) @use
      (extern_crate_declaration) @extern
      (scoped_identifier) @path
      (scoped_type_identifier) @path
      (identifier) @name
      (type_identifier) @name
      (macro_invocation (token_tree) @macro)
      (macro_rule right: (token_tree) @macro)
      (ERROR) @error`);
  },
  scanSource,
};
