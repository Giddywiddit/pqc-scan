import type { Node, Parser } from 'web-tree-sitter';
import type { LanguageAdapter } from '../../core/language.ts';
import { ruleFindings } from '../../core/match.ts';
import { LineReporter, indexRules } from '../../core/matcher.ts';
import { createParser } from '../../core/tree-sitter.ts';
import type { Finding, ModuleRules, Rule } from '../../core/types.ts';

let parser: Parser | undefined;

interface Binding { path: string; }

function dotted(node: Node | undefined): string {
  return node?.text ?? '';
}

function imports(root: Node): Map<string, Binding> {
  const result = new Map<string, Binding>();
  const walk = (node: Node): void => {
    if (node.type === 'import_statement') {
      for (const item of node.namedChildren) {
        const path = item.type === 'aliased_import' ? item.childForFieldName('name')?.text ?? '' : dotted(item);
        const alias = item.type === 'aliased_import' ? item.childForFieldName('alias')?.text : path.split('.')[0];
        if (path && alias) result.set(alias, { path });
      }
    } else if (node.type === 'import_from_statement') {
      const module = node.namedChildren.find((child) => child.type === 'dotted_name')?.text ?? '';
      for (const item of node.namedChildren.filter((child) => child.type === 'dotted_name' || child.type === 'aliased_import').slice(1)) {
        const name = item.type === 'aliased_import' ? item.childForFieldName('name')?.text ?? '' : item.text;
        const alias = item.type === 'aliased_import' ? item.childForFieldName('alias')?.text : name;
        if (name && alias) result.set(alias, { path: `${module}.${name}` });
      }
    }
    for (const child of node.namedChildren) walk(child);
  };
  walk(root);
  return result;
}

function callPath(node: Node): string | null {
  const functionNode = node.childForFieldName('function');
  if (!functionNode) return null;
  const parts: string[] = [];
  let current: Node | null = functionNode;
  while (current) {
    if (current.type === 'identifier') parts.unshift(current.text);
    else if (current.type === 'attribute') {
      const attr = current.childForFieldName('attribute');
      if (attr) parts.unshift(attr.text);
      current = current.childForFieldName('object');
      continue;
    } else return null;
    break;
  }
  return parts.join('.');
}

function argumentsOf(node: Node): Node[] {
  return node.childForFieldName('arguments')?.namedChildren ?? [];
}

function argumentNames(node: Node | null | undefined): string[] | null {
  if (!node) return null;
  if (node.type === 'string') return [node.text.slice(1, -1)];
  if (node.type === 'integer') return [node.text];
  if (node.type === 'keyword_argument') return argumentNames(node.childForFieldName('value'));
  return null;
}

function ruleFor(path: string, lookup: ReturnType<typeof indexRules>): Rule | undefined {
  return lookup.functions.get(path) ?? lookup.names.get(path);
}

function shadowedNames(root: Node): Array<{ start: number; end: number; names: Set<string> }> {
  const ranges: Array<{ start: number; end: number; names: Set<string> }> = [];
  const walk = (node: Node): void => {
    if (node.type === 'function_definition') {
      const names = new Set<string>();
      const parameters = node.childForFieldName('parameters');
      for (const parameter of parameters?.namedChildren ?? []) {
        const name = parameter.type === 'identifier' ? parameter.text : parameter.childForFieldName('name')?.text;
        if (name) names.add(name);
      }
      const collectAssignments = (child: Node): void => {
        if (child.type === 'assignment') {
          const left = child.childForFieldName('left');
          if (left?.type === 'identifier') names.add(left.text);
        }
        for (const nested of child.namedChildren) collectAssignments(nested);
      };
      const body = node.childForFieldName('body');
      if (body) collectAssignments(body);
      ranges.push({ start: node.startIndex, end: node.endIndex, names });
    }
    for (const child of node.namedChildren) walk(child);
  };
  walk(root);
  return ranges;
}

function scanSource(text: string, file: string, rules: ModuleRules[]): Finding[] {
  if (!parser) throw new Error('The Python grammar is not loaded: call loadLanguages() before scanning.');
  const tree = parser.parse(text);
  if (!tree) throw new Error(`${file}: the Python parser returned no tree.`);
  const bindings = imports(tree.rootNode);
  const shadows = shadowedNames(tree.rootNode);
  const lookup = indexRules(rules.filter((group) => group.language === 'python'));
  const findings: Finding[] = [];
  const reporter = new LineReporter(file, findings);
  const errors: Node[] = [];
  const walk = (node: Node): void => {
    if (node.type === 'ERROR') errors.push(node);
    if (node.type === 'call') {
      const path = callPath(node);
      if (path) {
        const [head, ...rest] = path.split('.');
        const binding = bindings.get(head);
        const shadow = shadows.some((range) => node.startIndex >= range.start && node.endIndex <= range.end && range.names.has(head));
        const full = binding ? [binding.path, ...rest].join('.') : null;
        const rule = full ? ruleFor(full, lookup) : undefined;
        if (rule && !shadow) {
          const args = argumentsOf(node);
          const value = rule.algorithmFrom ? argumentNames(args[rule.algorithmFrom.arg]) : null;
          const result = ruleFindings(rule, file, node.startPosition.row + 1, [{ note: `matched ${full}` }], () => ({ names: value, qualifiers: [] }));
          reporter.call(rule, node.startPosition.row + 1, result);
        }
      }
    }
    for (const child of node.namedChildren) walk(child);
  };
  walk(tree.rootNode);
  if (errors.length > 0) findings.push({ ruleId: 'parse-error', file, line: errors[0].startPosition.row + 1, algorithm: null, category: 'unknown', status: 'unresolved', trace: [], note: 'Source could not be parsed completely.' });
  tree.delete();
  return findings.sort((a, b) => a.line - b.line);
}

export async function loadPython(): Promise<void> { parser ??= await createParser('python'); }

export const python: LanguageAdapter = {
  id: 'python',
  extensions: ['.py', '.pyw'],
  load: loadPython,
  scanSource,
};
