#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadRules } from './rules.ts';
import { scan } from './scanner.ts';
import type { Finding, Status } from './types.ts';

const ICONS: Record<Status, string> = { vulnerable: '❌', 'observed-resistant': '✅', 'needs-review': '🔍', unresolved: '⚠️ ' };

const MASCOT_BANNER = [
  ' /\\_/\\',
  '( 0.1 )    [ pqc-scan • Post-Quantum Cryptography Scanner ]',
  ' > ^ <     Finds the cryptography in your JavaScript and TypeScript',
  '           ---------------------------------------------------------',
  '           Looks for what quantum computers will break (NIST FIPS 203/204/205)\n',
].join('\n');

function printTable(findings: Finding[]): void {
  if (findings.length === 0) {
    console.log('⚠️  No recognized cryptography found. This is not a security conclusion.\n');
    return;
  }
  console.log('Cryptography found:');
  console.log(''.padEnd(72, '-'));
  for (const item of findings) {
    console.log(`${ICONS[item.status]} ${`${item.file}:${item.line}`.padEnd(36)} ${(item.algorithm ?? 'unknown algorithm').padEnd(18)} ${item.status}`);
    if (item.note) console.log(`     ℹ️  ${item.note}`);
  }
  console.log(''.padEnd(72, '-'));
  const count = (status: Status) => findings.filter((item) => item.status === status).length;
  console.log(`${findings.length} finding(s): ${count('vulnerable')} vulnerable, ${count('needs-review')} needs-review, ${count('unresolved')} unresolved, ${count('observed-resistant')} observed-resistant.\n`);
  if (count('vulnerable') > 0) console.log('🚨 Quantum risk found: the ❌ items use cryptography a quantum computer could break. Plan their migration.');
  else if (count('needs-review') + count('unresolved') > 0) console.log('⚠️  Review needed: some items need a human decision. This scan cannot prove readiness.');
  else console.log('ℹ️  Nothing risky found in the code we could read. This is not a guarantee of quantum readiness.');
  console.log();
}

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
const findings = scan(path, loadRules());
if (json) console.log(JSON.stringify(findings, null, 2));
else printTable(findings);

process.exit(findings.some((item) => item.status !== 'observed-resistant') ? 1 : 0);
