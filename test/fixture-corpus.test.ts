import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadRules } from '../src/core/rules.ts';
import { loadLanguages } from '../src/core/scan.ts';
import { languages } from '../src/languages/index.ts';

// Each fixture marks expected findings inline: `// expect: <algorithm|-> <status>[, <algorithm|-> <status>]`.
// Lines without a marker must produce no finding, so both missing and unexpected findings fail.
const rules = loadRules();
const adapterFor = (file: string) => languages.find((adapter) => adapter.extensions.includes(extname(file)))!;
beforeAll(() => loadLanguages());
// `/* expect: ... */` is for lines that cannot end in a // comment, such as a macro line ending in a backslash.
const marker = /(?:\/\/ expect: (.+)$|\/\* expect: (.+?) \*\/)/;

// Every fixture folder with at least one marked file is a corpus, so a new language's folder is picked up on its own.
const root = new URL('./fixtures/', import.meta.url).pathname;
const corpora = readdirSync(root).filter((directory) => readdirSync(join(root, directory), { withFileTypes: true })
  .some((entry) => entry.isFile() && readFileSync(join(root, directory, entry.name), 'utf8').includes('expect: ')));

it('finds the fixture corpora', () => expect(corpora).toEqual(expect.arrayContaining(['c', 'issues', 'resolve'])));

for (const directory of corpora) {
  const base = join(root, directory);
  describe(`fixture corpus: ${directory}`, () => {
    for (const name of readdirSync(base).filter((file) => languages.some((adapter) => adapter.extensions.includes(extname(file)))).sort()) {
      it(name, () => {
        const text = readFileSync(join(base, name), 'utf8');
        const expected = new Map<number, string[]>();
        text.split('\n').forEach((line, index) => {
          const match = marker.exec(line);
          if (match) expected.set(index + 1, (match[1] ?? match[2]).split(',').map((item) => item.trim()));
        });
        const actual = new Map<number, string[]>();
        const adapter = adapterFor(name);
        for (const item of adapter.scanSource(text, name, rules.filter((group) => group.language === adapter.id))) {
          actual.set(item.line, [...(actual.get(item.line) ?? []), `${item.algorithm ?? '-'} ${item.status}`]);
        }
        expect(Object.fromEntries(actual)).toEqual(Object.fromEntries(expected));
      });
    }
  });
}
