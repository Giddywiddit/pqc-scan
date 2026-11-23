import type { Finding, ModuleRules } from './types.ts';

export interface ImportRef {
  specifier: string;
  line: number;
}

/**
 * What a language must provide. The core owns everything else: walking folders, giving each adapter only its own
 * rules, the cross-file wrapper report, and all output formats.
 */
export interface LanguageAdapter {
  /** Matches the `rules/<id>/` folder that holds this language's rule files. */
  id: string;
  /** Rule folders to read besides its own, such as C's for C++, which calls the same C libraries. */
  alsoUsesRulesOf?: readonly string[];
  /** File extensions this adapter reads, with the leading dot. */
  extensions: readonly string[];
  /** Optional one-time async setup, such as loading a parser grammar. The core calls it before any scan. */
  load?(): Promise<void>;
  /** Report every crypto use in one file. `file` is the name to put in findings. */
  scanSource(text: string, file: string, rules: ModuleRules[]): Finding[];
  /** Optional. Together these enable the cross-file wrapper report for this language. */
  localImports?(text: string, file: string): ImportRef[];
  resolveImport?(from: string, specifier: string, known: ReadonlySet<string>): string | undefined;
}
