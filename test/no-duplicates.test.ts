import { describe, expect, it } from 'vitest';
import { loadRules } from '../src/rules.ts';
import { scanSource } from '../src/scanner.ts';

const rules = loadRules();
const scan = (text: string) => scanSource(text, 'f.ts', rules);

// One crypto call must produce exactly one finding, however it was reached.
describe('no duplicate findings', () => {
  it.each([
    ['direct call', "import { createHash } from 'crypto'; createHash('sha256');"],
    ['namespace call', "import * as c from 'crypto'; c.createHash('sha256');"],
    ['default import call', "import c from 'crypto'; c.createHash('sha256');"],
    ['alias then call', "import { createHash } from 'crypto'; const h = createHash; h('sha256');"],
    ['member alias then call', "import c from 'crypto'; const h = c.createHash; h('sha256');"],
    ['chained module aliases', "import c from 'crypto'; const a = c; const b = a; b.createHash('sha256');"],
    ['destructured from namespace', "import * as c from 'crypto'; const { createHash } = c; createHash('sha256');"],
    ['require destructure', "const { createHash } = require('crypto'); createHash('sha256');"],
    ['inline require', "require('crypto').createHash('sha256');"],
    ['.call()', "import { createHash } from 'crypto'; createHash.call(null, 'sha256');"],
    ['global WebCrypto', "crypto.subtle.digest('SHA-256', d);"],
    ['aliased global WebCrypto', "const c = globalThis.crypto; c.subtle.digest('SHA-256', d);"],
    ['nested call arguments', "import { createHash } from 'crypto'; createHash('sha256').update(createHash('sha512').digest());"],
    ['call inside a callback', "import { createHash } from 'crypto'; run(() => createHash('sha256'));"],
    ['await import', "const c = await import('crypto'); c.createHash('sha256');"],
    ['polyfill instance', "import { Crypto } from '@peculiar/webcrypto'; const c = new Crypto(); c.subtle.digest('SHA-256', d);"],
  ])('%s', (_name, code) => {
    const findings = scan(code);
    expect(findings).toHaveLength(_name === 'nested call arguments' ? 2 : 1);
    expect(new Set(findings.map((item) => `${item.line}:${item.ruleId}:${item.algorithm}`)).size).toBe(findings.length);
  });

  it('reports an escaping reference once, not once per mention', () => {
    expect(scan("import { createHash } from 'crypto'; const lib = { createHash };").filter((item) => item.ruleId === 'crypto-reference-escapes')).toHaveLength(1);
  });

  it('does not report both a call and an escape for the same use', () => {
    expect(scan("import { createHash } from 'crypto'; createHash('sha256');").map((item) => item.ruleId)).toEqual(['node-hash']);
  });

  it('keeps an unresolved argument to a single finding', () => {
    expect(scan("import { createHash } from 'crypto'; createHash(x);")).toHaveLength(1);
  });
});
