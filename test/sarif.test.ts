import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';

const root = new URL('..', import.meta.url).pathname;
const cli = (...args: string[]) => spawnSync('npx', ['tsx', 'src/cli.ts', '--quiet', ...args], { cwd: root, encoding: 'utf8' });
const outside = (name: string) => join(mkdtempSync(join(tmpdir(), 'pqc-out-')), name);

// The official schema is JSON Schema draft-04; its only draft-04 parts are the `id` and `$schema` keywords, renamed
// here so Ajv (draft-07) can read it. URI and date formats are not checked.
const sarifSchema = JSON.parse(readFileSync(join(root, 'test/schemas/sarif-schema-2.1.0.json'), 'utf8'));
sarifSchema.$id = sarifSchema.id;
delete sarifSchema.id;
delete sarifSchema.$schema;
const validateSarif = new Ajv({ strict: false, validateFormats: false }).compile(sarifSchema);
const validateReport = new Ajv({ strict: false }).compile(JSON.parse(readFileSync(join(root, 'schema/report-v1.schema.json'), 'utf8')));

const project = () => {
  const dir = mkdtempSync(join(tmpdir(), 'pqc-sarif-'));
  writeFileSync(join(dir, 'keys.c'), 'void f(void) {\n  RSA_generate_key_ex(k, 2048, e, 0);\n  SHA256(d, n, out);\n  MD5(d, n, out);\n}\n');
  return dir;
};

describe('--sarif', { timeout: 30_000 }, () => {
  it('writes valid SARIF 2.1.0 with the findings that need action', () => {
    const file = outside('out.sarif');
    cli(project(), '--sarif', file);
    const log = JSON.parse(readFileSync(file, 'utf8'));
    expect(validateSarif(log), JSON.stringify(validateSarif.errors)).toBe(true);
    const results = log.runs[0].results.map((result: { ruleId: string; locations: { physicalLocation: { artifactLocation: { uri: string }; region: { startLine: number } } }[] }) =>
      `${result.locations[0].physicalLocation.artifactLocation.uri}:${result.locations[0].physicalLocation.region.startLine} ${result.ruleId}`);
    // SHA-256 is ✅, so it is not an alert.
    expect(results).toEqual(['keys.c:2 pqc-scan/vulnerable', 'keys.c:4 pqc-scan/needs-review']);
  });

  it('gives every rule the text GitHub code scanning requires, and every result a fingerprint', () => {
    const file = outside('out.sarif');
    cli(project(), '--sarif', file);
    const run = JSON.parse(readFileSync(file, 'utf8')).runs[0];
    for (const rule of run.tool.driver.rules) {
      expect(rule.shortDescription.text && rule.fullDescription.text && rule.help.text).toBeTruthy();
      expect(Number(rule.properties['security-severity'])).toBeGreaterThan(0);
    }
    for (const result of run.results) expect(result.partialFingerprints['pqcScan/v1']).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('--baseline', { timeout: 60_000 }, () => {
  it('fails only on findings that are not in the baseline, even after code moves', () => {
    const dir = project();
    const baseline = outside('baseline.json');
    expect(cli(dir, '--write-baseline', baseline).status).toBe(1);
    const unchanged = cli(dir, '--json', '--baseline', baseline);
    expect(unchanged.status).toBe(0);
    expect(JSON.parse(unchanged.stdout)).toMatchObject({ findings: [], baseline: { known: 3 } });
    // Lines move down, and one new use is added.
    writeFileSync(join(dir, 'keys.c'), '// moved\n\nvoid f(void) {\n  RSA_generate_key_ex(k, 2048, e, 0);\n  SHA256(d, n, out);\n  MD5(d, n, out);\n  DH_generate_key(dh);\n}\n');
    const changed = cli(dir, '--json', '--baseline', baseline);
    const report = JSON.parse(changed.stdout);
    expect(validateReport(report), JSON.stringify(validateReport.errors)).toBe(true);
    expect(report.findings.map((item: { line: number; algorithm: string }) => `${item.line} ${item.algorithm}`)).toEqual(['7 DH']);
    expect(report.baseline).toEqual({ known: 3 });
    expect(changed.status).toBe(1);
  });

  it('counts a repeated identical line once per copy', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pqc-sarif-'));
    writeFileSync(join(dir, 'a.c'), 'void f(void) {\n  MD5(d, n, out);\n}\n');
    const baseline = outside('baseline.json');
    cli(dir, '--write-baseline', baseline);
    writeFileSync(join(dir, 'a.c'), 'void f(void) {\n  MD5(d, n, out);\n  MD5(d, n, out);\n}\n');
    expect(JSON.parse(cli(dir, '--json', '--baseline', baseline).stdout).findings.map((item: { line: number }) => item.line)).toEqual([3]);
  });

  it('marks results as new or unchanged in SARIF', () => {
    const dir = project();
    const baseline = outside('baseline.json');
    cli(dir, '--write-baseline', baseline);
    writeFileSync(join(dir, 'keys.c'), `${readFileSync(join(dir, 'keys.c'), 'utf8')}void g(void) { DH_generate_key(dh); }\n`);
    const file = outside('out.sarif');
    cli(dir, '--baseline', baseline, '--sarif', file);
    expect(JSON.parse(readFileSync(file, 'utf8')).runs[0].results.map((result: { baselineState: string }) => result.baselineState)).toEqual(['unchanged', 'unchanged', 'new']);
  });

  it('stops with status 2 when the baseline is not one', () => {
    const file = outside('baseline.json');
    writeFileSync(file, '{"findings": 3}');
    const result = cli(project(), '--baseline', file);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/is not a pqc-scan baseline/);
  });
});
