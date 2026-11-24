#!/usr/bin/env node
import { existsSync, statSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { loadRules } from './core/rules.ts';
import { ResultCache } from './core/cache.ts';
import { scanInParallel } from './core/parallel.ts';
import { loadLanguages } from './core/scan.ts';
import { fingerprints, readBaseline, toBaseline } from './output/baseline.ts';
import { toReport } from './output/json.ts';
import { toSarif } from './output/sarif.ts';
import { MASCOT_BANNER, printTable } from './output/text.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  strict: false,
  options: { json: { type: 'boolean' }, quiet: { type: 'boolean', short: 'q' }, 'no-banner': { type: 'boolean' }, cache: { type: 'string' }, 'max-file-size': { type: 'string' }, sarif: { type: 'string' }, baseline: { type: 'string' }, 'write-baseline': { type: 'string' } },
});
const json = values.json === true;
const quiet = values.quiet === true || values['no-banner'] === true;
const target = positionals[0];
const showBanner = !json && !quiet;

if (!target) {
  if (showBanner) console.log(MASCOT_BANNER);
  console.error('Usage: pqc-scan <path> [--json] [--quiet] [--sarif <file>] [--baseline <file>] [--write-baseline <file>] [--cache <file>] [--max-file-size <MB>]');
  process.exit(2);
}

for (const [option, example] of [['cache', '~/.cache/pqc-scan.json'], ['sarif', 'pqc-scan.sarif'], ['baseline', 'pqc-scan-baseline.json'], ['write-baseline', 'pqc-scan-baseline.json']] as const) {
  if (values[option] !== undefined && typeof values[option] !== 'string') {
    console.error(`pqc-scan: --${option} needs a file name, for example --${option} ${example}`);
    process.exit(2);
  }
}

const maxFileSize = values['max-file-size'] === undefined ? undefined : Number(values['max-file-size']);
if (maxFileSize !== undefined && !(maxFileSize > 0)) {
  console.error('pqc-scan: --max-file-size needs a size in MB greater than 0, for example --max-file-size 50');
  process.exit(2);
}

const path = resolve(target);
if (!existsSync(path)) {
  console.error(`pqc-scan: path not found: ${path}`);
  process.exit(2);
}

// A cache inside the folder being scanned could come from the code itself (a commit in a pull request), and a planted
// cache can hide findings. It is allowed there only when signed with a key (PQC_SCAN_CACHE_KEY) the code cannot know.
const cacheKey = process.env.PQC_SCAN_CACHE_KEY;
const cachePath = typeof values.cache === 'string' ? resolve(values.cache) : undefined;
if (cachePath && !cacheKey) {
  const folder = statSync(path).isDirectory() ? path : dirname(path);
  const inside = relative(folder, cachePath);
  if (!inside.startsWith('..') && !isAbsolute(inside)) {
    console.error(`pqc-scan: the cache file is inside the folder being scanned (${cachePath}). A cache there could be changed by the code being scanned to hide findings. Keep it outside, for example --cache ~/.cache/pqc-scan.json, or set PQC_SCAN_CACHE_KEY to sign it.`);
    process.exit(2);
  }
}

if (showBanner) console.log(MASCOT_BANNER);
await loadLanguages();
const cache = cachePath ? new ResultCache(cachePath, cacheKey) : undefined;
if (cache?.warning) console.error(`pqc-scan: ${cache.warning}`);
let baseline: Set<string> | undefined;
try {
  baseline = typeof values.baseline === 'string' ? readBaseline(resolve(values.baseline)) : undefined;
} catch (error) {
  console.error(`pqc-scan: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
const findings = await scanInParallel(path, loadRules(), { cache, maxFileBytes: maxFileSize === undefined ? undefined : maxFileSize * 1024 * 1024 });
cache?.save();
const prints = baseline || values.sarif || values['write-baseline'] ? fingerprints(findings, path) : [];
if (typeof values['write-baseline'] === 'string') writeFileSync(resolve(values['write-baseline']), `${JSON.stringify(toBaseline(findings, prints), null, 2)}\n`);
if (typeof values.sarif === 'string') writeFileSync(resolve(values.sarif), JSON.stringify(toSarif(findings, prints, baseline)));
// With a baseline, the findings it lists are left out of the output and do not change the exit status.
const shown = baseline ? findings.filter((_, index) => !baseline.has(prints[index])) : findings;
const known = baseline ? findings.length - shown.length : undefined;
if (json) console.log(JSON.stringify(toReport(shown, known), null, 2));
else printTable(shown, known);

// exitCode, not exit(): exiting at once would cut off output still being written to a pipe.
process.exitCode = shown.some((item) => item.status !== 'observed-resistant') ? 1 : 0;
