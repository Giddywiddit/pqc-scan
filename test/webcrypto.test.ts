import { describe, expect, it } from 'vitest';
import { loadRules } from '../src/rules.ts';
import { scanSource } from '../src/scanner.ts';

const rules = loadRules();
const compact = (text: string) => scanSource(text, 'f.ts', rules).map(({ algorithm, status, ruleId, line }) => ({ algorithm, status, ruleId, line }));

describe('WebCrypto', () => {
  it('detects the global crypto.subtle', () => {
    expect(compact("crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048 }, true, ['encrypt']);"))
      .toEqual([{ algorithm: 'RSA-OAEP', status: 'vulnerable', ruleId: 'webcrypto-keygen', line: 1 }]);
  });

  it('detects globalThis.crypto and window.crypto', () => {
    expect(compact("globalThis.crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k, d);\nwindow.crypto.subtle.verify({ name: 'Ed25519' }, k, s, d);"))
      .toEqual([
        { algorithm: 'ECDSA', status: 'vulnerable', ruleId: 'webcrypto-sign', line: 1 },
        { algorithm: 'Ed25519', status: 'vulnerable', ruleId: 'webcrypto-sign', line: 2 },
      ]);
  });

  it('detects webcrypto and subtle imported from node:crypto', () => {
    expect(compact("import { webcrypto, subtle } from 'node:crypto';\nwebcrypto.subtle.deriveBits({ name: 'ECDH', public: p }, k, 256);\nsubtle.encrypt({ name: 'RSA-OAEP' }, k, d);"))
      .toEqual([
        { algorithm: 'ECDH', status: 'vulnerable', ruleId: 'webcrypto-derive', line: 2 },
        { algorithm: 'RSA-OAEP', status: 'vulnerable', ruleId: 'webcrypto-encrypt', line: 3 },
      ]);
  });

  it('reads the algorithm from importKey argument 2 and a string algorithm from digest', () => {
    expect(compact("crypto.subtle.importKey('spki', der, { name: 'RSA-PSS', hash: 'SHA-256' }, true, ['verify']);\ncrypto.subtle.digest('SHA-256', data);"))
      .toEqual([
        { algorithm: 'RSA-PSS', status: 'vulnerable', ruleId: 'webcrypto-import', line: 1 },
        { algorithm: 'SHA-256', status: 'observed-resistant', ruleId: 'webcrypto-digest', line: 2 },
      ]);
  });

  it('resolves a const algorithm object and is case-insensitive', () => {
    expect(compact("const alg = { name: 'ml-dsa-65' } as const;\ncrypto.subtle.sign(alg, k, d);"))
      .toEqual([{ algorithm: 'ML-DSA-65', status: 'observed-resistant', ruleId: 'webcrypto-sign', line: 2 }]);
  });

  it.each([
    ["{ name: 'AES-GCM', length: 256 }", 'AES-256-GCM', 'observed-resistant'],
    ["{ name: 'AES-CBC', length: 192 }", 'AES-192-CBC', 'observed-resistant'],
    ["{ name: 'AES-GCM', length: 128 }", 'AES-128-GCM', 'unresolved'],
    ["{ name: 'HMAC', hash: 'SHA-256' }", 'HMAC-SHA-256', 'observed-resistant'],
    ["{ name: 'HMAC', hash: { name: 'SHA-512' } }", 'HMAC-SHA-512', 'observed-resistant'],
    ["{ name: 'HMAC', hash: 'SHA-1' }", 'HMAC-SHA-1', 'unresolved'],
    ["{ name: 'AES-GCM' }", 'AES-GCM', 'unresolved'],
    ["{ name: 'HMAC' }", 'HMAC', 'unresolved'],
  ])('generateKey %s resolves key length or hash', (algorithm, expected, status) => {
    expect(compact(`crypto.subtle.generateKey(${algorithm}, true, ['encrypt']);`)).toMatchObject([{ algorithm: expected, status }]);
  });

  it('reports a dynamic algorithm name as unresolved', () => {
    expect(compact("crypto.subtle.generateKey({ name: userChoice }, true, []);"))
      .toEqual([{ algorithm: null, status: 'unresolved', ruleId: 'webcrypto-keygen', line: 1 }]);
  });

  it('reports unhandled subtle calls as unresolved', () => {
    expect(compact("crypto.subtle.someFutureCall('jwk', key);"))
      .toEqual([{ algorithm: null, status: 'unresolved', ruleId: 'unhandled-crypto-api', line: 1 }]);
  });

  it('reads the wrapping algorithm from wrapKey and unwrapKey', () => {
    expect(compact("crypto.subtle.wrapKey('raw', key, wrapper, { name: 'RSA-OAEP' });\ncrypto.subtle.unwrapKey('raw', buf, k, 'AES-KW', 'AES-GCM', true, []);"))
      .toEqual([
        { algorithm: 'RSA-OAEP', status: 'vulnerable', ruleId: 'webcrypto-wrap', line: 1 },
        { algorithm: 'AES-KW', status: 'unresolved', ruleId: 'webcrypto-wrap', line: 2 },
      ]);
  });

  it('does not report calls that only operate on an existing key or are harmless utilities', () => {
    expect(compact("import { timingSafeEqual } from 'crypto';\ncrypto.subtle.exportKey('jwk', key);\ntimingSafeEqual(a, b);")).toEqual([]);
  });

  it('reports key-material imports as unresolved with a note', () => {
    expect(scanSource("import { createPrivateKey } from 'crypto';\ncreatePrivateKey(pem);", 'f.ts', rules))
      .toMatchObject([{ ruleId: 'node-key-material', status: 'unresolved', algorithm: null, note: expect.stringMatching(/key material/) }]);
  });

  it('does not treat a shadowing local crypto as WebCrypto', () => {
    expect(compact("const crypto = makeFake();\ncrypto.subtle.generateKey({ name: 'RSA-OAEP' });")).toEqual([]);
  });

  it('records CSPRNG use as observed-resistant', () => {
    expect(compact("crypto.getRandomValues(new Uint8Array(16));\ncrypto.randomUUID();"))
      .toEqual([
        { algorithm: 'CSPRNG', status: 'observed-resistant', ruleId: 'node-random', line: 1 },
        { algorithm: 'CSPRNG', status: 'observed-resistant', ruleId: 'node-random', line: 2 },
      ]);
  });
});

describe('additional Node crypto APIs', () => {
  it.each([
    ["import { diffieHellman } from 'crypto';\ndiffieHellman({ privateKey, publicKey });", 'ECDH/DH', 'node-key-exchange'],
    ["import { privateEncrypt } from 'crypto';\nprivateEncrypt(key, buf);", 'RSA', 'node-rsa-encrypt'],
    ["import { createHmac } from 'crypto';\ncreateHmac('sha256', key);", 'HMAC-SHA-256', 'node-hmac'],
    ["import { createHash } from 'crypto';\ncreateHash('sha3-256');", 'SHA3-256', 'node-hash'],
    ["import { createCipheriv } from 'crypto';\ncreateCipheriv('chacha20-poly1305', k, n);", 'ChaCha20-Poly1305', 'node-cipher'],
    ["import { generateKeyPairSync } from 'crypto';\ngenerateKeyPairSync('x448');", 'X448', 'node-keygen'],
    ["import { sign } from 'crypto';\nsign('sha256', data, key);", 'RSA', 'node-oneshot-signature'],
  ])('%s', (code, algorithm, ruleId) => {
    expect(compact(code)).toMatchObject([{ algorithm, ruleId }]);
  });

  it('does not resolve inherited object keys as algorithm names', () => {
    expect(compact("import { createHash } from 'crypto';\ncreateHash('constructor');"))
      .toEqual([{ algorithm: null, status: 'unresolved', ruleId: 'node-hash', line: 2 }]);
  });
});

describe('scope-aware shadowing', () => {
  it('still sees the global crypto when another function declares a local named crypto', () => {
    expect(compact("async function check() { await crypto.subtle.generateKey({ name: 'RSA-OAEP' }, true, []); }\nasync function other() { let crypto = await check(); return crypto; }"))
      .toMatchObject([{ ruleId: 'webcrypto-keygen', algorithm: 'RSA-OAEP' }]);
  });

  it('does not see the global when a parameter shadows it', () => {
    expect(compact("function f(crypto) { crypto.subtle.generateKey({ name: 'RSA-OAEP' }, true, []); }")).toEqual([]);
  });

  it('does not see the global inside a block that declares its own crypto', () => {
    expect(compact("{ const crypto = fake(); crypto.subtle.generateKey({ name: 'RSA-OAEP' }, true, []); }")).toEqual([]);
  });

  it('does not attribute an imported name to a parameter that shadows it', () => {
    expect(compact("import { createHash } from 'crypto';\nfunction f(createHash) { createHash('md5'); }\ncreateHash('sha256');"))
      .toMatchObject([{ line: 3, algorithm: 'SHA-256' }]);
  });
});

describe('WebCrypto polyfill instances', () => {
  it('follows `new Crypto()` from @peculiar/webcrypto (CommonJS and ESM)', () => {
    expect(compact("const { Crypto } = require('@peculiar/webcrypto');\nconst crypto = new Crypto();\ncrypto.subtle.generateKey({ name: 'ECDSA' }, true, []);"))
      .toMatchObject([{ ruleId: 'webcrypto-keygen', algorithm: 'ECDSA', line: 3 }]);
    expect(compact("import { Crypto } from '@peculiar/webcrypto';\nconst webcrypto = new Crypto();\nwebcrypto.subtle.sign({ name: 'RSA-PSS' }, k, d);"))
      .toMatchObject([{ ruleId: 'webcrypto-sign', algorithm: 'RSA-PSS' }]);
  });

  it('ignores an unrelated class named Crypto', () => {
    expect(compact("import { Crypto } from './mine';\nconst crypto = new Crypto();\ncrypto.subtle.generateKey({ name: 'ECDSA' }, true, []);")).toEqual([]);
  });
});
