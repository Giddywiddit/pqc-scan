import { basename, dirname } from 'node:path';
import { Query } from 'web-tree-sitter';
import type { Language, Node, Parser } from 'web-tree-sitter';
import { lookup, ruleFindings } from './match.ts';
import type { Finding, FunctionInfo, Rule, WrapperMark } from './types.ts';

// Following "wrapper" functions across files, for the tree-sitter languages (C, C++, Rust, Go).
//
// A wrapper is a function that passes one of its own parameters on as the algorithm of a crypto call:
// `func digest(alg string, b []byte) { ... jwt.GetSigningMethod(alg) }`. Whoever calls it chooses the algorithm, so the
// crypto call itself is reported as unresolved, and the calls to the wrapper are followed:
//   - a call that passes a value written in the code (`digest("RS256", b)`) is reported where it is, with the algorithm;
//   - a call that passes its own parameter on makes its function a wrapper too, followed up to five levels;
//   - calls that pass a value that cannot be read are listed on the wrapper's own finding, not reported one by one.
// A call is matched to a wrapper only where the language allows that call: a C `static` function or a private Rust
// function in its own file, an unexported Go function in its own package, `Class::f` through its class, and a method
// called on a value never (the value's type is not known here).

export type { FunctionInfo, WrapperMark };

/** A value passed to a function, as far as it can be read without running the code. */
export type Argument = { kind: 'string'; value: string } | { kind: 'name'; value: string } | { kind: 'other' };

/** A call to a function by name, with its arguments and the function it is written in. */
export interface CallSite {
  name: string;
  line: number;
  args: Argument[];
  /** `f(...)`, `Class::f(...)` / `module::f(...)`, or `value.f(...)` / `pkg.F(...)`; `qualifier` is the part before. */
  form: 'plain' | 'qualified' | 'member';
  qualifier?: string;
  enclosing?: FunctionInfo;
}

const FUNCTIONS = new Set(['function_definition', 'function_item', 'function_declaration', 'method_declaration']);
const NAMES = new Set(['identifier', 'field_identifier', 'type_identifier', 'qualified_identifier', 'destructor_name', 'operator_name']);
const lastPart = (text: string) => text.replace(/<.*>/s, '').split(/::|\./).filter(Boolean).pop() ?? text;

/** The innermost name in a C or C++ declarator chain (`*name`, `&name`, `Class::name`). */
function declaredName(node: Node | null): Node | null {
  let current = node;
  while (current && !NAMES.has(current.type)) current = current.childForFieldName('declarator') ?? current.namedChild(0);
  return current;
}

function hasChild(node: Node, type: string, text?: string): boolean {
  return node.children.some((child) => child.type === type && (text === undefined || child.text === text));
}

/** A function definition: its name, parameters, and how it can be called, for C, C++, Rust and Go. */
function functionOf(node: Node): FunctionInfo | undefined {
  if (node.type === 'function_definition') {
    let declarator = node.childForFieldName('declarator');
    while (declarator && declarator.type !== 'function_declarator') declarator = declarator.childForFieldName('declarator');
    const named = declaredName(declarator?.childForFieldName('declarator') ?? null);
    if (!named) return undefined;
    const parameters = (declarator?.childForFieldName('parameters')?.namedChildren ?? [])
      .filter((item) => item.type.endsWith('parameter_declaration'))
      .map((item) => lastPart(declaredName(item.childForFieldName('declarator'))?.text ?? ''));
    const isStatic = hasChild(node, 'storage_class_specifier', 'static');
    const inClass = node.parent?.type === 'field_declaration_list' ? node.parent.parent : undefined;
    if (named.type === 'qualified_identifier') {
      return { name: lastPart(named.text), parameters, kind: 'associated', qualifier: lastPart(named.childForFieldName('scope')?.text ?? ''), visibility: 'everywhere' };
    }
    if (inClass) {
      const qualifier = inClass.childForFieldName('name')?.text;
      return { name: named.text, parameters, kind: isStatic ? 'associated' : 'method', qualifier, visibility: 'everywhere' };
    }
    return { name: named.text, parameters, kind: 'function', visibility: isStatic ? 'file' : 'everywhere' };
  }
  const name = node.childForFieldName('name')?.text;
  if (!name) return undefined;
  const list = node.childForFieldName('parameters')?.namedChildren ?? [];
  if (node.type === 'function_item') {
    // `fn f(&self, alg: &str)` is called as `x.f(alg)`, so `self` is not counted as a parameter.
    const parameters = list.filter((item) => item.type === 'parameter').map((item) => item.childForFieldName('pattern')?.text.replace(/^mut\s+/, '') ?? '');
    const visibility = hasChild(node, 'visibility_modifier') ? 'everywhere' : 'file';
    const impl = node.parent?.type === 'declaration_list' ? node.parent.parent : undefined;
    if (impl?.type === 'impl_item' || impl?.type === 'trait_item') {
      const qualifier = lastPart(impl.childForFieldName('type')?.text ?? impl.childForFieldName('name')?.text ?? '');
      return { name, parameters, kind: list[0]?.type === 'self_parameter' ? 'method' : 'associated', qualifier, visibility };
    }
    return { name, parameters, kind: 'function', visibility };
  }
  // Go: `func f(a, b string)` declares two parameters in one declaration; a lower-case name is private to its package.
  const parameters = list.flatMap((item) => item.childrenForFieldName('name').map((part) => part.text));
  if (node.type === 'method_declaration') return { name, parameters, kind: 'method', visibility: 'everywhere' };
  return { name, parameters, kind: 'function', visibility: /^\p{Lu}/u.test(name) ? 'everywhere' : 'package' };
}

/** The named function `node` is written in, if any. `cache` remembers each function already described. */
export function enclosingFunction(node: Node, cache?: Map<number, FunctionInfo | undefined>): FunctionInfo | undefined {
  for (let current = node.parent; current; current = current.parent) {
    if (!FUNCTIONS.has(current.type)) continue;
    if (cache?.has(current.id)) return cache.get(current.id);
    const info = functionOf(current);
    cache?.set(current.id, info);
    return info;
  }
  return undefined;
}

/** Adds a wrapper mark to a call's findings when its algorithm was not read and is a parameter of the function around it. */
export function markWrapper(findings: Finding[], rule: Rule, argument: Node | undefined, file: string): Finding[] {
  if (!rule.algorithmFrom || argument?.type !== 'identifier') return findings;
  const around = enclosingFunction(argument);
  const parameter = around?.parameters.indexOf(argument.text) ?? -1;
  if (!around || parameter < 0) return findings;
  return findings.map((item) => (item.status === 'unresolved' && item.algorithm === null
    ? { ...item, wrapper: { function: around, parameter, ruleId: rule.id, file, line: item.line, root: `${file}:${item.line}:${rule.id}` } }
    : item));
}

const STRINGS = new Set(['string_literal', 'raw_string_literal', 'interpreted_string_literal']);

/** What a call argument holds: a string as written, a name (`SHA256`, `crypto.SHA256`, `EVP_sha256()`), or neither. */
export function describeArgument(node: Node | undefined): Argument {
  let value = node;
  while (value && (value.type === 'parenthesized_expression' || value.type === 'reference_expression' || value.type === 'unary_expression') && value.namedChildCount === 1) value = value.namedChild(0)!;
  if (!value) return { kind: 'other' };
  if (STRINGS.has(value.type)) {
    const text = value.text.replace(/^[a-zA-Z]*(?=["`])/, '');
    return /^(["`])[^"`\\]*\1$/.test(text) ? { kind: 'string', value: text.slice(1, -1) } : { kind: 'other' };
  }
  if (value.type === 'number_literal' || value.type === 'int_literal' || value.type === 'integer_literal') return { kind: 'string', value: value.text };
  if (value.type === 'identifier' || value.type === 'type_identifier') return { kind: 'name', value: value.text };
  if (value.type === 'selector_expression') return { kind: 'name', value: value.childForFieldName('field')?.text ?? '' };
  if (value.type === 'scoped_identifier' || value.type === 'qualified_identifier') return { kind: 'name', value: lastPart(value.text) };
  if (value.type === 'call_expression') {
    const callee = describeArgument(value.childForFieldName('function') ?? undefined);
    return callee.kind === 'name' ? callee : { kind: 'other' };
  }
  return { kind: 'other' };
}

/** How a call names its function. */
function calleeOf(callee: Node | null): Pick<CallSite, 'name' | 'form' | 'qualifier'> | undefined {
  if (!callee) return undefined;
  if (callee.type === 'identifier') return { name: callee.text, form: 'plain' };
  if (callee.type === 'generic_function') return calleeOf(callee.childForFieldName('function'));
  if (callee.type === 'qualified_identifier' || callee.type === 'scoped_identifier') {
    const scope = callee.childForFieldName('scope') ?? callee.childForFieldName('path');
    const name = callee.childForFieldName('name');
    return name && NAMES.has(name.type) ? { name: name.text, form: 'qualified', qualifier: lastPart(scope?.text ?? '') } : undefined;
  }
  if (callee.type === 'field_expression' || callee.type === 'selector_expression') {
    const field = callee.childForFieldName('field');
    const value = callee.childForFieldName('argument') ?? callee.childForFieldName('value') ?? callee.childForFieldName('operand');
    return field ? { name: field.text, form: 'member', qualifier: value?.text } : undefined;
  }
  return undefined;
}

const callQueries = new Map<Language, Query>();

/**
 * The calls in `source`, parsed with `parser` (every grammar here names a call `call_expression`): all of them, or only
 * those to `names`.
 */
export function callSitesIn(parser: Parser, source: string, names?: ReadonlySet<string>): CallSite[] {
  const language = parser.language!;
  if (!callQueries.has(language)) callQueries.set(language, new Query(language, '(call_expression) @call'));
  const tree = parser.parse(source);
  if (!tree) return [];
  const sites: CallSite[] = [];
  const functions = new Map<number, FunctionInfo | undefined>();
  for (const { node: call } of callQueries.get(language)!.captures(tree.rootNode)) {
    const callee = calleeOf(call.childForFieldName('function'));
    if (!callee || (names && !names.has(callee.name))) continue;
    sites.push({ ...callee, line: call.startPosition.row + 1, args: (call.childForFieldName('arguments')?.namedChildren ?? []).map(describeArgument), enclosing: enclosingFunction(call, functions) });
  }
  // Trees live in the parser's WebAssembly memory, which JavaScript's garbage collector does not free.
  tree.delete();
  return sites;
}

/** A call found in the project: the file it is in, that file's language, and the call. */
export interface FoundCall { file: string; language: string; site: CallSite }

/** Whether `site`, in `file` (language `language`), can be a call to the wrapper `mark`, as the language allows. */
function canCall(mark: WrapperMark, site: CallSite, file: string, language: string): boolean {
  const fn = mark.function;
  if (fn.kind === 'method') return false;
  if (fn.visibility === 'file' && file !== mark.file) return false;
  if (fn.visibility === 'package' && dirname(file) !== dirname(mark.file)) return false;
  const go = mark.language === 'go';
  if (site.form === 'plain') {
    if (fn.kind === 'associated') return file === mark.file && site.enclosing?.qualifier === fn.qualifier;
    // Go calls a function of another package as pkg.F, and a C function as C.f.
    if (language === 'go') return go && dirname(file) === dirname(mark.file);
    return !go;
  }
  if (site.form === 'qualified') return fn.kind === 'associated' ? site.qualifier === fn.qualifier : !go;
  if (go) return fn.kind === 'function' && site.qualifier === basename(dirname(mark.file));
  return language === 'go' && site.qualifier === 'C';
}

export interface WrapperResult {
  /** Calls reported where they are: the algorithm was read from the value they pass. */
  findings: Finding[];
  /**
   * For each wrapper (by its crypto call, `file:line:ruleId`): the calls whose value could not be read, the functions that
   * pass their own parameter on to it, and how many calls were reported with the algorithm.
   */
  callers: Map<string, { unreadable: string[]; passedOn: string[]; resolved: number; mark: WrapperMark }>;
}

/**
 * Follows calls to wrappers, and to functions that pass their own parameter on to one, up to `depth` levels.
 * `calls(names)` returns every call to those names in the project. `existing` holds `file:line:ruleId` of the findings
 * already made, so a call the rules match directly is not reported twice.
 */
export function wrapperResult(marks: WrapperMark[], rulesById: Map<string, Rule>, calls: (names: ReadonlySet<string>) => FoundCall[], existing: ReadonlySet<string>, depth = 5): WrapperResult {
  const result: WrapperResult = { findings: [], callers: new Map() };
  const known = new Map<string, WrapperMark[]>();
  const add = (mark: WrapperMark): boolean => {
    const list = known.get(mark.function.name) ?? [];
    if (list.some((item) => item.file === mark.file && item.parameter === mark.parameter && item.ruleId === mark.ruleId)) return false;
    known.set(mark.function.name, [...list, mark]);
    if (!result.callers.has(mark.root)) result.callers.set(mark.root, { unreadable: [], passedOn: [], resolved: 0, mark });
    return true;
  };
  let pending = marks.filter(add);
  const seen = new Set<string>();
  for (let level = 0; level < depth && pending.length > 0; level++) {
    const next: WrapperMark[] = [];
    for (const { file, language, site } of calls(new Set(pending.map((mark) => mark.function.name)))) {
      const key = `${file}:${site.line}:${site.name}`;
      if (seen.has(key)) continue;
      // Recursion inside a wrapper chooses nothing new.
      const candidates = (known.get(site.name) ?? []).filter((mark) => canCall(mark, site, file, language) && !(site.enclosing?.name === mark.function.name && file === mark.file));
      if (candidates.length === 0) continue;
      seen.add(key);
      const unreadable = (mark: WrapperMark) => result.callers.get(mark.root)!.unreadable.push(`${file}:${site.line}`);
      const distinct = [...new Map(candidates.map((mark) => [`${mark.ruleId} ${mark.parameter}`, mark])).values()];
      // Two different wrappers could be meant: the value is not assigned to either.
      if (distinct.length > 1) {
        candidates.forEach(unreadable);
        continue;
      }
      const mark = distinct[0];
      if (existing.has(`${file}:${site.line}:${mark.ruleId}`)) continue;
      const rule = rulesById.get(mark.ruleId)!;
      const argument = site.args[mark.parameter];
      const through = `${mark.function.name}() (${mark.file}:${mark.line})`;
      if (argument?.kind === 'string' || (argument?.kind === 'name' && lookup(rule.values ?? {}, argument.value) !== undefined)) {
        result.callers.get(mark.root)!.resolved++;
        result.findings.push(...ruleFindings(rule, file, site.line, [{ note: `through ${through}` }], () => ({ names: [argument.value], qualifiers: [] }))
          .map((item) => ({ ...item, note: item.note ?? `Chosen here, and used as the algorithm by ${through}.` })));
        continue;
      }
      // The value is a parameter of the function the call is in: that function is a wrapper too.
      const passed = argument?.kind === 'name' && site.enclosing ? site.enclosing.parameters.indexOf(argument.value) : -1;
      if (passed >= 0) {
        const outer: WrapperMark = { function: site.enclosing!, parameter: passed, ruleId: mark.ruleId, file, line: site.line, root: mark.root, language };
        result.callers.get(mark.root)!.passedOn.push(`${outer.function.name}() (${file}:${site.line})`);
        if (add(outer)) next.push(outer);
        continue;
      }
      unreadable(mark);
    }
    pending = next;
  }
  return result;
}

/** The note for a wrapper's own crypto call, saying who chooses its algorithm and where. */
export function wrapperNote(mark: WrapperMark, unreadable: string[], passedOn: string[], resolved: number): string {
  const parameter = mark.function.parameters[mark.parameter];
  const parts = [`The algorithm is parameter ${mark.parameter + 1} ("${parameter}") of ${mark.function.name}(), so its callers choose it.`];
  if (resolved > 0) parts.push(`${resolved} call(s) that pass a value written in the code are reported where they are.`);
  if (passedOn.length > 0) parts.push(`${passedOn.length} function(s) pass their own parameter on to it, such as ${passedOn.slice(0, 3).join(', ')}, and their callers are followed too.`);
  if (unreadable.length > 0) {
    const examples = unreadable.slice(0, 3).join(', ');
    parts.push(`${unreadable.length} call(s) pass a value that cannot be read here, such as ${examples}; check those by hand.`);
  }
  if (resolved === 0 && unreadable.length === 0 && passedOn.length === 0) parts.push('No call to it was found in the scanned code; check where it is called.');
  return parts.join(' ');
}
