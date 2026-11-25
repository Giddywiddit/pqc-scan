import { readFileSync, statSync } from 'node:fs';
import { basename, extname, relative, sep } from 'node:path';
import { ESCAPING_REFERENCE_RULE_ID, UNRESOLVED_ALGORITHM_NOTE, finding } from './finding.ts';
import type { LanguageAdapter } from './language.ts';
import type { Finding, FunctionInfo, ModuleRules } from './types.ts';
import { sourceFiles } from './walk.ts';
import { escape } from './syntax.ts';
import { type CallSite, wrapperNote, wrapperResult } from './wrappers.ts';
import { languages } from '../languages/index.ts';

interface ScannedFile { path: string; text: string; name: string; adapter: LanguageAdapter; findings: Finding[] }

/** One file to scan: where it is, the name to report it under, and the language that reads it. */
export interface PlannedFile { path: string; name: string; adapter: LanguageAdapter }

/** Runs each adapter's one-time setup. Call once before `scan`. */
export async function loadLanguages(adapters: readonly LanguageAdapter[] = languages): Promise<void> {
  await Promise.all(adapters.map((adapter) => adapter.load?.()));
}

/** Every source file under `target` that one of `adapters` reads, in a fixed order. */
export function planScan(target: string, adapters: readonly LanguageAdapter[] = languages): { root: string | undefined; files: PlannedFile[]; unreadable: Finding[] } {
  const root = statSync(target).isDirectory() ? target : undefined;
  const byExtension = new Map(adapters.flatMap((adapter) => adapter.extensions.map((extension) => [extension, adapter] as const)));
  const skipped: string[] = [];
  // Reported file names use `/` on every system, so reports and baselines are the same on Windows.
  const nameOf = (path: string): string => (root ? relative(root, path) : basename(path)).split(sep).join('/');
  const files = sourceFiles(target, new Set(byExtension.keys()), skipped)
    .map((path) => ({ path, name: nameOf(path), adapter: byExtension.get(extname(path))! }));
  return { root, files, unreadable: skipped.map((path) => unreadableFinding(nameOf(path) || '.')) };
}

/** One rules array per language for the whole scan, so adapters can build their lookup tables once and reuse them. */
export function rulesByAdapter(rules: ModuleRules[], adapters: readonly LanguageAdapter[] = languages): Map<LanguageAdapter, ModuleRules[]> {
  return new Map(adapters.map((adapter) => {
    const folders = [adapter.id, ...(adapter.alsoUsesRulesOf ?? [])];
    return [adapter, rules.filter((group) => folders.includes(group.language))] as const;
  }));
}

/** Files larger than this are not read (`--max-file-size`). The largest source file in the projects tested is 9.1 MB. */
export const DEFAULT_MAX_FILE_BYTES = 20 * 1024 * 1024;

/** The finding for a file too large to read: reported, not skipped, so a large file cannot hide anything. */
export function tooLargeFinding(name: string, bytes: number, maxBytes: number): Finding {
  const mb = (size: number) => `${Number((size / 1024 / 1024).toFixed(1))} MB`;
  return finding(name, 1, 'file-too-large', 'unknown', null, 'unresolved',
    `Not scanned: the file is ${mb(bytes)}, over the ${mb(maxBytes)} limit. Check it by hand, or scan it with a higher --max-file-size.`);
}

/** The finding for a file or folder that could not be read: reported, not skipped, so it cannot hide anything. */
export function unreadableFinding(name: string): Finding {
  return finding(name, 1, 'path-unreadable', 'unknown', null, 'unresolved', 'Not scanned: pqc-scan could not read this file or folder (no permission). Check it by hand, or scan it with access.');
}

/** The findings in one file. */
export function scanFile(file: PlannedFile, rulesFor: Map<LanguageAdapter, ModuleRules[]>, maxBytes = DEFAULT_MAX_FILE_BYTES): Finding[] {
  const bytes = statSync(file.path).size;
  if (bytes > maxBytes) return [tooLargeFinding(file.name, bytes, maxBytes)];
  return file.adapter.scanSource(readFileSync(file.path, 'utf8'), file.name, rulesFor.get(file.adapter)!);
}

/** Adds the cross-file findings to the per-file findings (in plan order) and returns them all. */
export function finishScan(root: string | undefined, files: PlannedFile[], findings: Finding[][], rules: ModuleRules[], prefetched?: ReadonlyMap<string, CallSite[]>, unreadable: Finding[] = []): Finding[] {
  const scanned: ScannedFile[] = files.map((file, index) => ({ ...file, findings: findings[index], text: '' }));
  if (root) addWrapperFindings(scanned);
  addCallsToWrappers(scanned, rules, prefetched);
  // The wrapper marks are only for the step above; they are not part of a finding as reported.
  return [...scanned.flatMap((item) => item.findings.map(({ wrapper: _wrapper, ...finding }) => finding)), ...unreadable];
}

/**
 * Follows functions whose crypto algorithm is one of their parameters to where they are called (see wrappers.ts), in
 * every file of a language that can call them: the same language, or one that uses its rules (C functions are called
 * from C++, and from Go through cgo). Files are read only if they mention a wrapper's name.
 */
/**
 * The functions the rules name, as a library's own source defines them: `wc_AesGcmSetKey` (C), `HashFunction::create`
 * (C++, relative to the namespace), `MessageDigest::from_name` (the last two parts of a Rust path) and
 * `GetSigningMethod` (the member of a Go name). Calls to these are matched by the rules directly.
 */
function ruleFunctionNames(rules: ModuleRules[], adapter: LanguageAdapter): Set<string> {
  const folders = [adapter.id, ...(adapter.alsoUsesRulesOf ?? [])];
  return new Set(rules.filter((group) => folders.includes(group.language)).flatMap((group) => group.rules.flatMap((rule) => rule.functions.map((name) => {
    if (group.language === 'rust') return name.split('::').slice(-2).join('::');
    if (group.language === 'go') return name.slice(name.lastIndexOf('.') + 1);
    return name;
  }))));
}
/** How a wrapper is named for that comparison: with its class or type when it has one. */
const definedAs = (fn: FunctionInfo) => (fn.qualifier ? `${fn.qualifier}::${fn.name}` : fn.name);

/** The files the first round of following wrappers reads: those that call a wrapper by name. For parsing ahead on threads. */
export function wrapperCallerFiles(files: PlannedFile[], findings: Finding[][], rules: ModuleRules[]): number[] {
  const names = new Set(files.flatMap((file, index) => {
    const skip = ruleFunctionNames(rules, file.adapter);
    return findings[index].flatMap((finding) => (finding.wrapper && !skip.has(definedAs(finding.wrapper.function)) ? [finding.wrapper.function.name] : []));
  }));
  if (names.size === 0) return [];
  const called = new RegExp(`(?<![\\w$])(?:${[...names].map(escape).join('|')})\\s*\\(`);
  return files.flatMap((file, index) => (file.adapter.callSites && !findings[index].some((finding) => finding.ruleId === 'file-too-large') && called.test(readFileSync(file.path, 'utf8')) ? [index] : []));
}

function addCallsToWrappers(files: ScannedFile[], rules: ModuleRules[], prefetched?: ReadonlyMap<string, CallSite[]>): void {
  const rulesById = new Map(rules.flatMap((group) => group.rules.map((rule) => [rule.id, rule] as const)));
  // A library's own source defines the functions its rules name (wolfSSL's wc_AesGcmSetKey). Calls to those are already
  // matched by the rules, so they are not followed as wrappers.

  const existing = new Set(files.flatMap((item) => item.findings.map((finding) => `${finding.file}:${finding.line}:${finding.ruleId}`)));
  // Each file is parsed at most once, the first time a round needs it; its calls are kept for later rounds.
  const sites = new Map<ScannedFile, CallSite[]>();
  const texts = new Map<ScannedFile, string>();
  const sitesOf = (item: ScannedFile, called: RegExp): CallSite[] => {
    if (sites.has(item)) return sites.get(item)!;
    if (prefetched?.has(item.path)) {
      sites.set(item, prefetched.get(item.path)!);
      return sites.get(item)!;
    }
    if (!texts.has(item)) texts.set(item, readFileSync(item.path, 'utf8'));
    const text = texts.get(item)!;
    if (!called.test(text)) return [];
    texts.delete(item);
    sites.set(item, item.adapter.callSites!(text));
    return sites.get(item)!;
  };
  for (const language of new Set(files.map((item) => item.adapter))) {
    const ruleFunctions = ruleFunctionNames(rules, language);
    const marks = files.filter((item) => item.adapter === language)
      .flatMap((item) => item.findings.flatMap((finding) => (finding.wrapper && !ruleFunctions.has(definedAs(finding.wrapper.function)) ? [{ ...finding.wrapper, language: language.id }] : [])));
    if (marks.length === 0) continue;
    const callers = files.filter((item) => item.adapter.callSites && !item.findings.some((finding) => finding.ruleId === 'file-too-large')
      && (item.adapter === language || item.adapter.alsoUsesRulesOf?.includes(language.id)));
    const { findings: added, callers: summary } = wrapperResult(marks, rulesById, (names) => {
      // One search per round for any of the names followed by `(`, so files that never call them are not parsed.
      const called = new RegExp(`(?<![\\w$])(?:${[...names].map(escape).join('|')})\\s*\\(`);
      return callers.flatMap((item) => sitesOf(item, called).filter((site) => names.has(site.name)).map((site) => ({ file: item.name, language: item.adapter.id, site })));
    }, existing);
    const byName = new Map(files.map((item) => [item.name, item] as const));
    for (const finding of added) {
      const item = byName.get(finding.file)!;
      item.findings = [...item.findings, finding].sort((left, right) => left.line - right.line);
    }
    // Each wrapper's own crypto call says who chooses its algorithm, and lists the calls whose value cannot be read.
    for (const item of files) {
      item.findings = item.findings.map((finding) => {
        const entry = finding.wrapper ? summary.get(finding.wrapper.root) : undefined;
        return entry && finding.wrapper!.root === `${finding.file}:${finding.line}:${finding.ruleId}` ? { ...finding, note: wrapperNote(entry.mark, entry.unreadable, entry.passedOn, entry.resolved) } : finding;
      });
    }
  }
}

/** Scan a file or folder with every registered language, giving each adapter only the rules for its own language. */
export function scan(target: string, rules: ModuleRules[], adapters: readonly LanguageAdapter[] = languages): Finding[] {
  const { root, files, unreadable } = planScan(target, adapters);
  const rulesFor = rulesByAdapter(rules, adapters);
  return finishScan(root, files, files.map((file) => scanFile(file, rulesFor)), rules, undefined, unreadable);
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
