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
  /** Internal, removed before output: the algorithm is a parameter of the function around this call (see wrappers.ts). */
  wrapper?: WrapperMark;
}

/** A function definition, and how it can be called (see wrappers.ts). */
export interface FunctionInfo {
  name: string;
  parameters: string[];
  /** A free function; `Class::f` or `Type::f`, called through its qualifier; or a method called on a value. */
  kind: 'function' | 'associated' | 'method';
  qualifier?: string;
  /** Where it can be called from: its own file (C `static`, private Rust), its Go package (folder), or anywhere. */
  visibility: 'file' | 'package' | 'everywhere';
}

/** A function whose crypto algorithm is one of its parameters, `parameter` (from 0). */
export interface WrapperMark {
  function: FunctionInfo;
  parameter: number;
  ruleId: string;
  file: string;
  line: number;
  /** The crypto call the chain of wrappers leads to, as `file:line:ruleId`. */
  root: string;
  /** The language of the file the function is in; set by the core. */
  language?: string;
}

export interface AlgorithmValue {
  algorithm: string;
  status: Status;
  note?: string;
}

export interface Rule {
  id: string;
  functions: string[];
  /**
   * Names whose every use counts, called or not: C++ types (`CryptoPP::SHA256 h;`), matched inside the rule file's
   * namespace, and Rust paths from the crate (`sha2::Sha256`, `ring::digest::SHA256`).
   */
  names?: string[];
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
  /** Rust: crates that copy another crate's interface, read as that crate (`{ aws_lc_rs: ring }`). */
  mirrors?: Record<string, string>;
}
