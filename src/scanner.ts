import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import ts from 'typescript';
import type { Finding, ModuleRules, Rule, Status } from './types.ts';

interface Binding { module: string; imported?: string; }

const extensions = new Set(['.js', '.cjs', '.mjs', '.jsx', '.ts', '.cts', '.mts', '.tsx']);

function moduleMatches(left: string, right: string): boolean {
  return left.replace(/^node:/, '') === right.replace(/^node:/, '');
}

function sourceFiles(target: string): string[] {
  if (!statSync(target).isDirectory()) return extensions.has(extname(target)) ? [target] : [];
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (['.git', 'dist', 'node_modules'].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && extensions.has(extname(entry.name))) found.push(path);
    }
  };
  walk(target);
  return found;
}

function literal(node: ts.Expression | undefined, declarations: Map<string, ts.VariableDeclaration | null>): string | null {
  if (!node) return null;
  while (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isTypeAssertionExpression(node)) node = node.expression;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isIdentifier(node)) {
    const declaration = declarations.get(node.text);
    if (declaration && (declaration.parent.flags & ts.NodeFlags.Const) !== 0) return literal(declaration.initializer, declarations);
  }
  return null;
}

function propertyLiteral(node: ts.Expression | undefined, property: string, declarations: Map<string, ts.VariableDeclaration | null>): string | null {
  if (!node) return null;
  while (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isTypeAssertionExpression(node)) node = node.expression;
  if (ts.isIdentifier(node)) {
    const declaration = declarations.get(node.text);
    if (declaration && (declaration.parent.flags & ts.NodeFlags.Const) !== 0) return propertyLiteral(declaration.initializer, property, declarations);
  }
  if (!ts.isObjectLiteralExpression(node)) return null;
  const value = node.properties.find((item) => ts.isPropertyAssignment(item) && item.name.getText() === property);
  return value && ts.isPropertyAssignment(value) ? literal(value.initializer, declarations) : null;
}

function callTarget(expression: ts.LeftHandSideExpression, bindings: Map<string, Binding | null>, declarations: Map<string, ts.VariableDeclaration | null>): Binding | null {
  if (ts.isIdentifier(expression)) return bindings.get(expression.text) ?? null;
  if (ts.isPropertyAccessExpression(expression)) {
    const parent = callTarget(expression.expression, bindings, declarations);
    return parent ? { ...parent, imported: expression.name.text } : null;
  }
  if (ts.isElementAccessExpression(expression)) {
    const parent = callTarget(expression.expression, bindings, declarations);
    const name = literal(expression.argumentExpression, declarations);
    return parent && name ? { ...parent, imported: name } : null;
  }
  return null;
}

function addImports(source: ts.SourceFile, bindings: Map<string, Binding | null>, declarations: Map<string, ts.VariableDeclaration | null>): void {
  const bind = (name: string, value: Binding): void => {
    bindings.set(name, bindings.has(name) ? null : value);
  };
  const declare = (name: string, value: ts.VariableDeclaration): void => {
    declarations.set(name, declarations.has(name) ? null : value);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.importClause) {
      const module = node.moduleSpecifier.text;
      const clause = node.importClause;
      if (clause.name) bind(clause.name.text, { module });
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) bind(clause.namedBindings.name.text, { module });
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const item of clause.namedBindings.elements) {
        bind(item.name.text, { module, imported: item.propertyName?.text ?? item.name.text });
      }
    }
    if (ts.isVariableDeclaration(node)) {
      if (ts.isIdentifier(node.name)) declare(node.name.text, node);
      const initializer = node.initializer;
      if (initializer && ts.isCallExpression(initializer) && ts.isIdentifier(initializer.expression) && initializer.expression.text === 'require' && ts.isStringLiteralLike(initializer.arguments[0])) {
        const module = initializer.arguments[0].text;
        if (ts.isIdentifier(node.name)) bind(node.name.text, { module });
        if (ts.isObjectBindingPattern(node.name)) for (const item of node.name.elements) {
          if (ts.isIdentifier(item.name)) bind(item.name.text, { module, imported: item.propertyName?.getText() ?? item.name.text });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function findModuleRules(rules: ModuleRules[], target: Binding): ModuleRules | undefined {
  return rules.find((group) => group.module.some((item) => moduleMatches(item, target.module)));
}

function finding(file: string, line: number, ruleId: string, category: Finding['category'], algorithm: string | null, status: Status, note?: string, trace: Finding['trace'] = []): Finding {
  return { file, line, ruleId, category, algorithm, status, note, trace };
}

export function scanSource(text: string, file: string, rules: ModuleRules[]): Finding[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const diagnostics = (source as ts.SourceFile & { parseDiagnostics: readonly ts.DiagnosticWithLocation[] }).parseDiagnostics;
  if (diagnostics.length > 0) {
    const diagnostic = diagnostics[0];
    const line = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1;
    return [finding(file, line, 'parse-error', 'unknown', null, 'unresolved', `Source could not be parsed: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`)];
  }
  const bindings = new Map<string, Binding | null>();
  const declarations = new Map<string, ts.VariableDeclaration | null>();
  addImports(source, bindings, declarations);
  const findings: Finding[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const target = callTarget(node.expression, bindings, declarations);
      if (target) {
        const moduleRules = findModuleRules(rules, target);
        const rule = moduleRules?.rules.find((candidate) => candidate.functions.includes(target.imported ?? ''));
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        const trace = [{ note: `resolved ${target.imported ?? 'module'} from ${target.module}` }];
        if (!moduleRules) {
          // A local function or unrelated package may share a crypto-like API name.
        } else if (!rule) {
          findings.push(finding(file, line, 'unhandled-crypto-api', 'unknown', null, 'unresolved', `Recognized crypto module call "${target.imported ?? 'unknown'}" has no rule.`, trace));
        } else if (rule.algorithm && rule.status) {
          findings.push(finding(file, line, rule.id, rule.category, rule.algorithm, rule.status, undefined, trace));
        } else if (rule.algorithmFrom) {
          const argument = node.arguments[rule.algorithmFrom.arg];
          const value = rule.algorithmFrom.property
            ? propertyLiteral(argument, rule.algorithmFrom.property, declarations)
            : literal(argument, declarations);
          const match = value === null ? undefined : rule.values?.[value] ?? rule.values?.[value.toLowerCase()];
          if (!match) findings.push(finding(file, line, rule.id, rule.category, null, 'unresolved', value === null ? 'Algorithm could not be statically resolved.' : `Algorithm "${value}" has no rule.`, trace));
          else findings.push(finding(file, line, rule.id, rule.category, match.algorithm, match.status, match.note, trace));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

export function scan(target: string, rules: ModuleRules[]): Finding[] {
  const root = statSync(target).isDirectory() ? target : undefined;
  return sourceFiles(target).flatMap((path) => scanSource(readFileSync(path, 'utf8'), root ? relative(root, path) : basename(path), rules));
}
