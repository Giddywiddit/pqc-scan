#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadRules } from './rules.ts';
import { scan } from './scanner.ts';

const target = process.argv.slice(2).find((arg) => !arg.startsWith('-'));
const json = process.argv.includes('--json');

if (!target) {
  console.error('Usage: pqc-scan <path> [--json]');
  process.exit(2);
}

const path = resolve(target);
if (!existsSync(path)) {
  console.error(`pqc-scan: path not found: ${path}`);
  process.exit(2);
}

const findings = scan(path, loadRules());
if (json) console.log(JSON.stringify(findings, null, 2));
else {
  for (const item of findings) console.log(`${item.status}\t${item.file}:${item.line}\t${item.algorithm ?? 'unknown'}\t${item.note ?? ''}`);
  const count = (status: string) => findings.filter((item) => item.status === status).length;
  console.log(`\n${findings.length} finding(s); ${count('vulnerable')} vulnerable, ${count('needs-review')} needs-review, ${count('unresolved')} unresolved.`);
}

process.exit(findings.some((item) => item.status !== 'observed-resistant') ? 1 : 0);
