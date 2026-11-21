export type Status = 'vulnerable' | 'observed-resistant' | 'unresolved';

export type Category = 'keygen' | 'key-exchange' | 'encryption' | 'signature' | 'symmetric' | 'hash' | 'unknown';

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
  status?: Exclude<Status, 'unresolved'>;
  algorithmFrom?: { arg: number; property?: string };
  values?: Record<string, AlgorithmValue>;
}

export interface ModuleRules {
  module: string[];
  rules: Rule[];
}
