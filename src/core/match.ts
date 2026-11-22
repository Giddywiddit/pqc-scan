import { UNRESOLVED_ALGORITHM_NOTE, finding } from './finding.ts';
import type { Finding, Rule } from './types.ts';

/** What an adapter read from the argument a rule points at. `names` is null when the value could not be read. */
export interface ResolvedArgument {
  names: string[] | null;
  qualifiers: string[];
}

/**
 * Turns one call that matched `rule` into findings. Shared by every language so the meaning of a rule is identical
 * everywhere. `resolve` is called only for rules that take the algorithm from an argument.
 */
export function ruleFindings(rule: Rule, file: string, line: number, trace: Finding['trace'], resolve: () => ResolvedArgument): Finding[] {
  // `ignore` rules operate on an existing key; the algorithm is reported where the key is created or imported.
  if (rule.ignore) return [];
  if (rule.algorithm && rule.status) return [finding(file, line, rule.id, rule.category, rule.algorithm, rule.status, rule.note, trace)];
  if (!rule.algorithmFrom) return [finding(file, line, rule.id, rule.category, null, 'unresolved', rule.note, trace)];
  const { names, qualifiers } = resolve();
  if (!names) return [finding(file, line, rule.id, rule.category, null, 'unresolved', UNRESOLVED_ALGORITHM_NOTE, trace)];
  const values = rule.values ?? {};
  return names.map((value) => {
    const match = lookup(values, value, qualifiers);
    return match
      ? finding(file, line, rule.id, rule.category, match.algorithm, match.status, match.note, trace)
      : finding(file, line, rule.id, rule.category, null, 'unresolved', `Algorithm "${value}" has no rule.`, trace);
  });
}

/** Finds a value in a rule table: qualified forms first (`aes-gcm-256`), then exact, then lower case. */
export function lookup<T>(values: Record<string, T>, value: string, qualifiers: string[] = []): T | undefined {
  const base = value.toLowerCase();
  const key = [...qualifiers.map((item) => `${base}-${item.toLowerCase()}`), value, base].find((candidate) => Object.hasOwn(values, candidate));
  return key === undefined ? undefined : values[key];
}
