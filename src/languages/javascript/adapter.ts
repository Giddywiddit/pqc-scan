import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';
import { ESCAPING_REFERENCE_RULE_ID, finding } from '../../core/finding.ts';
import { ruleFindings } from '../../core/match.ts';
import type { LanguageAdapter } from '../../core/language.ts';
import type { Finding, ModuleRules } from '../../core/types.ts';

interface Binding { module: string; imported?: string; }

const globals = new Set(['globalThis', 'window', 'self']);

function moduleMatches(left: string, right: string): boolean {
  return left.replace(/^node:/, '') === right.replace(/^node:/, '');
}

function literal(node: ts.Expression | undefined, declarations: Map<string, ts.VariableDeclaration | null>): string | null {
  if (!node) return null;
  while (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isTypeAssertionExpression(node)) node = node.expression;
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
  if (ts.isIdentifier(node)) {
    const declaration = declarations.get(node.text);
    if (declaration && (declaration.parent.flags & ts.NodeFlags.Const) !== 0) return literal(declaration.initializer, declarations);
  }
  return null;
}

type Declarations = Map<string, ts.VariableDeclaration | null>;

// Strips wrappers and follows const identifiers to the expression they hold.
function resolveConst(node: ts.Expression | undefined, declarations: Declarations): ts.Expression | undefined {
  while (node && (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isTypeAssertionExpression(node))) node = node.expression;
  if (node && ts.isIdentifier(node)) {
    const declaration = declarations.get(node.text);
    if (declaration && (declaration.parent.flags & ts.NodeFlags.Const) !== 0) return resolveConst(declaration.initializer, declarations);
  }
  return node;
}

// Walks a dotted property path (`header.alg`) through object literals.
function propertyNode(node: ts.Expression | undefined, path: string[], declarations: Declarations): ts.Expression | undefined {
  let current = resolveConst(node, declarations);
  for (const key of path) {
    if (!current || !ts.isObjectLiteralExpression(current)) return undefined;
    const found = current.properties.find((item) => ts.isPropertyAssignment(item) && item.name.getText() === key);
    current = found && ts.isPropertyAssignment(found) ? resolveConst(found.initializer, declarations) : undefined;
  }
  return current;
}

function propertyLiteral(node: ts.Expression | undefined, property: string, declarations: Declarations): string | null {
  const value = propertyNode(node, property.split('.'), declarations);
  if (!value) return null;
  return literal(value, declarations) ?? (property === 'name' ? null : propertyLiteral(value, 'name', declarations));
}

// A property holding one string, or an array literal of strings (e.g. jsonwebtoken `algorithms`).
function propertyLiterals(node: ts.Expression | undefined, property: string, declarations: Declarations): string[] | null {
  const value = propertyNode(node, property.split('.'), declarations);
  if (value && ts.isArrayLiteralExpression(value)) {
    const items = value.elements.map((item) => literal(item, declarations));
    return items.length > 0 && items.every((item): item is string => item !== null) ? items : null;
  }
  const single = propertyLiteral(node, property, declarations);
  return single === null ? null : [single];
}

// Scopes that declare each name (variables, parameters, functions, classes), per source file.
const scopesByFile = new WeakMap<ts.SourceFile, Map<string, ts.Node[]>>();

function declaredNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((item) => (ts.isOmittedExpression(item) ? [] : declaredNames(item.name)));
}

function scopeOf(node: ts.Node, blockScoped: boolean): ts.Node {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionLike(current) || ts.isSourceFile(current) || ts.isClassStaticBlockDeclaration(current)) return current;
    if (blockScoped && (ts.isBlock(current) || ts.isCatchClause(current) || ts.isForStatement(current) || ts.isForInStatement(current) || ts.isForOfStatement(current) || ts.isCaseBlock(current))) return current;
  }
  return node.getSourceFile();
}

function recordScopes(source: ts.SourceFile): void {
  const scopes = new Map<string, ts.Node[]>();
  const add = (name: string, scope: ts.Node): void => { scopes.set(name, [...(scopes.get(name) ?? []), scope]); };
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      const blockScoped = ts.isCatchClause(node.parent) || (ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.BlockScoped) !== 0);
      for (const name of declaredNames(node.name)) add(name, scopeOf(node, blockScoped));
    } else if (ts.isParameter(node)) {
      for (const name of declaredNames(node.name)) add(name, node.parent);
    } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
      add(node.name.text, scopeOf(node, true));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  scopesByFile.set(source, scopes);
}

// True when `name` is redeclared in a scope enclosing `use`. A file-level declaration of a bound name is the binding itself.
function isShadowed(use: ts.Node, name: string, bound: boolean): boolean {
  const source = use.getSourceFile();
  return (scopesByFile.get(source)?.get(name) ?? []).some((scope) => (!bound || !ts.isSourceFile(scope)) && use.pos >= scope.pos && use.end <= scope.end);
}

function callTarget(expression: ts.LeftHandSideExpression, bindings: Map<string, Binding | null>, declarations: Map<string, ts.VariableDeclaration | null>): Binding | null {
  const extend = (parent: Binding | null, name: string | null): Binding | null =>
    parent && name ? { ...parent, imported: parent.imported ? `${parent.imported}.${name}` : name } : null;
  if (ts.isIdentifier(expression)) {
    const bound = bindings.has(expression.text);
    if (isShadowed(expression, expression.text, bound)) return null;
    if (bound) return bindings.get(expression.text) ?? null;
    // An undeclared `crypto` is the WebCrypto global.
    return expression.text === 'crypto' ? { module: 'crypto' } : null;
  }
  if (ts.isCallExpression(expression) && expression.arguments.length === 1 && ts.isIdentifier(expression.expression) && expression.expression.text === 'require' && !bindings.has('require')) {
    const module = literal(expression.arguments[0], declarations);
    return module === null ? null : { module };
  }
  if (ts.isPropertyAccessExpression(expression)) {
    if (ts.isIdentifier(expression.expression) && globals.has(expression.expression.text) && expression.name.text === 'crypto' && !bindings.has(expression.expression.text) && !isShadowed(expression.expression, expression.expression.text, false)) return { module: 'crypto' };
    return extend(callTarget(expression.expression, bindings, declarations), expression.name.text);
  }
  if (ts.isElementAccessExpression(expression)) {
    return extend(callTarget(expression.expression, bindings, declarations), literal(expression.argumentExpression, declarations));
  }
  return null;
}

function addImports(source: ts.SourceFile, rules: ModuleRules[], bindings: Map<string, Binding | null>, declarations: Map<string, ts.VariableDeclaration | null>): void {
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
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  // Second pass: aliases, destructuring from a bound module, and dynamic require/import with constant specifiers.
  const pending: ts.VariableDeclaration[] = [];
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) pending.push(node);
    ts.forEachChild(node, collect);
  };
  collect(source);
  const moduleOf = (expression: ts.Expression, isConst: boolean): Binding | null => {
    while (ts.isAwaitExpression(expression) || ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)) expression = expression.expression;
    if (ts.isNewExpression(expression)) {
      const made = callTarget(expression.expression as ts.LeftHandSideExpression, bindings, declarations);
      return made && findModuleRules(rules, made)?.constructs?.includes(made.imported ?? '') ? { module: 'crypto' } : null;
    }
    if (ts.isCallExpression(expression) && expression.arguments.length === 1) {
      const callee = expression.expression;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require' && !bindings.has('require');
      if (isRequire || callee.kind === ts.SyntaxKind.ImportKeyword) {
        const module = literal(expression.arguments[0], declarations);
        return module === null ? null : { module };
      }
      return null;
    }
    return isConst && (ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression))
      ? callTarget(expression, bindings, declarations)
      : null;
  };
  for (let changed = true, rounds = 0; changed && rounds < 5; rounds++) {
    changed = false;
    for (let index = pending.length - 1; index >= 0; index--) {
      const node = pending[index];
      const source = moduleOf(node.initializer!, (node.parent.flags & ts.NodeFlags.Const) !== 0);
      if (!source) continue;
      pending.splice(index, 1);
      changed = true;
      const join = (name: string): Binding => ({ ...source, imported: source.imported ? `${source.imported}.${name}` : name });
      if (ts.isIdentifier(node.name)) bind(node.name.text, source);
      else if (ts.isObjectBindingPattern(node.name)) for (const item of node.name.elements) {
        if (ts.isIdentifier(item.name) && !item.dotDotDotToken) bind(item.name.text, join(item.propertyName?.getText() ?? item.name.text));
      }
    }
  }
}

// A reference that is stored, passed, or returned rather than called, so later uses cannot be followed.
function isEscape(node: ts.Node): boolean {
  if (!ts.isIdentifier(node) && !ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return false;
  const parent = node.parent;
  if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isCallExpression(parent)) return parent.arguments.includes(node as ts.Expression);
  if (ts.isNewExpression(parent)) return parent.arguments?.includes(node as ts.Expression) ?? false;
  if (ts.isPropertyAssignment(parent)) return parent.initializer === node;
  if (ts.isShorthandPropertyAssignment(parent)) return parent.name === node;
  if (ts.isVariableDeclaration(parent)) return parent.initializer === node && (!ts.isIdentifier(parent.name) && !ts.isObjectBindingPattern(parent.name) || (parent.parent.flags & ts.NodeFlags.Const) === 0);
  return ts.isArrayLiteralExpression(parent) || ts.isSpreadElement(parent) || ts.isReturnStatement(parent) || ts.isExportAssignment(parent)
    || (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && parent.right === node);
}

function findModuleRules(rules: ModuleRules[], target: Binding): ModuleRules | undefined {
  return rules.find((group) => group.module.some((item) => moduleMatches(item, target.module)));
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
  recordScopes(source);
  addImports(source, rules, bindings, declarations);
  const findings: Finding[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const found = callTarget(node.expression, bindings, declarations);
      if (found) {
        let target = found;
        let args: readonly ts.Expression[] = node.arguments;
        const via = /^(.*)\.(call|apply)$/.exec(found.imported ?? '');
        if (via && findModuleRules(rules, found)?.rules.some((candidate) => candidate.functions.includes(via[1]))) {
          target = { ...found, imported: via[1] };
          const list = node.arguments[1];
          args = via[2] === 'call' ? node.arguments.slice(1) : list && ts.isArrayLiteralExpression(list) ? list.elements : [];
        }
        const moduleRules = findModuleRules(rules, target);
        const rule = moduleRules?.rules.find((candidate) => candidate.functions.includes(target.imported ?? ''));
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        const trace = [{ note: `resolved ${target.imported ?? 'module'} from ${target.module}` }];
        if (!moduleRules) {
          // A local function or unrelated package may share a crypto-like API name.
        } else if (!rule) {
          findings.push(finding(file, line, 'unhandled-crypto-api', 'unknown', null, 'unresolved', `Recognized crypto module call "${target.imported ?? 'unknown'}" has no rule.`, trace));
        } else {
          findings.push(...ruleFindings(rule, file, line, trace, () => {
            const argument = args[rule.algorithmFrom!.arg];
            const single = literal(argument, declarations);
            const property = rule.algorithmFrom!.property;
            const names = property ? propertyLiterals(argument, property, declarations) ?? (single === null ? null : [single]) : single === null ? null : [single];
            const qualifiers = (rule.qualifiers ?? []).map((item) => propertyLiteral(argument, item, declarations)).filter((item): item is string => item !== null);
            return { names, qualifiers };
          }));
        }
      }
    }
    if (isEscape(node)) {
      const target = callTarget(node as ts.LeftHandSideExpression, bindings, declarations);
      const moduleRules = target && findModuleRules(rules, target);
      const known = target && moduleRules && (target.imported === undefined || moduleRules.rules.some((rule) => rule.functions.includes(target.imported!)));
      if (target && known) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        findings.push(finding(file, line, ESCAPING_REFERENCE_RULE_ID, 'unknown', null, 'unresolved', `Reference to ${target.imported ?? target.module} is stored or passed as a value; later calls cannot be tracked.`, [{ note: `resolved ${target.imported ?? 'module'} from ${target.module}` }]));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

const resolvable = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];

function localImports(text: string, file: string): { specifier: string; line: number }[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: { specifier: string; line: number }[] = [];
  const add = (node: ts.Node, specifier: string | undefined): void => {
    if (specifier?.startsWith('.')) found.push({ specifier, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      if (specifier && ts.isStringLiteral(specifier)) add(node, specifier.text);
    }
    if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])
      && ((ts.isIdentifier(node.expression) && node.expression.text === 'require') || node.expression.kind === ts.SyntaxKind.ImportKeyword)) add(node, node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function resolveLocal(from: string, specifier: string, known: Set<string>): string | undefined {
  const base = resolve(dirname(from), specifier);
  const stem = base.replace(/\.(m|c)?jsx?$/, '');
  const candidates = [base, ...resolvable.flatMap((ext) => [base + ext, stem + ext, join(base, `index${ext}`)])];
  return candidates.find((candidate) => known.has(candidate));
}

export const javascript: LanguageAdapter = {
  id: 'javascript',
  extensions: ['.js', '.cjs', '.mjs', '.jsx', '.ts', '.cts', '.mts', '.tsx'],
  scanSource,
  localImports,
  resolveImport: resolveLocal,
};
