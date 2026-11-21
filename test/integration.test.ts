import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadRules } from '../src/rules.ts';
import { scan } from '../src/scanner.ts';

const root = new URL('..', import.meta.url).pathname;
const fixture = (name: string) => join(root, 'test/fixtures', name);
const cli = (...args: string[]) => spawnSync('npx', ['tsx', 'src/cli.ts', ...args], { cwd: root, encoding: 'utf8' });

describe('filesystem scanning', () => {
  it('scans a multi-file directory and reports paths relative to it', () => {
    const expected = JSON.parse(readFileSync(join(fixture('mixed'), 'expected.json'), 'utf8'));
    const actual = scan(fixture('mixed'), loadRules())
      .map(({ file, line, algorithm, status }) => ({ file, line, algorithm, status }))
      .sort((a, b) => a.file.localeCompare(b.file));
    expect(actual).toEqual(expected);
  });

  it('skips node_modules, dist, .git and non-source files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pqc-skip-'));
    const code = "import { generateKeyPairSync } from 'crypto';\ngenerateKeyPairSync('rsa');\n";
    for (const skipped of ['node_modules/pkg', 'dist', '.git']) {
      mkdirSync(join(dir, skipped), { recursive: true });
      writeFileSync(join(dir, skipped, 'a.js'), code);
    }
    writeFileSync(join(dir, 'notes.md'), code);
    writeFileSync(join(dir, 'real.ts'), code);
    expect(scan(dir, loadRules()).map((item) => item.file)).toEqual(['real.ts']);
  });

  it('scans a single file target', () => {
    const findings = scan(join(fixture('mixed'), 'keys.js'), loadRules());
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('keys.js');
  });

  it('reports unparseable files as unresolved instead of crashing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pqc-bad-'));
    writeFileSync(join(dir, 'broken.ts'), 'const = ;');
    const findings = scan(dir, loadRules());
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: 'parse-error', status: 'unresolved' });
  });
});

describe('rule loading', () => {
  const load = (yaml: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'pqc-rules-'));
    writeFileSync(join(dir, 'bad.yaml'), yaml);
    return () => loadRules(pathToFileURL(dir + '/'));
  };

  it('rejects a non-object rule file', () => expect(load('- just\n- a list\n')).toThrow(/module must be/));
  it('rejects a missing module list', () => expect(load('rules: []\n')).toThrow(/module must be a non-empty/));
  it('rejects a rule without a category', () =>
    expect(load('module: [x]\nrules:\n  - id: r\n    functions: [f]\n    algorithm: RSA\n    status: vulnerable\n')).toThrow(/requires a category/));
  it('rejects a fixed algorithm without status', () =>
    expect(load('module: [x]\nrules:\n  - id: r\n    functions: [f]\n    category: keygen\n    algorithm: RSA\n')).toThrow(/requires a status/));
  it('rejects algorithmFrom without values', () =>
    expect(load('module: [x]\nrules:\n  - id: r\n    functions: [f]\n    category: keygen\n    algorithmFrom: { arg: 0 }\n')).toThrow(/requires values/));
  it('rejects malformed YAML', () => expect(load('module: [unclosed\n')).toThrow());
  it('loads the bundled rules', () => expect(loadRules().length).toBeGreaterThan(0));
});

describe('CLI contract', () => {
  it('exits 2 with usage when no path is given', () => {
    const result = cli();
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Usage/);
  });

  it('exits 1 and emits JSON findings for vulnerable code', () => {
    const result = cli(fixture('cli-vulnerable'), '--json');
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject([{ algorithm: 'RSA', status: 'vulnerable' }]);
  });

  it('exits 0 when only observed-resistant findings exist', () => {
    const result = cli(fixture('cli-observed'), '--json');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject([{ status: 'observed-resistant' }]);
  });

  it('prints a human summary without --json', () => {
    const result = cli(fixture('cli-vulnerable'));
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/vulnerable\tindex\.ts:2\tRSA/);
    expect(result.stdout).toMatch(/1 finding\(s\)/);
  });

  it('fails clearly for a nonexistent path', () => {
    const result = cli(join(tmpdir(), 'pqc-does-not-exist'));
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/pqc-scan: path not found/);
    expect(result.stderr).not.toMatch(/at .*\.ts/);
  });
});
