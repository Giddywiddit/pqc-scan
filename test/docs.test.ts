import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { languages } from '../src/languages/index.ts';
import { fileURLToPath } from 'node:url';

// The docs are split per language so the main README stays short. These tests keep each language page in step with
// the rule files beside it, and the main README's language table in step with the registered languages.
const root = fileURLToPath(new URL('..', import.meta.url));
const readme = readFileSync(join(root, 'README.md'), 'utf8');

describe.each(languages.map((adapter) => adapter.id))('docs for %s', (id) => {
  const folder = join(root, 'rules', id);
  const page = join(folder, 'README.md');

  it('has a README.md in its rules folder', () => expect(existsSync(page)).toBe(true));

  it('names every rule file on that page', () => {
    const text = readFileSync(page, 'utf8');
    const missing = readdirSync(folder).filter((name) => name.endsWith('.yaml') && !text.includes(`\`${name}\``));
    expect(missing).toEqual([]);
  });

  it('is linked from the main README', () => expect(readme).toContain(`(rules/${id}/README.md)`));
});
