import { type SpawnSyncOptions, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ResultCache, installedVersion } from '../src/core/cache.ts';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { cwd: root, encoding: 'utf8' });
const cliWithKey = (key: string, ...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, PQC_SCAN_CACHE_KEY: key } } satisfies SpawnSyncOptions);
// A cache is kept outside the folder being scanned (inside it, it is refused unless signed).
const cacheOutside = () => join(mkdtempSync(join(tmpdir(), 'pqc-cache-store-')), 'cache.json');

// Each test starts the command-line tool up to three times, which can take over 5 s on a slow CI machine.
describe('--cache', { timeout: 30_000 }, () => {
  const project = () => {
    const dir = mkdtempSync(join(tmpdir(), 'pqc-cache-'));
    writeFileSync(join(dir, 'a.c'), 'void f(void) { SHA256(d, n, out); }\n');
    writeFileSync(join(dir, 'b.ts'), "import { createHash } from 'crypto';\ncreateHash('md5');\n");
    return dir;
  };

  it('gives the same report from the cache as from a fresh scan', () => {
    const dir = project();
    const cacheFile = cacheOutside();
    const fresh = cli(dir, '--json');
    const first = cli(dir, '--json', '--cache', cacheFile);
    const second = cli(dir, '--json', '--cache', cacheFile);
    expect(first.stdout).toBe(fresh.stdout);
    expect(second.stdout).toBe(fresh.stdout);
    expect(second.status).toBe(fresh.status);
    expect(Object.keys(JSON.parse(JSON.parse(readFileSync(cacheFile, 'utf8')).body).files)).toHaveLength(2);
  });

  it('rescans a file whose contents changed', () => {
    const dir = project();
    const cacheFile = cacheOutside();
    cli(dir, '--json', '--cache', cacheFile);
    writeFileSync(join(dir, 'a.c'), 'void f(void) { RSA_generate_key_ex(k, 2048, e, 0); }\n');
    const report = JSON.parse(cli(dir, '--json', '--cache', cacheFile).stdout);
    expect(report.findings.map((item: { algorithm: string }) => item.algorithm)).toEqual(['RSA', 'MD5']);
  });

  it('ignores a cache written by a different version of the scanner or its rules', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pqc-cache-'));
    const cacheFile = join(dir, 'cache.json');
    const key = ResultCache.key('a.c', 'text');
    writeFileSync(cacheFile, JSON.stringify({ body: JSON.stringify({ version: 'older', files: { [key]: [] } }) }));
    expect(new ResultCache(cacheFile).get(key)).toBeUndefined();
  });

  it('ignores an unreadable cache file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pqc-cache-'));
    writeFileSync(join(dir, 'cache.json'), '{ not json');
    expect(new ResultCache(join(dir, 'cache.json')).get('anything')).toBeUndefined();
  });

  it('refuses a cache inside the folder being scanned, unless it is signed', () => {
    const dir = project();
    const refused = cli(dir, '--json', '--cache', join(dir, 'cache.json'));
    expect(refused.status).toBe(2);
    expect(refused.stderr).toMatch(/inside the folder being scanned/);
    expect(cliWithKey('secret', dir, '--json', '--cache', join(dir, 'cache.json')).status).toBe(1);
  });

  it('ignores a planted cache that hides findings when the cache is signed', () => {
    const dir = project();
    const cacheFile = cacheOutside();
    const fresh = cli(dir, '--json');
    // An unsigned cache that says both files have no findings, as an attacker could write.
    cli(dir, '--json', '--cache', cacheFile);
    const saved = JSON.parse(readFileSync(cacheFile, 'utf8'));
    const body = JSON.parse(saved.body);
    for (const key of Object.keys(body.files)) body.files[key] = [];
    writeFileSync(cacheFile, JSON.stringify({ body: JSON.stringify(body) }));
    expect(JSON.parse(cli(dir, '--json', '--cache', cacheFile).stdout).findings).toEqual([]);
    // With a key, the planted cache is thrown away and the files are scanned again.
    const signed = cliWithKey('secret', dir, '--json', '--cache', cacheFile);
    expect(signed.stderr).toMatch(/not signed with this PQC_SCAN_CACHE_KEY/);
    expect(signed.stdout).toBe(fresh.stdout);
  });

  it('ignores a signed cache that was changed, or signed with another key', () => {
    const dir = project();
    const cacheFile = cacheOutside();
    const fresh = cli(dir, '--json');
    cliWithKey('secret', dir, '--json', '--cache', cacheFile);
    expect(cliWithKey('secret', dir, '--json', '--cache', cacheFile).stderr).not.toMatch(/not signed/);
    expect(cliWithKey('other', dir, '--json', '--cache', cacheFile).stderr).toMatch(/not signed with this PQC_SCAN_CACHE_KEY/);
    cliWithKey('secret', dir, '--json', '--cache', cacheFile);
    const saved = JSON.parse(readFileSync(cacheFile, 'utf8'));
    const body = JSON.parse(saved.body);
    for (const key of Object.keys(body.files)) body.files[key] = [];
    writeFileSync(cacheFile, JSON.stringify({ body: JSON.stringify(body), mac: saved.mac }));
    const tampered = cliWithKey('secret', dir, '--json', '--cache', cacheFile);
    expect(tampered.stderr).toMatch(/not signed/);
    expect(tampered.stdout).toBe(fresh.stdout);
  });

  it('asks for a file name when --cache has none', () => {
    const result = cli(project(), '--cache');
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/--cache needs a file name/);
  });
});

describe('--max-file-size', { timeout: 30_000 }, () => {
  it('reports a file over the limit as not scanned, instead of reading it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pqc-size-'));
    writeFileSync(join(dir, 'big.c'), `void f(void) { RSA_generate_key_ex(k, 2048, e, 0); }\n${' '.repeat(2048)}\n`);
    writeFileSync(join(dir, 'small.c'), 'void f(void) { SHA256(d, n, out); }\n');
    const result = cli(dir, '--json', '--max-file-size', '0.001');
    const findings = JSON.parse(result.stdout).findings.map((item: { file: string; ruleId: string; status: string }) => `${item.file} ${item.ruleId} ${item.status}`);
    expect(findings).toEqual(['big.c file-too-large unresolved', 'small.c openssl-sha256 observed-resistant']);
    expect(result.status).toBe(1);
  });

  it('asks for a size above 0', () => {
    const result = cli(mkdtempSync(join(tmpdir(), 'pqc-size-')), '--max-file-size', 'lots');
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/--max-file-size needs a size in MB/);
  });
});

it('finds the version of each package the scanner reads code with, for the cache fingerprint', () => {
  // web-tree-sitter does not export its package.json, which once made its version drop out of the fingerprint.
  for (const name of ['typescript', 'web-tree-sitter', 'yaml']) expect(installedVersion(name), name).toMatch(/^\d+\.\d+\.\d+/);
  expect(installedVersion('no-such-package-pqc')).toBeUndefined();
});
