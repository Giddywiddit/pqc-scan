import { readFileSync, statSync } from 'node:fs';
import { basename, extname, relative } from 'node:path';
import { ESCAPING_REFERENCE_RULE_ID, UNRESOLVED_ALGORITHM_NOTE, finding } from './finding.ts';
import type { LanguageAdapter } from './language.ts';
import type { Finding, ModuleRules } from './types.ts';
import { sourceFiles } from './walk.ts';
import { languages } from '../languages/index.ts';

interface ScannedFile { path: string; text: string; name: string; adapter: LanguageAdapter; findings: Finding[] }

/** Scan a file or folder with every registered language, giving each adapter only the rules for its own language. */
export function scan(target: string, rules: ModuleRules[], adapters: readonly LanguageAdapter[] = languages): Finding[] {
  const root = statSync(target).isDirectory() ? target : undefined;
  const byExtension = new Map(adapters.flatMap((adapter) => adapter.extensions.map((extension) => [extension, adapter] as const)));
  const files: ScannedFile[] = sourceFiles(target, new Set(byExtension.keys())).map((path) => {
    const adapter = byExtension.get(extname(path))!;
    const text = readFileSync(path, 'utf8');
    const name = root ? relative(root, path) : basename(path);
    return { path, text, name, adapter, findings: adapter.scanSource(text, name, rules.filter((group) => group.language === adapter.id)) };
  });
  if (root) addWrapperFindings(files);
  return files.flatMap((item) => item.findings);
}

// A module whose algorithm comes from a parameter (or that lets a crypto reference escape) is a wrapper: its importers
// may be choosing the algorithm, and that flow is not tracked across files.
function addWrapperFindings(files: ScannedFile[]): void {
  const isDynamic = (entry: Finding): boolean => entry.ruleId === ESCAPING_REFERENCE_RULE_ID || entry.note === UNRESOLVED_ALGORITHM_NOTE;
  for (const adapter of new Set(files.map((item) => item.adapter))) {
    if (!adapter.localImports || !adapter.resolveImport) continue;
    const own = files.filter((item) => item.adapter === adapter);
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
