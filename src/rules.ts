import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { ModuleRules } from './types.ts';

function validateRules(value: unknown, file: string): asserts value is ModuleRules {
  if (!value || typeof value !== 'object') throw new Error(`${file}: rule file must contain an object.`);
  const ruleset = value as Partial<ModuleRules>;
  if (!Array.isArray(ruleset.module) || ruleset.module.length === 0 || ruleset.module.some((name) => typeof name !== 'string')) {
    throw new Error(`${file}: module must be a non-empty string array.`);
  }
  if (ruleset.constructs && (!Array.isArray(ruleset.constructs) || ruleset.constructs.some((name) => typeof name !== 'string'))) {
    throw new Error(`${file}: constructs must be a string array.`);
  }
  if (!Array.isArray(ruleset.rules)) throw new Error(`${file}: rules must be an array.`);
  for (const rule of ruleset.rules) {
    if (!rule || typeof rule !== 'object' || typeof rule.id !== 'string' || !Array.isArray(rule.functions) || rule.functions.some((name) => typeof name !== 'string')) {
      throw new Error(`${file}: every rule requires an id and string functions array.`);
    }
    if (!rule.category || typeof rule.category !== 'string') throw new Error(`${file}: rule ${rule.id} requires a category.`);
    if (rule.ignore) continue;
    if (!rule.algorithm && !rule.algorithmFrom && !rule.note) throw new Error(`${file}: rule ${rule.id} requires algorithm, algorithmFrom, note (unresolved) or ignore.`);
    if (rule.algorithm && !rule.status) throw new Error(`${file}: rule ${rule.id} requires a status for fixed algorithm ${rule.algorithm}.`);
    if (rule.algorithmFrom && !rule.values) throw new Error(`${file}: rule ${rule.id} requires values for algorithmFrom.`);
  }
}

export function loadRules(rulesDir = new URL('../rules/', import.meta.url)): ModuleRules[] {
  const directory = rulesDir instanceof URL ? rulesDir : new URL(rulesDir, import.meta.url);
  return readdirSync(directory)
    .filter((name) => name.endsWith('.yaml'))
    .sort()
    .map((name) => {
      const value = parse(readFileSync(join(directory.pathname, name), 'utf8'));
      validateRules(value, name);
      return value;
    });
}
