export const STATUSES = ['vulnerable', 'observed-resistant', 'needs-review', 'unresolved'] as const;
export type Status = (typeof STATUSES)[number];

export const CATEGORIES = ['keygen', 'key-exchange', 'encryption', 'signature', 'symmetric', 'hash', 'random', 'unknown'] as const;
export type Category = (typeof CATEGORIES)[number];

export interface TraceStep {
  note: string;
}

export interface Finding {
  ruleId: string;
  file: string;
  line: number;
  algorithm: string | null;
  category: Category;
  status: Status;
  trace: TraceStep[];
  note?: string;
}

export interface AlgorithmValue {
  algorithm: string;
  status: Status;
  note?: string;
}

export interface Rule {
  id: string;
  functions: string[];
  category: Category;
  algorithm?: string;
  status?: Status;
  algorithmFrom?: { arg: number; property?: string };
  values?: Record<string, AlgorithmValue>;
  qualifiers?: string[];
  ignore?: boolean;
  note?: string;
}

export interface ModuleRules {
  /** Set by the loader from the rules/<language>/ folder the file lives in. */
  language: string;
  module: string[];
  rules: Rule[];
  /** Constructors whose instances are WebCrypto objects (`new Crypto()` from a polyfill). */
  constructs?: string[];
}
