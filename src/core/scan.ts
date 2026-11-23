import { readFileSync, statSync } from 'node:fs';
import { basename, extname, relative } from 'node:path';
import { ESCAPING_REFERENCE_RULE_ID, UNRESOLVED_ALGORITHM_NOTE, finding } from './finding.ts';
import type { LanguageAdapter } from './language.ts';
import type { Finding, ModuleRules } from './types.ts';
import { sourceFiles } from './walk.ts';
import { languages } from '../languages/index.ts';

interface ScannedFile { path: string; text: string; name: string; adapter: LanguageAdapter; findings: Finding[] }

/** One file to scan: where it is, the name to report it under, and the language that reads it. */
export interface PlannedFile { path: string; name: string; adapter: LanguageAdapter }

/** Runs each adapter's one-time setup. Call once before `scan`. */
export async function loadLanguages(adapters: readonly LanguageAdapter[] = languages): Promise<void> {
  await Promise.all(adapters.map((adapter) => adapter.load?.()));
}

/** Every source file under `target` that one of `adapters` reads, in a fixed order. */
export function planScan(target: string, adapters: readonly LanguageAdapter[] = languages): { root: string | undefined; files: PlannedFile[] } {
  const root = statSync(target).isDirectory() ? target : undefined;
  const byExtension = new Map(adapters.flatMap((adapter) => adapter.extensions.map((extension) => [extension, adapter] as const)));
  const files = sourceFiles(target, new Set(byExtension.keys()))
    .map((path) => ({ path, name: root ? relative(root, path) : basename(path), adapter: byExtension.get(extname(path))! }));
  return { root, files };
}

/** One rules array per language for the whole scan, so adapters can build their lookup tables once and reuse them. */
export function rulesByAdapter(rules: ModuleRules[], adapters: readonly LanguageAdapter[] = languages): Map<LanguageAdapter, ModuleRules[]> {
  return new Map(adapters.map((adapter) => [adapter, rules.filter((group) => group.language === adapter.id)] as const));
}

/** The findings in one file. */
export function scanFile(file: PlannedFile, rulesFor: Map<LanguageAdapter, ModuleRules[]>): Finding[] {
  return file.adapter.scanSource(readFileSync(file.path, 'utf8'), file.name, rulesFor.get(file.adapter)!);
}

/** Adds the cross-file findings to the per-file findings (in plan order) and returns them all. */
export function finishScan(root: string | undefined, files: PlannedFile[], findings: Finding[][]): Finding[] {
  const scanned: ScannedFile[] = files.map((file, index) => ({ ...file, findings: findings[index], text: '' }));
  if (root) addWrapperFindings(scanned);
  return scanned.flatMap((item) => item.findings);
}

/** Scan a file or folder with every registered language, giving each adapter only the rules for its own language. */
export function scan(target: string, rules: ModuleRules[], adapters: readonly LanguageAdapter[] = languages): Finding[] {
  const { root, files } = planScan(target, adapters);
  const rulesFor = rulesByAdapter(rules, adapters);
  return finishScan(root, files, files.map((file) => scanFile(file, rulesFor)));
}

// A module whose algorithm comes from a parameter (or that lets a crypto reference escape) is a wrapper: its importers
// may be choosing the algorithm, and that flow is not tracked across files.
function addWrapperFindings(files: ScannedFile[]): void {
  const isDynamic = (entry: Finding): boolean => entry.ruleId === ESCAPING_REFERENCE_RULE_ID || entry.note === UNRESOLVED_ALGORITHM_NOTE;
  for (const adapter of new Set(files.map((item) => item.adapter))) {
    if (!adapter.localImports || !adapter.resolveImport) continue;
    const own = files.filter((item) => item.adapter === adapter);
    for (const item of own) item.text = readFileSync(item.path, 'utf8');
    const known = new Set(own.map((item) => item.path));
    const bearing = new Map(own.map((item) => [item.path, item.findings.filter(isDynamic).length] as const).filter(([, count]) => count > 0));
    for (const item of own) {
      const reported = new Set<string>();
      for (const { specifier, line } of adapter.localImports(item.text, item.name)) {
        const resolved = adapter.resolveImport(item.path, specifier, known);
        if (!resolved || resolved === item.path || !bearing.has(resolved) || reported.has(resolved)) continue;
        reported.add(resolved);
        item.findings.push(finding(item.name, line, 'crypto-via-local-module', 'unknown', null, 'unresolved',
          `Imports ${specifier}, which has ${bearing.get(resolved)} crypto call(s) whose algorithm is decided by its callers; that flow is not tracked across files.`));
      }
      item.findings.sort((left, right) => left.line - right.line);
    }
  }
}
