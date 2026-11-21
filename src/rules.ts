import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { ModuleRules } from './types.ts';

export function loadRules(rulesDir = new URL('../rules/', import.meta.url)): ModuleRules[] {
  const directory = rulesDir instanceof URL ? rulesDir : new URL(rulesDir, import.meta.url);
  return readdirSync(directory)
    .filter((name) => name.endsWith('.yaml'))
    .sort()
    .map((name) => parse(readFileSync(join(directory.pathname, name), 'utf8')) as ModuleRules);
}
