import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';
import { loadRules } from '../src/core/rules.ts';
import type { Finding } from '../src/core/types.ts';
import { registryEntry, tablePrimitive, toCbom } from '../src/output/cbom.ts';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const schema = (name: string) => JSON.parse(readFileSync(join(root, 'test/schemas', name), 'utf8'));
// URI, e-mail and date formats are not checked.
const ajv = new Ajv({ strict: false, validateFormats: false });
for (const name of ['spdx.schema.json', 'jsf-0.82.schema.json', 'cryptography-defs.schema.json']) ajv.addSchema(schema(name));
const validate = ajv.compile(schema('bom-1.7.schema.json'));

/** Every algorithm name the rules can report, with whether any rule reports it as vulnerable. */
const algorithms = new Map<string, boolean>();
for (const group of loadRules()) for (const rule of group.rules) {
  const add = (name: string | undefined, status: string | undefined) => {
    if (name) algorithms.set(name, (algorithms.get(name) ?? false) || status === 'vulnerable');
  };
  add(rule.algorithm, rule.status);
  for (const value of Object.values(rule.values ?? {})) add(value.algorithm, value.status);
}

describe('--cbom', () => {
  it('describes every algorithm the rules can report in valid CycloneDX 1.7', () => {
    const findings: Finding[] = [...algorithms].map(([algorithm, vulnerable], index) => ({
      ruleId: 'r', file: 'a.c', line: index + 1, algorithm, category: 'unknown', status: vulnerable ? 'vulnerable' : 'observed-resistant', trace: [],
    }));
    const bom = toCbom(findings, '/tmp/project');
    expect(validate(bom), JSON.stringify(validate.errors?.slice(0, 3))).toBe(true);
    expect((bom as { components: unknown[] }).components).toHaveLength(algorithms.size);
  });

  it("agrees with CycloneDX's registry on the primitive of every name the registry lists", () => {
    const disagreements = [...algorithms.keys()].flatMap((name) => {
      const entry = registryEntry(name);
      return entry && entry.primitive !== tablePrimitive(name) ? [`${name}: registry ${entry.primitive}, table ${tablePrimitive(name)}`] : [];
    });
    expect(disagreements).toEqual([]);
  });

  it('lists each algorithm once with every place it is used, including ones not determined', { timeout: 30_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'pqc-cbom-'));
    writeFileSync(join(dir, 'keys.c'), 'void f(void) {\n  RSA_generate_key_ex(k, 2048, e, 0);\n  SHA256(d, n, out);\n  RSA_generate_key_ex(k, 4096, e, 0);\n  EVP_PKEY_CTX_new_id(id, NULL);\n}\n');
    const file = join(mkdtempSync(join(tmpdir(), 'pqc-out-')), 'cbom.json');
    spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', '--quiet', dir, '--cbom', file], { cwd: root, encoding: 'utf8' });
    const bom = JSON.parse(readFileSync(file, 'utf8'));
    expect(validate(bom), JSON.stringify(validate.errors?.slice(0, 3))).toBe(true);
    const summary = bom.components.map((component: { name: string; evidence: { occurrences: { line: number }[] }; properties: { value: string }[]; cryptoProperties: { algorithmProperties: { primitive: string; nistQuantumSecurityLevel?: number } } }) =>
      `${component.name} ${component.cryptoProperties.algorithmProperties.primitive} level=${component.cryptoProperties.algorithmProperties.nistQuantumSecurityLevel ?? '-'} lines=${component.evidence.occurrences.map((item) => item.line).join(',')} ${component.properties.map((item) => item.value).join(',')}`);
    expect(summary).toEqual(['RSA pke level=0 lines=2,4 vulnerable', 'SHA-256 hash level=2 lines=3 observed-resistant', 'Unresolved unknown level=- lines=5 unresolved']);
  });
});

it('ships the CycloneDX registry the CBOM output reads', () => {
  expect(readdirSync(join(root, 'schema/cyclonedx'))).toContain('cryptography-defs.json');
});
