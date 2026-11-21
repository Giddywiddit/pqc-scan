import { describe, expect, it } from 'vitest';
import { loadRules } from '../src/rules.ts';
import { scanSource } from '../src/scanner.ts';

const rules = loadRules();
const scan = (text: string) => scanSource(text, 'fixture.ts', rules);
const compact = (text: string) => scan(text).map(({ algorithm, status, ruleId, line, category }) => ({ algorithm, status, ruleId, line, category }));

describe('JavaScript and TypeScript crypto inventory', () => {
  it('detects a direct ESM RSA key generation call', () => {
    expect(compact("import { generateKeyPairSync } from 'node:crypto';\ngenerateKeyPairSync('rsa', { modulusLength: 3072 });"))
      .toEqual([{ algorithm: 'RSA', status: 'vulnerable', ruleId: 'node-keygen', line: 2, category: 'keygen' }]);
  });

  it('detects namespace, renamed, CommonJS, and computed-property imports', () => {
    expect(compact("import * as crypto from 'crypto';\nimport { generateKeyPairSync as keygen } from 'node:crypto';\nconst { generateKeyPairSync: legacy } = require('crypto');\ncrypto['generateKeyPairSync']('rsa');\nkeygen('ec');\nlegacy('dh');"))
      .toEqual([
        { algorithm: 'RSA', status: 'vulnerable', ruleId: 'node-keygen', line: 4, category: 'keygen' },
        { algorithm: 'EC', status: 'vulnerable', ruleId: 'node-keygen', line: 5, category: 'keygen' },
        { algorithm: 'DH', status: 'vulnerable', ruleId: 'node-keygen', line: 6, category: 'keygen' },
      ]);
  });

  it('resolves const values and TypeScript as-const assertions', () => {
    expect(compact("import { generateKeyPairSync } from 'crypto';\nconst algorithm = 'ml-kem-768' as const;\ngenerateKeyPairSync(algorithm);"))
      .toEqual([{ algorithm: 'ML-KEM-768', status: 'observed-resistant', ruleId: 'node-keygen', line: 3, category: 'keygen' }]);
  });

  it('refuses to follow mutable bindings, preventing stale-value false positives', () => {
    expect(compact("import { generateKeyPairSync } from 'crypto';\nlet algorithm = 'rsa';\nalgorithm = 'ml-kem-768';\ngenerateKeyPairSync(algorithm);"))
      .toEqual([{ algorithm: null, status: 'unresolved', ruleId: 'node-keygen', line: 4, category: 'keygen' }]);
  });

  it('refuses to resolve duplicate names across scopes', () => {
    expect(compact("import { generateKeyPairSync } from 'crypto';\nfunction first() { const algorithm = 'rsa'; generateKeyPairSync(algorithm); }\nfunction second() { const algorithm = 'ml-kem-768'; generateKeyPairSync(algorithm); }"))
      .toEqual([
        { algorithm: null, status: 'unresolved', ruleId: 'node-keygen', line: 2, category: 'keygen' },
        { algorithm: null, status: 'unresolved', ruleId: 'node-keygen', line: 3, category: 'keygen' },
      ]);
  });

  it('resolves a const JWT options object', () => {
    expect(compact("import jwt from 'jsonwebtoken';\nconst options = { algorithm: 'RS256' } as const;\njwt.sign({ sub: 'alice' }, 'secret', options);"))
      .toEqual([{ algorithm: 'RSA', status: 'vulnerable', ruleId: 'jwt-sign', line: 3, category: 'signature' }]);
  });

  it('reports unknown algorithms as unresolved instead of assuming safety', () => {
    expect(compact("import { createHash } from 'crypto';\ncreateHash('future-hash');"))
      .toEqual([{ algorithm: null, status: 'unresolved', ruleId: 'node-hash', line: 2, category: 'hash' }]);
  });

  it('handles supported RSA signing algorithms', () => {
    expect(compact("import * as crypto from 'crypto';\ncrypto.createSign('RSA-SHA256');"))
      .toEqual([{ algorithm: 'RSA', status: 'vulnerable', ruleId: 'node-signature', line: 2, category: 'signature' }]);
  });

  it('reports unhandled calls on a recognized crypto module', () => {
    expect(compact("import * as crypto from 'crypto';\ncrypto.scryptSync('pw', 'salt', 32);"))
      .toEqual([{ algorithm: null, status: 'unresolved', ruleId: 'unhandled-crypto-api', line: 2, category: 'unknown' }]);
  });

  it('does not match comments, strings, or a same-named local function', () => {
    expect(compact("// crypto.generateKeyPairSync('rsa')\nconst text = \"crypto.generateKeyPairSync('rsa')\";\nfunction generateKeyPairSync() {}\ngenerateKeyPairSync();"))
      .toEqual([]);
  });

  it('does not match a crypto-like API from an unrelated module', () => {
    expect(compact("import { generateKeyPairSync } from './test-double';\ngenerateKeyPairSync('rsa');"))
      .toEqual([]);
  });

  it('fails closed when source cannot be parsed', () => {
    expect(compact("import { generateKeyPairSync } from 'crypto';\ngenerateKeyPairSync('rsa'"))
      .toEqual([{ algorithm: null, status: 'unresolved', ruleId: 'parse-error', line: 2, category: 'unknown' }]);
  });

  it('reports AES-128 as review-required rather than quantum-safe', () => {
    expect(compact("import { createCipheriv } from 'crypto';\ncreateCipheriv('aes-128-gcm', key, nonce);"))
      .toEqual([{ algorithm: 'AES-128-GCM', status: 'needs-review', ruleId: 'node-cipher', line: 2, category: 'symmetric' }]);
  });

  it('preserves multiple findings in source order', () => {
    expect(compact("import crypto from 'crypto';\ncrypto.createHash('sha256');\ncrypto.publicEncrypt(key, value);"))
      .toEqual([
        { algorithm: 'SHA-256', status: 'observed-resistant', ruleId: 'node-hash', line: 2, category: 'hash' },
        { algorithm: 'RSA', status: 'vulnerable', ruleId: 'node-rsa-encrypt', line: 3, category: 'encryption' },
      ]);
  });
});

describe('legacy and mid-strength primitives are named, not anonymous', () => {
  it.each([
    ["createHash('sha1')", 'SHA-1'],
    ["createHash('md5')", 'MD5'],
    ["createHmac('sha1', k)", 'HMAC-SHA-1'],
    ["createCipheriv('aes-128-cbc', k, iv)", 'AES-128-CBC'],
    ["createCipheriv('aes-192-gcm', k, iv)", 'AES-192-GCM'],
  ])('%s', (call, algorithm) => {
    expect(compact(`import { createHash, createHmac, createCipheriv } from 'crypto';\n${call};`)).toMatchObject([{ algorithm }]);
  });
});

describe('JWT libraries', () => {
  it('reads jsonwebtoken verify options.algorithms (array), one finding per algorithm', () => {
    expect(compact("import jwt from 'jsonwebtoken';\njwt.verify(token, key, { algorithms: ['RS256', 'HS256'] });"))
      .toEqual([
        { algorithm: 'RSA', status: 'vulnerable', ruleId: 'jwt-verify', line: 2, category: 'signature' },
        { algorithm: 'HMAC-SHA256', status: 'observed-resistant', ruleId: 'jwt-verify', line: 2, category: 'signature' },
      ]);
  });

  it('leaves jsonwebtoken verify unresolved when algorithms is omitted or partly dynamic', () => {
    expect(compact("import jwt from 'jsonwebtoken';\njwt.verify(token, key);\njwt.verify(token, key, { algorithms: ['RS256', pick()] });").map((item) => item.status))
      .toEqual(['unresolved', 'unresolved']);
  });

  it('flags the unsigned "none" algorithm for review', () => {
    expect(compact("import jwt from 'jsonwebtoken';\njwt.sign({}, '', { algorithm: 'none' });")).toMatchObject([{ algorithm: 'none', status: 'needs-review' }]);
  });

  it.each([
    ["jws.sign({ header: { alg: 'ES256' }, payload, privateKey });", 'ECDSA', 'jws-sign'],
    ["jws.createSign({ header: { alg: 'RS256' }, privateKey });", 'RSA', 'jws-sign'],
    ["jws.createVerify({ algorithm: 'PS256', key });", 'RSA-PSS', 'jws-verify'],
    ["jws.verify(signature, 'HS256', secret);", 'HMAC-SHA256', 'jws-verify-call'],
  ])('jws: %s', (call, algorithm, ruleId) => {
    expect(compact(`import jws from 'jws';\n${call}`)).toMatchObject([{ algorithm, ruleId }]);
  });

  it('reports a dynamic jws header algorithm as unresolved and ignores decode', () => {
    expect(compact("import jws from 'jws';\njws.sign({ header: { alg: pick() }, payload, secret });\njws.decode(sig);"))
      .toMatchObject([{ ruleId: 'jws-sign', status: 'unresolved', algorithm: null }]);
  });
});
