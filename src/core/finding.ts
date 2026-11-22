import type { Finding, Status } from './types.ts';

/** Shared markers: the cross-file check in core recognises a "decided by the caller" finding by these. */
export const UNRESOLVED_ALGORITHM_NOTE = 'Algorithm could not be statically resolved.';
export const ESCAPING_REFERENCE_RULE_ID = 'crypto-reference-escapes';

export function finding(file: string, line: number, ruleId: string, category: Finding['category'], algorithm: string | null, status: Status, note?: string, trace: Finding['trace'] = []): Finding {
  return { file, line, ruleId, category, algorithm, status, note, trace };
}
