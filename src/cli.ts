#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadRules } from './core/rules.ts';
import { loadLanguages, scan } from './core/scan.ts';
import { toReport } from './output/json.ts';
import { MASCOT_BANNER, printTable } from './output/text.ts';

const args = process.argv.slice(2);
const json = args.includes('--json');
const quiet = args.includes('--quiet') || args.includes('-q') || args.includes('--no-banner');
const target = args.find((arg) => !arg.startsWith('-'));
const showBanner = !json && !quiet;

if (!target) {
  if (showBanner) console.log(MASCOT_BANNER);
  console.error('Usage: pqc-scan <path> [--json] [--quiet]');
  process.exit(2);
}

const path = resolve(target);
if (!existsSync(path)) {
  console.error(`pqc-scan: path not found: ${path}`);
  process.exit(2);
}

if (showBanner) console.log(MASCOT_BANNER);
await loadLanguages();
const findings = scan(path, loadRules());
if (json) console.log(JSON.stringify(toReport(findings), null, 2));
else printTable(findings);

process.exit(findings.some((item) => item.status !== 'observed-resistant') ? 1 : 0);
