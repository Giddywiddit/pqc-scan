# pqc-scan

Conservative cryptographic inventory for JavaScript and TypeScript source code.

`pqc-scan` reports evidence, not a readiness score. It never declares an application secure or post-quantum ready. A scan exits non-zero for any finding that is not `observed-resistant`.

## Scope of the first release

- JavaScript and TypeScript source files only.
- Node.js `crypto`, WebCrypto (`crypto.subtle`, `globalThis.crypto`, `webcrypto`, `@peculiar/webcrypto` instances), `jsonwebtoken` and `jws` rules only.
- Import aliases, CommonJS imports, computed property names, immutable constants, and immutable JWT options objects.
- Unsupported calls, dynamic values, mutable values, duplicate bindings, and parse errors become **unresolved**.

It does not yet scan deployed TLS configuration, certificate files, native binaries, dependencies as evidence of use, other languages, or cross-file data flow.

## Known limitations

**Reported as `unresolved`** (the scanner sees the call but cannot determine the algorithm): environment-driven or function-returned values, template literals with substitutions, string concatenation, spread arguments, function parameters, `let` bindings, ternaries, object property reads, WebCrypto/Node calls with no rule, key-material imports (`createPrivateKey`, `createPublicKey`, `createSecretKey`, `generateKey`), and crypto functions or modules that are stored, passed or returned as values (`crypto-reference-escapes`).

**Followed**: aliases (`const k = crypto.generateKeyPairSync`), destructuring from an imported module, `require()` and `import()` with a constant specifier, inline `require('crypto').x()`, and `.call()` / `.apply()` with an array literal.

**Cross-file wrappers** (directory scans only): when a local module has crypto calls whose algorithm comes from a parameter, each file that imports it gets a `crypto-via-local-module` finding. This is one level deep and does not follow the algorithm through the call chain, so the importer's actual choice still needs review.

**Not detected at all** (the call cannot be attributed to a crypto module, so no finding is produced): `require()`/`import()` with a non-constant specifier, a single-file scan of a file that only calls a wrapper, wrapper chains deeper than one import, and `eval`. A clean result is therefore not proof that no cryptography is used. These cases are pinned by `test/unsupported.test.ts`.

WebCrypto AES and HMAC are resolved from `length` and `hash` when they are literal in the parameters; otherwise they are `unresolved`. AES-128 is `needs-review` (reduced quantum security margin). `exportKey` and utilities such as `timingSafeEqual` produce no finding, because the algorithm is reported where the key is created or imported.

## How it is tested

- `test/scanner.test.ts`, `webcrypto.test.ts`, `unsupported.test.ts`: behaviour of the scanner on inline snippets, including every documented limitation.
- `test/fixtures/{resolve,issues}/` with `fixture-corpus.test.ts`: real source files with inline `// expect: <algorithm> <status>` markers. Lines without a marker must produce no finding, so missing and unexpected findings both fail. Every fixed bug gets a file in `issues/`.
- `test/rule-coverage.test.ts`: a call is generated for every function and every algorithm value in every rule file, so no rule or table entry ships untested.
- `test/no-duplicates.test.ts`: one crypto call yields exactly one finding, however it was reached.
- `test/integration.test.ts`: directory traversal, multi-file fixtures, rule-file validation, and the CLI contract (exit codes, JSON, errors) in a subprocess.

## Development checks

```sh
npm install
npm run typecheck
npm test
npm audit --audit-level=moderate
```

## Status vocabulary

- `vulnerable`: a recognized classical public-key use vulnerable to Shor's algorithm.
- `observed-resistant`: a recognized primitive with relevant quantum-resistant properties in the source.
- `needs-review`: the algorithm is known, but it is not simply safe or Shor-vulnerable, so a human policy decision is needed (AES-128's reduced Grover margin, SHA-1 and MD5 which are classically weak, the unsigned JWT `none`).
- `unresolved`: the scanner lacks enough static evidence to identify the algorithm, its key length or its hash. Review is required.

## Scope of the rule data

Rule tables are checked two ways: `rule-coverage.test.ts` proves the scanner agrees with them, and `rules-vs-node.test.ts` proves every cipher, hash and key type name is one Node actually accepts and that JOSE names match the RFC registry. Whether an algorithm is classed `vulnerable`, `observed-resistant` or `needs-review` is a judgment recorded in the rule files, not something a test can prove.
