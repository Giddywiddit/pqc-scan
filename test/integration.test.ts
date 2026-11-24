import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadRules } from '../src/core/rules.ts';
import { loadLanguages, scan } from '../src/core/scan.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixture = (name: string) => join(root, 'test/fixtures', name);
beforeAll(() => loadLanguages());
const cli = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { cwd: root, encoding: 'utf8' });

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

  it("skips a Rust project's target folder, but not a folder named target elsewhere", () => {
    const dir = mkdtempSync(join(tmpdir(), 'pqc-target-'));
    const code = 'fn f() { let h = sha2::Sha256::new(); }\n';
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "x"\n');
    for (const folder of ['target/debug/build/x/out', 'src', 'tools/target']) {
      mkdirSync(join(dir, folder), { recursive: true });
      writeFileSync(join(dir, folder, 'a.rs'), code);
    }
    expect(scan(dir, loadRules()).map((item) => item.file).sort()).toEqual(['src/a.rs', 'tools/target/a.rs']);
  });

  it("skips a Go module's vendor folder, but not a folder named vendor elsewhere", () => {
    const dir = mkdtempSync(join(tmpdir(), 'pqc-vendor-'));
    const code = 'package p\n\nimport "crypto/md5"\n\nvar h = md5.New()\n';
    writeFileSync(join(dir, 'go.mod'), 'module example.com/x\n');
    for (const folder of ['vendor/golang.org/x/crypto', 'cmd', 'tools/vendor']) {
      mkdirSync(join(dir, folder), { recursive: true });
      writeFileSync(join(dir, folder, 'a.go'), code);
    }
    expect(scan(dir, loadRules()).map((item) => item.file).sort()).toEqual(['cmd/a.go', 'tools/vendor/a.go']);
  });

  it('flags importers of a wrapper whose algorithm is decided by its callers, across extensions and re-exports', () => {
    const expected = JSON.parse(readFileSync(join(fixture('wrapper'), 'expected.json'), 'utf8'));
    const actual = scan(fixture('wrapper'), loadRules())
      .map(({ file, line, ruleId, status }) => ({ file, line, ruleId, status }))
      .sort((a, b) => a.file.localeCompare(b.file));
    expect(actual).toEqual(expected);
  });

  it('does not flag importers of a module that only has fixed algorithms, nor a file importing itself', () => {
    const files = scan(fixture('wrapper'), loadRules()).filter((item) => item.ruleId === 'crypto-via-local-module').map((item) => item.file);
    expect(files).not.toContain('fixed-consumer.ts');
  });

  it('does not resolve local imports when scanning a single file', () => {
    expect(scan(join(fixture('wrapper'), 'consumer.ts'), loadRules())).toEqual([]);
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
    mkdirSync(join(dir, 'javascript'));
    writeFileSync(join(dir, 'javascript', 'bad.yaml'), yaml);
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
    expect(JSON.parse(result.stdout).findings).toMatchObject([{ algorithm: 'RSA', status: 'vulnerable' }]);
  });

  it('exits 0 when only observed-resistant findings exist', () => {
    const result = cli(fixture('cli-observed'), '--json');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).findings).toMatchObject([{ status: 'observed-resistant' }]);
  });

  it('prints the cat banner, a readable table and a verdict by default', () => {
    const result = cli(fixture('cli-vulnerable'));
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/\/\\_\/\\/);
    expect(result.stdout).toMatch(/^VULNERABLE\s+index\.ts:2\s+RSA$/m);
    // Piped output (as here) has no colour codes, and no emoji anywhere.
    expect(result.stdout).not.toMatch(/\x1b\[|\p{Extended_Pictographic}/u);
    expect(result.stdout).toMatch(/1 finding\(s\): 1 vulnerable/);
    expect(result.stdout).toMatch(/Quantum risk found/);
  });

  it('keeps --json output free of the banner so it can be piped', () => {
    const result = cli(fixture('cli-vulnerable'), '--json');
    expect(result.stdout.trimStart().startsWith('{')).toBe(true);
    expect(result.stdout).not.toMatch(/pqc-scan •/);
  });

  it('hides the banner with --quiet', () => {
    const result = cli(fixture('cli-observed'), '--quiet');
    expect(result.status).toBe(0);
    expect(result.stdout).not.toMatch(/pqc-scan •/);
    expect(result.stdout).toMatch(/^RESISTANT\s/m);
  });

  it('says plainly that an empty scan is not a security conclusion', () => {
    const result = cli(fixture('empty'), '--quiet');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/not a security conclusion/);
  });

  it('writes the whole --json report to a pipe, even past 64 KB', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pqc-large-'));
    writeFileSync(join(dir, 'many.c'), Array.from({ length: 400 }, (_, index) => `void f${index}(void) { RSA_generate_key_ex(k, 2048, e, 0); }`).join('\n'));
    const result = cli(dir, '--json');
    expect(result.stdout.length).toBeGreaterThan(65536);
    expect(JSON.parse(result.stdout).summary.total).toBe(400);
    expect(result.status).toBe(1);
  });

  it('scans C files end to end, loading the C parser before the scan', () => {
    const result = cli(fixture('c'), '--json');
    expect(result.status).toBe(1);
    const files = new Set(JSON.parse(result.stdout).findings.map((item: { file: string }) => item.file));
    // Every fixture that expects a finding is reported by the CLI, and no other file is.
    const expected = readdirSync(fixture('c')).filter((name) => readFileSync(join(fixture('c'), name), 'utf8').includes('expect: '));
    expect(expected.length).toBeGreaterThan(5);
    expect(files).toEqual(new Set(expected));
  });

  it('fails clearly for a nonexistent path', () => {
    const result = cli(join(tmpdir(), 'pqc-does-not-exist'));
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/pqc-scan: path not found/);
    expect(result.stderr).not.toMatch(/at .*\.ts/);
  });
});
