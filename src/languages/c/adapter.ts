import { Query } from 'web-tree-sitter';
import type { Node, Parser } from 'web-tree-sitter';
import { finding } from '../../core/finding.ts';
import type { LanguageAdapter } from '../../core/language.ts';
import { lookup, ruleFindings } from '../../core/match.ts';
import { createParser } from '../../core/tree-sitter.ts';
import type { Finding, ModuleRules, Rule } from '../../core/types.ts';

let parser: Parser | undefined;
let query: Query | undefined;

/**
 * Blanks preprocessor directives (and their backslash continuations) but keeps every line, so line numbers stay true.
 * Without this, `#if`/`#else` branches that leave braces unbalanced push large parts of real files into parse-error
 * regions (32% of curl's lib/vtls before, 0.19% after). Both branches of every `#if` are scanned, which suits an
 * inventory. The cost: code inside `#define` macros is not read.
 */
export function blankDirectives(source: string): string {
  let continued = false;
  return source.split('\n').map((line) => {
    const directive = continued || /^\s*#/.test(line);
    continued = directive && /\\\s*$/.test(line);
    return directive && !/^\s*#\s*include\b/.test(line) ? '' : line;
  }).join('\n');
}

/**
 * The bodies of `#define` macros, each wrapped in a dummy function so it can be parsed, on the same lines as in the
 * source and with everything else blank. A crypto call that exists only inside a macro is reported where the macro is
 * defined, whether or not the macro is used.
 */
export function macroBodies(source: string): string {
  const lines = source.split('\n');
  const out = lines.map(() => '');
  for (let start = 0; start < lines.length; start++) {
    const head = /^\s*#\s*define\s+[A-Za-z_]\w*(\([^)]*\))?/.exec(lines[start]);
    if (!head) continue;
    let end = start;
    while (/\\\s*$/.test(lines[end]) && end + 1 < lines.length) end++;
    const body = lines.slice(start, end + 1).map((line, offset) => (offset === 0 ? line.slice(head[0].length) : line).replace(/\\\s*$/, ''));
    if (body.join('').trim()) {
      body[0] = `void pqc_macro_${start}(void) { ${body[0]}`;
      body[body.length - 1] += ' ;}';
      body.forEach((line, offset) => { out[start + offset] = line; });
    }
    start = end;
  }
  return out.join('\n');
}

function unwrap(node: Node): Node {
  let current = node;
  while (current.type === 'parenthesized_expression' || current.type === 'cast_expression') {
    const inner = current.type === 'cast_expression' ? current.childForFieldName('value') : current.namedChild(0);
    if (!inner) break;
    current = inner;
  }
  return current;
}

/**
 * The algorithm name an argument holds. A string or number is taken as written. A bare name (`EVP_PKEY_RSA`) or a
 * call (`EVP_sha256()`, `PSA_ALG_ECDSA(PSA_ALG_SHA_256)`, matched by its outer name) counts only when the rule's table
 * knows it: any other name is a variable whose value is not known here, so it is reported as unresolved rather than as
 * an unknown algorithm.
 */
function argumentNames(node: Node | null | undefined, values: Record<string, unknown>): string[] | null {
  if (!node) return null;
  const value = unwrap(node);
  if (value.type === 'string_literal') return /^"[^"\\]*"$/.test(value.text) ? [value.text.slice(1, -1)] : null;
  if (value.type === 'number_literal') return [value.text];
  const name = value.type === 'identifier'
    ? value.text
    : value.type === 'call_expression' && value.childForFieldName('function')?.type === 'identifier'
      ? value.childForFieldName('function')!.text
      : null;
  return name !== null && lookup(values, name) !== undefined ? [name] : null;
}

interface Lookup {
  byFunction: Map<string, { rule: Rule; library: string }>;
  /** Any known function name anywhere in the text. A file without one cannot produce a finding. */
  mentioned: RegExp;
  /** A known function name followed by `(`, for the parse-error check. */
  called: RegExp;
}

// Built once per rules array: a scan passes the same array for every file.
const lookups = new WeakMap<ModuleRules[], Lookup | null>();

function lookupFor(rules: ModuleRules[]): Lookup | null {
  if (lookups.has(rules)) return lookups.get(rules)!;
  const byFunction = new Map<string, { rule: Rule; library: string }>();
  for (const group of rules) for (const rule of group.rules) for (const name of rule.functions) {
    if (!byFunction.has(name)) byFunction.set(name, { rule, library: group.module[0] });
  }
  const names = [...byFunction.keys()].join('|');
  const lookup = byFunction.size > 0 ? { byFunction, mentioned: new RegExp(`\\b(${names})\\b`), called: new RegExp(`\\b(${names})\\s*\\(`) } : null;
  lookups.set(rules, lookup);
  return lookup;
}

function scanSource(text: string, file: string, rules: ModuleRules[]): Finding[] {
  if (!parser) throw new Error('The C grammar is not loaded: call loadLanguages() before scanning.');
  const lookup = lookupFor(rules);
  // Every finding needs a known function name in the text, so a file without one is not parsed at all.
  if (!lookup || !lookup.mentioned.test(text)) return [];
  const { byFunction, called: known } = lookup;
  const findings: Finding[] = [];
  const reportedLines = new Set<number>();

  // The code with directives blanked, then the macro bodies on their own. Both keep the source's line numbers, and no
  // line has content in both, so nothing is reported twice.
  for (const [source, where] of [[blankDirectives(text), ''], [macroBodies(text), ' inside a #define macro']] as const) {
    const tree = parser.parse(source);
    if (!tree) throw new Error(`${file}: the C parser returned no tree.`);
    // The parser finds the calls and unreadable regions itself, in source order, which is far faster than visiting
    // every node from JavaScript.
    const errorRegions: Node[] = [];
    for (const { name, node } of query!.captures(tree.rootNode)) {
      if (name === 'error') {
        errorRegions.push(node);
        continue;
      }
      const callee = node.childForFieldName('function')!;
      const match = byFunction.get(callee.text);
      if (!match) continue;
      const line = node.startPosition.row + 1;
      reportedLines.add(line);
      const args = node.childForFieldName('arguments')?.namedChildren ?? [];
      findings.push(...ruleFindings(match.rule, file, line, [{ note: `matched ${match.library} function ${callee.text}${where}` }], () => ({
        names: argumentNames(args[match.rule.algorithmFrom!.arg], match.rule.values ?? {}),
        qualifiers: [],
      })));
    }

    // Fail closed: a known crypto function name inside a region the parser could not read is reported, not dropped.
    for (const region of errorRegions) {
      region.text.split('\n').forEach((content, offset) => {
        const line = region.startPosition.row + 1 + offset;
        const name = known.exec(content)?.[1];
        if (name && !reportedLines.has(line)) {
          reportedLines.add(line);
          findings.push(finding(file, line, 'parse-error', 'unknown', null, 'unresolved', `Looks like a call to ${name}${where}, but this part of the file could not be parsed.`));
        }
      });
    }
    // Trees live in the parser's WebAssembly memory, which JavaScript's garbage collector does not free.
    tree.delete();
  }
  return findings.sort((left, right) => left.line - right.line);
}

export const c: LanguageAdapter = {
  id: 'c',
  extensions: ['.c', '.h'],
  async load() {
    parser ??= await createParser('c');
    query ??= new Query(parser.language!, '(call_expression function: (identifier)) @call (ERROR) @error');
  },
  scanSource,
};
