import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { UNRESOLVED_ALGORITHM_NOTE, finding } from '../src/core/finding.ts';
import type { LanguageAdapter } from '../src/core/language.ts';
import { loadRules } from '../src/core/rules.ts';
import { scan } from '../src/core/scan.ts';
import type { ModuleRules } from '../src/core/types.ts';
import { languages } from '../src/languages/index.ts';
import { javascript } from '../src/languages/javascript/adapter.ts';

// A toy language ("toy", files ending .toy) that shares no code with the JavaScript adapter. If the core needed to know
// anything about JavaScript, these tests could not pass: they are the contract for adding a real second language.
const toyRules: ModuleRules = { language: 'toy', module: ['toylib'], rules: [] };
const received: ModuleRules[][] = [];
const toy: LanguageAdapter = {
  id: 'toy',
  extensions: ['.toy'],
  scanSource(text, file, rules) {
    received.push(rules);
    return text.split('\n').flatMap((line, index) => {
      const match = /^hash (\w+)/.exec(line);
      if (!match) return [];
      return match[1] === 'dynamic'
        ? [finding(file, index + 1, 'toy-hash', 'hash', null, 'unresolved', UNRESOLVED_ALGORITHM_NOTE)]
        : [finding(file, index + 1, 'toy-hash', 'hash', match[1].toUpperCase(), 'observed-resistant')];
    });
  },
  localImports: (text) => text.split('\n').flatMap((line, index) => (line.startsWith('use ') ? [{ specifier: line.slice(4).trim(), line: index + 1 }] : [])),
  resolveImport: (from, specifier, known) => [resolve(dirname(from), `${specifier}.toy`)].find((candidate) => known.has(candidate)),
};

const project = () => {
  const dir = mkdtempSync(join(tmpdir(), 'pqc-lang-'));
  writeFileSync(join(dir, 'a.toy'), 'hash sha256\n');
  writeFileSync(join(dir, 'wrapper.toy'), 'hash dynamic\n');
  writeFileSync(join(dir, 'caller.toy'), 'use wrapper\n');
  writeFileSync(join(dir, 'b.ts'), "import { createHash } from 'crypto';\ncreateHash('sha512');\n");
  writeFileSync(join(dir, 'ignored.py'), 'import hashlib\n');
  return dir;
};

describe('adding a language needs only an adapter and a rules folder', () => {
  it('scans files of every registered language in one run', () => {
    const found = scan(project(), [...loadRules(), toyRules], [javascript, toy]).map((item) => `${item.file}:${item.ruleId}`).sort();
    expect(found).toEqual(['a.toy:toy-hash', 'b.ts:node-hash', 'caller.toy:crypto-via-local-module', 'wrapper.toy:toy-hash']);
  });

  it('gives each adapter only the rules of its own language', () => {
    received.length = 0;
    scan(project(), [...loadRules(), toyRules], [javascript, toy]);
    expect(received.length).toBeGreaterThan(0);
    for (const rules of received) expect(rules.every((group) => group.language === 'toy')).toBe(true);
  });

  it('runs the cross-file wrapper report for any language that provides import resolution', () => {
    const findings = scan(project(), [toyRules], [toy]);
    expect(findings.find((item) => item.file === 'caller.toy')).toMatchObject({ ruleId: 'crypto-via-local-module', status: 'unresolved' });
  });

  it('skips the wrapper report for a language without import resolution, and skips files nobody reads', () => {
    const { localImports, resolveImport, ...plain } = toy;
    void localImports; void resolveImport;
    const findings = scan(project(), [toyRules], [plain]);
    expect(findings.map((item) => item.file).sort()).toEqual(['a.toy', 'wrapper.toy']);
  });

  it('takes a rule file language from its folder name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pqc-rules-'));
    for (const language of ['javascript', 'python']) {
      mkdirSync(join(dir, language));
      writeFileSync(join(dir, language, 'x.yaml'), 'module: [m]\nrules: []\n');
    }
    expect(loadRules(pathToFileURL(dir + '/')).map((group) => group.language)).toEqual(['javascript', 'python']);
  });

  it('has a registered adapter for every rules/<language>/ folder, and rules for every adapter', () => {
    expect(new Set(loadRules().map((group) => group.language))).toEqual(new Set(languages.map((adapter) => adapter.id)));
  });
});

describe('boundaries between languages', () => {
  it('lets other languages use the C support only through src/languages/c/api.ts', () => {
    const root = join(dirname(new URL(import.meta.url).pathname), '../src/languages');
    const offenders = languages.filter((adapter) => adapter.id !== 'c').flatMap((adapter) => {
      const source = readFileSync(join(root, adapter.id, 'adapter.ts'), 'utf8');
      return /from '\.\.\/c\/(?!api\.ts')/.test(source) ? [adapter.id] : [];
    });
    expect(offenders).toEqual([]);
  });
});
