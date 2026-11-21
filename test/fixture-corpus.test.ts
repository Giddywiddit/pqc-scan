import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRules } from '../src/rules.ts';
import { scanSource } from '../src/scanner.ts';

// Each fixture marks expected findings inline: `// expect: <algorithm|-> <status>[, <algorithm|-> <status>]`.
// Lines without a marker must produce no finding, so both missing and unexpected findings fail.
const rules = loadRules();
const marker = /\/\/ expect: (.+)$/;

for (const directory of ['resolve', 'issues']) {
  const base = new URL(`./fixtures/${directory}/`, import.meta.url).pathname;
  describe(`fixture corpus: ${directory}`, () => {
    for (const name of readdirSync(base).filter((file) => /\.(ts|js)$/.test(file)).sort()) {
      it(name, () => {
        const text = readFileSync(join(base, name), 'utf8');
        const expected = new Map<number, string[]>();
        text.split('\n').forEach((line, index) => {
          const match = marker.exec(line);
          if (match) expected.set(index + 1, match[1].split(',').map((item) => item.trim()));
        });
        const actual = new Map<number, string[]>();
        for (const item of scanSource(text, name, rules)) {
          actual.set(item.line, [...(actual.get(item.line) ?? []), `${item.algorithm ?? '-'} ${item.status}`]);
        }
        expect(Object.fromEntries(actual)).toEqual(Object.fromEntries(expected));
      });
    }
  });
}
