import { describe, expect, it } from 'vitest';
import { loadRules } from '../src/rules.ts';
import { scanSource } from '../src/scanner.ts';

const rules = loadRules();
const scan = (text: string) => scanSource(text, 'f.ts', rules);
const header = "import { createHash } from 'crypto';\n";

// Syntax the scanner sees but cannot resolve: reported as `unresolved`, never silently skipped.
describe('unresolvable values: reported as unresolved', () => {
  it.each([
    ['environment-driven value', 'createHash(process.env.HASH);'],
    ['function-returned value', 'createHash(pick());'],
    ['template with substitution', 'createHash(`sha${bits}`);'],
    ['string concatenation', "createHash('sha' + bits);"],
    ['spread arguments', 'createHash(...args);'],
    ['function parameter', 'function h(name: string) { return createHash(name); }'],
    ['let binding', "let a = 'sha256'; createHash(a);"],
    ['ternary', "createHash(flag ? 'sha256' : 'sha1');"],
    ['object property access', "const cfg = { hash: 'sha256' }; createHash(cfg.hash);"],
  ])('%s', (_name, code) => {
    const findings = scan(header + code);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ status: 'unresolved', ruleId: 'node-hash' });
  });
});

describe('indirection that is followed', () => {
  it.each([
    ['dynamic require with a constant specifier', "const name = 'crypto'; const m = require(name); m.generateKeyPairSync('rsa');"],
    ['await import()', "const m = await import('node:crypto'); m.generateKeyPairSync('rsa');"],
    ['destructuring from a namespace import', "import * as c from 'crypto'; const { generateKeyPairSync } = c; generateKeyPairSync('rsa');"],
    ['aliasing a function', "import { generateKeyPairSync } from 'crypto'; const k = generateKeyPairSync; k('rsa');"],
    ['aliasing a member', "import crypto from 'crypto'; const k = crypto.generateKeyPairSync; k('rsa');"],
    ['chained aliases', "import crypto from 'crypto'; const a = crypto; const b = a; b.generateKeyPairSync('rsa');"],
    ['.call()', "import { generateKeyPairSync } from 'crypto'; generateKeyPairSync.call(null, 'rsa');"],
    ['.apply() with an array literal', "import { generateKeyPairSync } from 'crypto'; generateKeyPairSync.apply(null, ['rsa']);"],
    ['require used inline', "require('crypto').generateKeyPairSync('rsa');"],
    ['aliasing the global', "const c = globalThis.crypto; c.subtle.generateKey({ name: 'RSA-OAEP' }, true, []);"],
  ])('%s', (_name, code) => {
    expect(scan(code)).toMatchObject([{ status: 'vulnerable' }]);
  });
});

describe('references that escape tracking: reported as unresolved', () => {
  it.each([
    ['function stored in an object', "import { generateKeyPairSync } from 'crypto'; const lib = { k: generateKeyPairSync }; lib.k('rsa');"],
    ['shorthand property', "import { createHash } from 'crypto'; export const lib = { createHash };"],
    ['function passed as an argument', "import { createHash } from 'crypto'; register(createHash);"],
    ['module passed as an argument', "import crypto from 'crypto'; register(crypto);"],
    ['function returned', "import { createHash } from 'crypto'; export function f() { return createHash; }"],
    ['reassigned to a mutable binding', "import { createHash } from 'crypto'; let h = createHash; h('md5');"],
  ])('%s', (_name, code) => {
    const findings = scan(code);
    expect(findings.map((item) => item.ruleId)).toContain('crypto-reference-escapes');
    expect(findings.every((item) => item.status === 'unresolved')).toBe(true);
  });

  it('does not flag ordinary calls or property reads', () => {
    expect(scan("import crypto from 'crypto';\nconst c = crypto.constants;\ncrypto.createHash('sha256');").map((item) => item.ruleId)).toEqual(['node-hash']);
  });
});

// Not detected: the call cannot be attributed to a crypto module. These are documented false negatives.
describe('not detected (documented limitation)', () => {
  it.each([
    ['require with a non-constant specifier', "const m = require(name); m.createHash('md5');"],
    ['import() with a non-constant specifier', "const m = await import(name); m.createHash('md5');"],
    ['a wrapper module in another file', "import { hash } from './crypto-utils'; hash('md5');"],
    ['eval', "eval(\"require('crypto').createHash('md5')\");"],
  ])('%s', (_name, code) => {
    expect(scan(code)).toEqual([]);
  });
});
