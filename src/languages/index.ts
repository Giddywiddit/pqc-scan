import type { LanguageAdapter } from '../core/language.ts';
import { c } from './c/adapter.ts';
import { javascript } from './javascript/adapter.ts';

/** Every language the scanner can read. Adding a language means adding one adapter here plus its rules/<id>/ folder. */
export const languages: readonly LanguageAdapter[] = [javascript, c];
