import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Finding } from '../core/types.ts';

/**
 * A stable name for each finding, so the same finding can be recognised in a later scan: a SHA-256 of its rule,
 * algorithm, status, file and the text of its line (spaces squeezed), not its line number, so code moving up or down
 * does not make an old finding look new. When identical lines repeat in a file, each gets its own number.
 */
export function fingerprints(findings: Finding[], target: string): string[] {
  const folder = statSync(target).isDirectory() ? target : undefined;
  const lines = new Map<string, string[]>();
  const textOf = (finding: Finding): string => {
    if (!lines.has(finding.file)) {
      let text = '';
      try {
        text = readFileSync(folder ? join(folder, finding.file) : target, 'utf8');
      } catch {
        // A file that cannot be read again keeps an empty line text; the fingerprint still has its rule and file.
      }
      lines.set(finding.file, text.split('\n'));
    }
    return (lines.get(finding.file)![finding.line - 1] ?? '').trim().replace(/\s+/g, ' ');
  };
  const seen = new Map<string, number>();
  return findings.map((finding) => {
    const base = [finding.ruleId, finding.algorithm ?? '', finding.status, finding.file, textOf(finding)].join('\0');
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    return createHash('sha256').update(`${base}\0${occurrence}`).digest('hex').slice(0, 32);
  });
}

/** A baseline file: the findings a project has accepted for now, so a scan can fail only on new ones. */
export interface Baseline {
  baselineVersion: 1;
  findings: { fingerprint: string; file: string; line: number; ruleId: string; algorithm: string | null; status: string }[];
}

export function toBaseline(findings: Finding[], prints: string[]): Baseline {
  return {
    baselineVersion: 1,
    findings: findings.map((item, index) => ({ fingerprint: prints[index], file: item.file, line: item.line, ruleId: item.ruleId, algorithm: item.algorithm, status: item.status })),
  };
}

/** The fingerprints a baseline file accepts. Throws with a readable message when the file is not a baseline. */
export function readBaseline(path: string): Set<string> {
  let parsed: Partial<Baseline>;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read the baseline ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed.baselineVersion !== 1 || !Array.isArray(parsed.findings)) throw new Error(`${path} is not a pqc-scan baseline (written with --write-baseline).`);
  return new Set(parsed.findings.map((item) => item.fingerprint));
}
