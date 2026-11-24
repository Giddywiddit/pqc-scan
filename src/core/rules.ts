import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { ModuleRules } from './types.ts';
import { fileURLToPath } from 'node:url';

function validateRules(value: unknown, file: string): asserts value is Omit<ModuleRules, 'language'> {
  if (!value || typeof value !== 'object') throw new Error(`${file}: rule file must contain an object.`);
  const ruleset = value as Partial<ModuleRules>;
  if (!Array.isArray(ruleset.module) || ruleset.module.length === 0 || ruleset.module.some((name) => typeof name !== 'string')) {
    throw new Error(`${file}: module must be a non-empty string array.`);
  }
  if (ruleset.constructs && (!Array.isArray(ruleset.constructs) || ruleset.constructs.some((name) => typeof name !== 'string'))) {
    throw new Error(`${file}: constructs must be a string array.`);
  }
  if (ruleset.mirrors && (typeof ruleset.mirrors !== 'object' || Object.entries(ruleset.mirrors).some(([from, to]) => typeof to !== 'string' || !ruleset.module!.includes(from)))) {
    throw new Error(`${file}: mirrors must map a crate in module to the crate it copies.`);
  }
  if (!Array.isArray(ruleset.rules)) throw new Error(`${file}: rules must be an array.`);
  for (const rule of ruleset.rules) {
    if (!rule || typeof rule !== 'object' || typeof rule.id !== 'string' || !Array.isArray(rule.functions) || rule.functions.some((name) => typeof name !== 'string')) {
      throw new Error(`${file}: every rule requires an id and string functions array.`);
    }
    if (rule.names && (!Array.isArray(rule.names) || rule.names.some((name) => typeof name !== 'string'))) throw new Error(`${file}: rule ${rule.id} names must be a string array.`);
    if (rule.names?.length && rule.algorithmFrom) throw new Error(`${file}: rule ${rule.id} cannot take the algorithm from an argument for a name.`);
    if (!rule.category || typeof rule.category !== 'string') throw new Error(`${file}: rule ${rule.id} requires a category.`);
    if (rule.ignore) continue;
    if (!rule.algorithm && !rule.algorithmFrom && !rule.note) throw new Error(`${file}: rule ${rule.id} requires algorithm, algorithmFrom, note (unresolved) or ignore.`);
    if (rule.algorithm && !rule.status) throw new Error(`${file}: rule ${rule.id} requires a status for fixed algorithm ${rule.algorithm}.`);
    if (rule.algorithmFrom && !rule.values) throw new Error(`${file}: rule ${rule.id} requires values for algorithmFrom.`);
  }
}

/** Reads every `<rulesDir>/<language>/*.yaml`; the folder name becomes the rule file's language. */
export function loadRules(rulesDir = new URL('../../rules/', import.meta.url)): ModuleRules[] {
  const root = rulesDir instanceof URL ? rulesDir : new URL(rulesDir, import.meta.url);
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((folder) => readdirSync(new URL(`${folder.name}/`, root))
      .filter((name) => name.endsWith('.yaml'))
      .sort()
      .map((name) => {
        const value = parse(readFileSync(join(fileURLToPath(new URL(`${folder.name}/`, root)), name), 'utf8'));
        validateRules(value, `${folder.name}/${name}`);
        return { ...value, language: folder.name };
      }));
}
