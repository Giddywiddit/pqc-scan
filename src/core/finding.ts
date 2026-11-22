import type { Finding, Status } from './types.ts';

/** Shared markers: the cross-file check in core recognises a "decided by the caller" finding by these. */
export const UNRESOLVED_ALGORITHM_NOTE = 'The algorithm comes from a value the tool cannot read here, such as a variable or a setting; check this line by hand.';
export const ESCAPING_REFERENCE_RULE_ID = 'crypto-reference-escapes';

export function finding(file: string, line: number, ruleId: string, category: Finding['category'], algorithm: string | null, status: Status, note?: string, trace: Finding['trace'] = []): Finding {
  return { file, line, ruleId, category, algorithm, status, note, trace };
}
