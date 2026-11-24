import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { Finding } from '../core/types.ts';

// A CycloneDX 1.7 cryptography bill of materials (CBOM): one component per algorithm found, with every file and line
// it is used on. CycloneDX 1.7 is the Ecma standard ECMA-424, 2nd edition (December 2025).

const version = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;

type Primitive = 'drbg' | 'mac' | 'block-cipher' | 'stream-cipher' | 'signature' | 'hash' | 'pke' | 'xof' | 'kdf' | 'key-agree' | 'kem' | 'ae' | 'key-wrap' | 'other' | 'unknown';
type Mode = 'cbc' | 'ecb' | 'ccm' | 'gcm' | 'cfb' | 'ofb' | 'ctr' | 'other' | 'unknown';

export interface AlgorithmProperties {
  primitive: Primitive;
  algorithmFamily?: string;
  parameterSetIdentifier?: string;
  mode?: Mode;
  ellipticCurve?: string;
  nistQuantumSecurityLevel?: number;
}

/**
 * CycloneDX's registry of algorithm families (schema/cyclonedx/cryptography-defs.json, from the CycloneDX 1.7.2
 * release). Each family lists name patterns, each with its primitive. Pattern grammar: `[x]` is optional, `(a|b)` is a
 * choice, `{name}` stands for any value.
 */
const registry = (JSON.parse(readFileSync(new URL('../../schema/cyclonedx/cryptography-defs.json', import.meta.url), 'utf8')) as {
  algorithms: { family: string; variant: { pattern: string; primitive: Primitive }[] }[];
}).algorithms.flatMap(({ family, variant }) => variant.map(({ pattern, primitive }) => ({
  family,
  primitive,
  pattern: new RegExp(`^(?:${pattern.replace(/[.*+?^$\\/]/g, '\\$&').replace(/\(/g, '(?:').replace(/\[/g, '(?:').replace(/\]/g, ')?').replace(/\{[^}]+\}/g, '(.+?)')})$`, 'i'),
})));

/** The registry entry for an algorithm name: the most specific pattern, whose `{...}` parts cover the least of it. */
export function registryEntry(algorithm: string): { family: string; primitive: Primitive } | undefined {
  let best: { family: string; primitive: Primitive; free: number } | undefined;
  for (const entry of registry) {
    const match = entry.pattern.exec(algorithm);
    if (!match) continue;
    const free = match.slice(1).reduce((sum, part) => sum + (part?.length ?? 0), 0);
    if (!best || free < best.free) best = { ...entry, free };
  }
  return best && { family: best.family, primitive: best.primitive };
}

/**
 * The primitive for names the registry does not list (`CSPRNG`, `X25519MLKEM768`, `EC-P-256`, `ML-KEM`), in the same
 * terms. The first pattern that matches wins. A test checks this table agrees with the registry wherever both know a name.
 */
const PRIMITIVES: [RegExp, Primitive][] = [
  [/^(CSPRNG|RAND_pseudo_bytes)$/, 'drbg'],
  [/^(HMAC|Poly1305$|AES(-\d+)?-(CMAC|GMAC)$)/, 'mac'],
  [/^(HKDF|PBKDF2|Argon2|scrypt$|bcrypt$)/, 'kdf'],
  [/^SHAKE/, 'xof'],
  [/^(SHA|MD[245]|MD4 or MD2|RIPEMD|BLAKE2|Keccak|SM3)/, 'hash'],
  [/(GCM|CCM|OCB|SIV)$|Poly1305$/, 'ae'],
  [/^(AES(-\d+)?-(KW|KWP)$)/, 'key-wrap'],
  [/^(AES|DES|3DES|Blowfish|CAST5|CBC$|CTR$|ECB$)/, 'block-cipher'],
  [/^(RC4|ChaCha20|Salsa20)$/, 'stream-cipher'],
  [/(ML-KEM|Kyber|FrodoKEM|McEliece|X-Wing|MLKEM|mlkem|DHKEM)/, 'kem'],
  [/^(X25519|X448|ECDH|DH$|ECDH\/DH$)/, 'key-agree'],
  [/^(RSA-OAEP|ElGamal|ECIES|RSA)$/, 'pke'],
  [/^(DSA|ECDSA|Ed25519|Ed448|EdDSA|ML-DSA|Dilithium|SLH-DSA|SPHINCS\+|XMSS|LMS|HSS\/LMS|BLS|RSA-PSS|RSA\/ECDSA|GOST R 34\.10|SM2|ECGDSA|ECKCDSA|Rabin)/, 'signature'],
  // An elliptic-curve key (EC-P-256) can sign or agree on keys; which one is not known from where it is made.
  [/^EC(-|$)/, 'unknown'],
];

const MODES: Record<string, Mode> = { CBC: 'cbc', ECB: 'ecb', CCM: 'ccm', GCM: 'gcm', CFB: 'cfb', OFB: 'ofb', CTR: 'ctr' };
/** Curve names in the rules, as CycloneDX's registry of elliptic curves names them. */
const CURVES: Record<string, string> = { 'P-224': 'nist/P-224', 'P-256': 'nist/P-256', 'P-384': 'nist/P-384', 'P-521': 'nist/P-521', secp256k1: 'secg/secp256k1', X25519: 'other/Curve25519', X448: 'other/Curve448', Ed25519: 'other/Ed25519', Ed448: 'other/Ed448' };

/**
 * NIST security strength categories that a NIST document states for the algorithm: FIPS 203 (ML-KEM), FIPS 204
 * (ML-DSA), FIPS 205 (SLH-DSA), and the category definitions themselves (AES-128, -192 and -256 are categories 1, 3 and
 * 5; SHA-256 and SHA3-256 collisions are category 2, SHA-384 and SHA3-384 category 4). A hybrid key exchange is at least
 * as strong as its ML-KEM part. Anything else is left out rather than guessed.
 */
function category(algorithm: string): number | undefined {
  const pq = /^(ML-KEM|ML-DSA)-(\d+)$/.exec(algorithm);
  if (pq) return ({ 'ML-KEM-512': 1, 'ML-KEM-768': 3, 'ML-KEM-1024': 5, 'ML-DSA-44': 2, 'ML-DSA-65': 3, 'ML-DSA-87': 5 } as Record<string, number>)[algorithm];
  const slh = /^SLH-DSA-SHA(?:2|KE)-(128|192|256)[sf]$/.exec(algorithm);
  if (slh) return { 128: 1, 192: 3, 256: 5 }[slh[1] as '128' | '192' | '256'];
  if (/^(X25519MLKEM768|SecP256r1MLKEM768|X-Wing|mlkem768x25519-sha256)$/.test(algorithm)) return 3;
  if (algorithm === 'SecP384r1MLKEM1024') return 5;
  const aes = /^AES-(128|192|256)(-|$)/.exec(algorithm);
  if (aes) return { 128: 1, 192: 3, 256: 5 }[aes[1] as '128' | '192' | '256'];
  if (/^SHA3?-256$/.test(algorithm)) return 2;
  if (/^SHA3?-384$/.test(algorithm)) return 4;
  return undefined;
}

/** The primitive from this scanner's own table, for names the registry does not list. */
export const tablePrimitive = (algorithm: string): Primitive => PRIMITIVES.find(([pattern]) => pattern.test(algorithm))?.[1] ?? 'unknown';

/** CycloneDX algorithm properties for an algorithm name as the rules write it. `vulnerable` sets category 0. */
export function algorithmProperties(algorithm: string, vulnerable: boolean): AlgorithmProperties {
  const entry = registryEntry(algorithm);
  const primitive = entry?.primitive ?? tablePrimitive(algorithm);
  const properties: AlgorithmProperties = { primitive, ...(entry ? { algorithmFamily: entry.family } : {}) };
  const size = /^(?:AES|SHA3|SHA|ML-KEM|ML-DSA|SHAKE)-?(\d+)(?:-|$)/.exec(algorithm)?.[1] ?? /^SLH-DSA-(SHA2-\d+[sf]|SHAKE-\d+[sf])$/.exec(algorithm)?.[1];
  if (size) properties.parameterSetIdentifier = size;
  const mode = /^AES(?:-\d+)?-([A-Z]+)$/.exec(algorithm)?.[1];
  if (primitive === 'block-cipher' && mode) properties.mode = MODES[mode] ?? 'other';
  if (primitive === 'ae' && /^AES/.test(algorithm)) properties.mode = /-GCM$/.test(algorithm) ? 'gcm' : /-CCM$/.test(algorithm) ? 'ccm' : 'other';
  const curve = /-(P-\d+|secp256k1)$/.exec(algorithm)?.[1] ?? /^(X25519|X448|Ed25519|Ed448)$/.exec(algorithm)?.[1];
  if (curve && CURVES[curve]) properties.ellipticCurve = CURVES[curve];
  const level = vulnerable ? 0 : category(algorithm);
  if (level !== undefined) properties.nistQuantumSecurityLevel = level;
  return properties;
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The CBOM for `findings`, from a scan of `target`. Findings whose algorithm is not known share one component. */
export function toCbom(findings: Finding[], target: string): object {
  const groups = new Map<string, Finding[]>();
  for (const item of findings) {
    const name = item.algorithm ?? 'Unresolved';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name)!.push(item);
  }
  const components = [...groups].sort(([left], [right]) => left.localeCompare(right)).map(([name, items]) => {
    const statuses = [...new Set(items.map((item) => item.status))].sort();
    return {
      type: 'cryptographic-asset',
      'bom-ref': `crypto/algorithm/${slug(name)}`,
      name,
      cryptoProperties: {
        assetType: 'algorithm',
        algorithmProperties: name === 'Unresolved' ? { primitive: 'unknown' } : algorithmProperties(name, statuses.includes('vulnerable')),
      },
      evidence: {
        occurrences: items.map((item) => ({
          location: item.file.split('\\').join('/'),
          line: item.line,
          ...(item.note ? { additionalContext: item.note } : {}),
        })),
      },
      properties: statuses.map((status) => ({ name: 'pqc-scan:status', value: status })),
    };
  });
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.7',
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: { components: [{ type: 'application', name: 'pqc-scan', version }] },
      component: { type: 'application', 'bom-ref': 'scanned', name: basename(target) },
    },
    components,
  };
}
