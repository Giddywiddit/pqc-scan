import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ResultCache } from '../src/core/cache.ts';

const root = new URL('..', import.meta.url).pathname;
const cli = (...args: string[]) => spawnSync('npx', ['tsx', 'src/cli.ts', ...args], { cwd: root, encoding: 'utf8' });

describe('--cache', () => {
  const project = () => {
    const dir = mkdtempSync(join(tmpdir(), 'pqc-cache-'));
    writeFileSync(join(dir, 'a.c'), 'void f(void) { SHA256(d, n, out); }\n');
    writeFileSync(join(dir, 'b.ts'), "import { createHash } from 'crypto';\ncreateHash('md5');\n");
    return dir;
  };

  it('gives the same report from the cache as from a fresh scan', () => {
    const dir = project();
    const cacheFile = join(dir, 'cache.json');
    const fresh = cli(dir, '--json');
    const first = cli(dir, '--json', '--cache', cacheFile);
    const second = cli(dir, '--json', '--cache', cacheFile);
    expect(first.stdout).toBe(fresh.stdout);
    expect(second.stdout).toBe(fresh.stdout);
    expect(second.status).toBe(fresh.status);
    expect(Object.keys(JSON.parse(readFileSync(cacheFile, 'utf8')).files)).toHaveLength(2);
  });

  it('rescans a file whose contents changed', () => {
    const dir = project();
    const cacheFile = join(dir, 'cache.json');
    cli(dir, '--json', '--cache', cacheFile);
    writeFileSync(join(dir, 'a.c'), 'void f(void) { RSA_generate_key_ex(k, 2048, e, 0); }\n');
    const report = JSON.parse(cli(dir, '--json', '--cache', cacheFile).stdout);
    expect(report.findings.map((item: { algorithm: string }) => item.algorithm)).toEqual(['RSA', 'MD5']);
  });

  it('ignores a cache written by a different version of the scanner or its rules', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pqc-cache-'));
    const cacheFile = join(dir, 'cache.json');
    const key = ResultCache.key('a.c', 'text');
    writeFileSync(cacheFile, JSON.stringify({ version: 'older', files: { [key]: [] } }));
    expect(new ResultCache(cacheFile).get(key)).toBeUndefined();
  });

  it('ignores an unreadable cache file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pqc-cache-'));
    writeFileSync(join(dir, 'cache.json'), '{ not json');
    expect(new ResultCache(join(dir, 'cache.json')).get('anything')).toBeUndefined();
  });

  it('asks for a file name when --cache has none', () => {
    const result = cli(project(), '--cache');
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/--cache needs a file name/);
  });
});
