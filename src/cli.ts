#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { loadRules } from './core/rules.ts';
import { ResultCache } from './core/cache.ts';
import { scanInParallel } from './core/parallel.ts';
import { loadLanguages } from './core/scan.ts';
import { toReport } from './output/json.ts';
import { MASCOT_BANNER, printTable } from './output/text.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  strict: false,
  options: { json: { type: 'boolean' }, quiet: { type: 'boolean', short: 'q' }, 'no-banner': { type: 'boolean' }, cache: { type: 'string' } },
});
const json = values.json === true;
const quiet = values.quiet === true || values['no-banner'] === true;
const target = positionals[0];
const showBanner = !json && !quiet;

if (!target) {
  if (showBanner) console.log(MASCOT_BANNER);
  console.error('Usage: pqc-scan <path> [--json] [--quiet] [--cache <file>]');
  process.exit(2);
}

if (values.cache !== undefined && typeof values.cache !== 'string') {
  console.error('pqc-scan: --cache needs a file name, for example --cache .pqc-scan-cache.json');
  process.exit(2);
}

const path = resolve(target);
if (!existsSync(path)) {
  console.error(`pqc-scan: path not found: ${path}`);
  process.exit(2);
}

if (showBanner) console.log(MASCOT_BANNER);
await loadLanguages();
const cache = typeof values.cache === 'string' ? new ResultCache(resolve(values.cache)) : undefined;
const findings = await scanInParallel(path, loadRules(), { cache });
cache?.save();
if (json) console.log(JSON.stringify(toReport(findings), null, 2));
else printTable(findings);

// exitCode, not exit(): exiting at once would cut off output still being written to a pipe.
process.exitCode = findings.some((item) => item.status !== 'observed-resistant') ? 1 : 0;
