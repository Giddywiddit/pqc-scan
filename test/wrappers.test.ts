import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadRules } from '../src/core/rules.ts';
import { loadLanguages, scan } from '../src/core/scan.ts';
import type { Finding } from '../src/core/types.ts';

beforeAll(() => loadLanguages());

/** Scans a folder made of `files`. */
const scanFiles = (files: Record<string, string>): Finding[] => {
  const dir = mkdtempSync(join(tmpdir(), 'pqc-wrap-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return scan(dir, loadRules());
};
const brief = (findings: Finding[]) => findings.map((item) => `${item.file}:${item.line} ${item.algorithm ?? '-'} ${item.status}`).sort();
const noteAt = (findings: Finding[], place: string) => findings.find((item) => `${item.file}:${item.line}` === place)?.note;

describe('calls to functions that choose the crypto algorithm from a parameter', () => {
  it('reports a call that passes a written value with its algorithm, and lists the others on the function (C)', () => {
    const findings = scanFiles({
      'digest.c': 'const EVP_MD *pick(const char *name) {\n  return EVP_get_digestbyname(name);\n}\n',
      'main.c': 'void f(void) {\n  pick("sha1");\n  pick("sha256");\n  pick(getenv("DIGEST"));\n}\n',
    });
    expect(brief(findings)).toEqual(['digest.c:2 - unresolved', 'main.c:2 SHA-1 needs-review', 'main.c:3 SHA-256 observed-resistant']);
    expect(noteAt(findings, 'digest.c:2')).toBe('The algorithm is parameter 1 ("name") of pick(), so its callers choose it. 2 call(s) that pass a value written in the code are reported where they are. 1 call(s) pass a value that cannot be read here, such as main.c:4; check those by hand.');
  });

  it('says which functions pass their own parameter on', () => {
    const findings = scanFiles({
      'digest.c': 'const EVP_MD *pick(const char *name) { return EVP_get_digestbyname(name); }\n',
      'main.c': 'void f(const char *from_config) { pick(from_config); }\n',
    });
    expect(brief(findings)).toEqual(['digest.c:1 - unresolved']);
    expect(noteAt(findings, 'digest.c:1')).toBe('The algorithm is parameter 1 ("name") of pick(), so its callers choose it. 1 function(s) pass their own parameter on to it, such as f() (main.c:1), and their callers are followed too.');
  });

  it('follows a function that passes its parameter on to another one, across Go packages', () => {
    const findings = scanFiles({
      'sign/sign.go': 'package sign\n\nimport "github.com/golang-jwt/jwt/v5"\n\nfunc Method(name string) jwt.SigningMethod {\n\treturn jwt.GetSigningMethod(name)\n}\n',
      'api/api.go': 'package api\n\nimport "example.com/app/sign"\n\nfunc ForTenant(alg string) { sign.Method(alg) }\n',
      'main.go': 'package main\n\nimport "example.com/app/api"\n\nfunc main() { api.ForTenant("ES256") }\n',
    });
    expect(brief(findings)).toEqual(['main.go:5 ECDSA vulnerable', 'sign/sign.go:6 - unresolved']);
  });

  it('follows a C function called from C++, and a Rust function', () => {
    expect(brief(scanFiles({
      'pick.c': 'const EVP_MD *pick(const char *name) { return EVP_get_digestbyname(name); }\n',
      'use.cpp': 'void Hasher::run() { auto md = pick("md5"); }\n',
      'lib.rs': 'fn digest(name: &str) { let md = openssl::hash::MessageDigest::from_name(name); }\nfn main() { digest("sha3-512"); }\n',
    }))).toEqual(['lib.rs:1 - unresolved', 'lib.rs:2 SHA3-512 observed-resistant', 'pick.c:1 - unresolved', 'use.cpp:1 MD5 needs-review']);
  });

  it('matches a call only where the language allows it', () => {
    const findings = scanFiles({
      // A static C function is private to its file; a method is called on a value whose type is not known.
      'a.c': 'static const EVP_MD *pick(const char *name) { return EVP_get_digestbyname(name); }\n',
      'b.c': 'void f(void) { pick("sha1"); }\n',
      'c.cpp': 'struct H { const EVP_MD *pick(const char *name) { return EVP_get_digestbyname(name); } };\nvoid g(H h) { h.pick("md5"); }\n',
      // An unexported Go function is private to its package (folder).
      'x/x.go': 'package x\n\nimport "github.com/golang-jwt/jwt/v5"\n\nfunc method(name string) { jwt.GetSigningMethod(name) }\n',
      'y/y.go': 'package y\n\nfunc f() { method("RS256") }\n',
    });
    expect(brief(findings)).toEqual(['a.c:1 - unresolved', 'c.cpp:1 - unresolved', 'x/x.go:5 - unresolved']);
  });

  it('does not guess when two functions of the same name choose the algorithm differently', () => {
    const findings = scanFiles({
      'a.c': 'const EVP_MD *pick(const char *name) { return EVP_get_digestbyname(name); }\n',
      'b.c': 'const EVP_CIPHER *pick(int unused, const char *name) { return EVP_get_cipherbyname(name); }\n',
      'main.c': 'void f(void) { pick("sha1"); }\n',
    });
    expect(brief(findings)).toEqual(['a.c:1 - unresolved', 'b.c:1 - unresolved']);
    expect(noteAt(findings, 'a.c:1')).toMatch(/such as main\.c:1/);
    expect(noteAt(findings, 'b.c:1')).toMatch(/such as main\.c:1/);
  });

  it('says so when no call to the function was found, and ignores recursion', () => {
    const findings = scanFiles({
      'a.c': 'const EVP_MD *pick(const char *name) { if (!name) return pick("sha256"); return EVP_get_digestbyname(name); }\n',
    });
    expect(brief(findings)).toEqual(['a.c:1 - unresolved']);
    expect(noteAt(findings, 'a.c:1')).toMatch(/No call to it was found in the scanned code/);
  });
});
