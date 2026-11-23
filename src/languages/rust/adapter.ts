import { Query } from 'web-tree-sitter';
import type { Node, Parser } from 'web-tree-sitter';
import type { LanguageAdapter } from '../../core/language.ts';
import { ruleFindings } from '../../core/match.ts';
import { createParser } from '../../core/tree-sitter.ts';
import type { Finding, ModuleRules, Rule } from '../../core/types.ts';
import { argumentsOf, callFindings, unreadableFindings } from '../c/adapter.ts';

let parser: Parser | undefined;
let query: Query | undefined;

/** Every Rust rule file together. Names are full paths from the crate (`sha2::Sha256`, `ring::digest::SHA256`). */
interface RustLookup {
  /** Paths that count only when called, because the algorithm is read from an argument. */
  functions: Map<string, Rule>;
  /** Paths whose every use counts. A name also covers every path below it (`p256` covers `p256::SecretKey`). */
  names: Map<string, Rule>;
  /** Crates read as another crate (`aws_lc_rs` as `ring`). */
  mirrors: Map<string, string>;
  /** A rule crate anywhere in the text. A file without one cannot produce a finding. */
  mentioned: RegExp | null;
  /** A path from a rule crate (`ring::digest::SHA256`), for the parse-error check. */
  used: RegExp | null;
}

const lookups = new WeakMap<ModuleRules[], RustLookup>();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function lookupFor(rules: ModuleRules[]): RustLookup {
  if (lookups.has(rules)) return lookups.get(rules)!;
  const functions = new Map<string, Rule>();
  const names = new Map<string, Rule>();
  const mirrors = new Map<string, string>();
  for (const group of rules.filter((item) => item.language === 'rust')) {
    for (const rule of group.rules) {
      for (const name of rule.functions) if (!functions.has(name)) functions.set(name, rule);
      for (const name of rule.names ?? []) if (!names.has(name)) names.set(name, rule);
    }
    for (const [from, to] of Object.entries(group.mirrors ?? {})) mirrors.set(from, to);
  }
  const crates = [...new Set(rules.filter((group) => group.language === 'rust').flatMap((group) => group.module))].map(escape).join('|');
  const lookup = {
    functions,
    names,
    mirrors,
    mentioned: crates ? new RegExp(`\\b(${crates})\\b`) : null,
    used: crates ? new RegExp(`\\b((?:${crates})::\\w+(?:::\\w+)*)`) : null,
  };
  lookups.set(rules, lookup);
  return lookup;
}

/** `::hmac::Hmac::<sha2::Sha256>::new` → [hmac, Hmac, new]: generic arguments are matched on their own. */
function segments(text: string): string[] {
  let depth = 0;
  let plain = '';
  for (const char of text) {
    if (char === '<') depth++;
    else if (char === '>') depth = Math.max(0, depth - 1);
    else if (depth === 0) plain += char;
  }
  return plain.replace(/\s+/g, '').replace(/^::/, '').split('::').filter(Boolean);
}

function hasAncestor(node: Node, types: readonly string[]): boolean {
  for (let current = node.parent; current; current = current.parent) if (types.includes(current.type)) return true;
  return false;
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
  const seen = new Set<string>();
  const reportedLines = new Set<number>();
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

  /** Reports one match. A name used twice on one line (`let k: SigningKey = SigningKey::random(..)`) is one use. */
  const report = (rule: Rule, name: string, line: number, resolve?: () => Finding[]): void => {
    if (!resolve && seen.has(`${line} ${rule.id}`)) return;
    seen.add(`${line} ${rule.id}`);
    reportedLines.add(line);
    findings.push(...(resolve ? resolve() : ruleFindings(rule, file, line, [{ note: `matched ${name}` }], () => ({ names: null, qualifiers: [] }))));
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
    const line = node.startPosition.row + 1;
    report(match.rule, match.name, line, match.call ? () => callFindings(argumentsOf(call!), line, match.rule, match.name, file, '') : undefined);
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

  // A macro's arguments (`assert_eq!(Sha256::digest(b"abc"), ...)`) and the code a `macro_rules!` expands to are
  // tokens, not parsed code, so paths are found by their text. String contents and comments are blanked first, keeping
  // every position the same.
  for (const tokens of macros) {
    const source = tokens.text;
    const visible = scopesAt(tokens);
    const blank = (match: string) => match.replace(/[^\n]/g, ' ');
    const plain = source.replace(/r(#*)"[\s\S]*?"\1|"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\\n]|\\[^\n]+?)'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, blank);
    for (const found of plain.matchAll(/(?<![\w.:$])(?:::)?[A-Za-z_]\w*(?:\s*::\s*[A-Za-z_]\w*)*/g)) {
      const path = segments(found[0]);
      const end = found.index + found[0].length;
      const called = /^\s*\(/.test(plain.slice(end));
      if (path.length === 1 && !(bareName(path[0], called) && visible.some((scope) => scope.names.has(path[0]) || scope.globs.length > 0))) continue;
      const match = ruleFor(path, called, visible);
      if (!match) continue;
      const line = tokens.startPosition.row + 1 + (source.slice(0, found.index).match(/\n/g)?.length ?? 0);
      // Only a string written directly as the first argument can be read here.
      const literal = /^\s*\(\s*"([^"\\]*)"/.exec(source.slice(end))?.[1];
      report(match.rule, match.name, line, match.call
        ? () => ruleFindings(match.rule, file, line, [{ note: `matched ${match.name} inside a macro` }],
          () => ({ names: literal !== undefined && match.rule.algorithmFrom!.arg === 0 ? [literal] : null, qualifiers: [] }))
        : undefined);
    }
  }

  if (lookup.used) findings.push(...unreadableFindings(errorRegions, [[lookup.used, 'a use of']], file, '', reportedLines));
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
