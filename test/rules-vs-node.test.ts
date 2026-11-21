import { generateKeyPairSync, getCiphers, getHashes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadRules } from '../src/rules.ts';

// The rule-coverage test proves the scanner agrees with the rule files. This one checks the rule files against Node itself,
// so a misspelt or invented algorithm name cannot hide behind a self-consistent table.
const rules = loadRules().flatMap((group) => group.rules);
const valuesOf = (id: string) => Object.keys(rules.find((rule) => rule.id === id)?.values ?? {});

describe('rule tables match what Node actually accepts', () => {
  const ciphers = new Set(getCiphers().map((name) => name.toLowerCase()));
  const hashes = new Set(getHashes().map((name) => name.toLowerCase()));

  it.each(valuesOf('node-cipher'))('cipher %s exists', (name) => expect(ciphers.has(name)).toBe(true));
  it.each(valuesOf('node-hash'))('hash %s exists', (name) => expect(hashes.has(name)).toBe(true));
  it.each(valuesOf('node-hmac'))('hmac digest %s exists', (name) => expect(hashes.has(name)).toBe(true));
  it.each(valuesOf('node-signature'))('signature algorithm %s exists', (name) => expect(hashes.has(name)).toBe(true));
  it.each(valuesOf('node-oneshot-signature'))('sign digest %s exists', (name) => expect(hashes.has(name)).toBe(true));

  const options: Record<string, object> = {
    rsa: { modulusLength: 512 }, 'rsa-pss': { modulusLength: 1024 }, ec: { namedCurve: 'prime256v1' }, dh: { group: 'modp14' },
  };
  it.each(valuesOf('node-keygen'))('generateKeyPairSync accepts %s', (type) => {
    try {
      generateKeyPairSync(type as 'rsa', options[type] as never);
    } catch (error) {
      // ML-KEM and ML-DSA only exist on newer Node releases; any other failure means the name is wrong.
      const code = (error as { code?: string }).code;
      expect(type.startsWith('ml-') && code === 'ERR_INVALID_ARG_VALUE').toBe(true);
    }
  });
});

describe('JOSE algorithm names match RFC 7518 / RFC 8037', () => {
  const registered = new Set(['HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512', 'ES256K', 'PS256', 'PS384', 'PS512', 'EdDSA', 'none']);
  it.each(['jwt-sign', 'jwt-verify', 'jws-sign', 'jws-verify', 'jws-verify-call'])('%s uses registered names only', (id) => {
    expect(valuesOf(id).filter((name) => !registered.has(name))).toEqual([]);
    expect(valuesOf(id).length).toBe(registered.size);
  });
});
