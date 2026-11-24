import { ruleFindings } from './match.ts';
import type { Finding, ModuleRules, Rule } from './types.ts';

/** One language's rule files, indexed by full name. The first rule to list a name wins. */
export interface NameIndex {
  /** Names that count when called (or, in Go, built), because the algorithm may be read from an argument. */
  functions: Map<string, Rule>;
  /** Names whose every use counts. */
  names: Map<string, Rule>;
  /** Libraries read as another library with the same interface (`aws_lc_rs` as `ring`). */
  mirrors: Map<string, string>;
}

export function indexRules(groups: ModuleRules[]): NameIndex {
  const index: NameIndex = { functions: new Map(), names: new Map(), mirrors: new Map() };
  for (const group of groups) {
    for (const rule of group.rules) {
      for (const name of rule.functions) if (!index.functions.has(name)) index.functions.set(name, rule);
      for (const name of rule.names ?? []) if (!index.names.has(name)) index.names.set(name, rule);
    }
    for (const [from, to] of Object.entries(group.mirrors ?? {})) index.mirrors.set(from, to);
  }
  return index;
}

/**
 * Collects one file's findings. A name used twice on one line (`std::unique_ptr<SHA256> p(new SHA256)`) is one use;
 * every call is its own finding. The lines reported are remembered so the parse-error check does not repeat them.
 */
export class LineReporter {
  private readonly seen = new Set<string>();
  readonly file: string;
  readonly findings: Finding[];
  readonly reportedLines: Set<number>;

  // Plain fields, not constructor parameter properties: worker threads load this file with Node's type stripping,
  // which does not support them.
  constructor(file: string, findings: Finding[] = [], reportedLines = new Set<number>()) {
    this.file = file;
    this.findings = findings;
    this.reportedLines = reportedLines;
  }

  /** A use of a name: reported once per rule and line. */
  name(rule: Rule, line: number, note: string): void {
    if (this.seen.has(`${line} ${rule.id}`)) return;
    this.add(rule, line, ruleFindings(rule, this.file, line, [{ note }], () => ({ names: null, qualifiers: [] })));
  }

  /** A call, whose findings the caller has worked out from its arguments. */
  call(rule: Rule, line: number, findings: Finding[]): void {
    this.add(rule, line, findings);
  }

  private add(rule: Rule, line: number, findings: Finding[]): void {
    this.seen.add(`${line} ${rule.id}`);
    this.reportedLines.add(line);
    this.findings.push(...findings);
  }
}
