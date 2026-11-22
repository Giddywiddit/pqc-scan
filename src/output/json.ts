import { readFileSync } from 'node:fs';
import { STATUSES } from '../core/types.ts';
import type { Finding, Status } from '../core/types.ts';

/** Bumped only for a breaking change to the report shape. The matching JSON Schema is schema/report-v1.schema.json. */
export const SCHEMA_VERSION = 1;

export interface Report {
  schemaVersion: typeof SCHEMA_VERSION;
  tool: { name: 'pqc-scan'; version: string };
  summary: { total: number } & Record<Status, number>;
  findings: Finding[];
}

const version = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;

export function toReport(findings: Finding[]): Report {
  const counts = Object.fromEntries(STATUSES.map((status) => [status, findings.filter((item) => item.status === status).length])) as Record<Status, number>;
  return { schemaVersion: SCHEMA_VERSION, tool: { name: 'pqc-scan', version }, summary: { total: findings.length, ...counts }, findings };
}
