# pqc-scan

Conservative cryptographic inventory for JavaScript and TypeScript source code.

`pqc-scan` reports evidence, not a readiness score. It never declares an application secure or post-quantum ready. A scan exits non-zero for vulnerable or unresolved findings.

## Scope of the first release

- JavaScript and TypeScript source files only.
- Node.js `crypto`, WebCrypto (`crypto.subtle`, `globalThis.crypto`, `webcrypto`) and `jsonwebtoken` rules only.
- Import aliases, CommonJS imports, computed property names, immutable constants, and immutable JWT options objects.
- Unsupported calls, dynamic values, mutable values, duplicate bindings, and parse errors become **unresolved**.

It does not yet scan deployed TLS configuration, certificate files, native binaries, dependencies as evidence of use, other languages, or cross-file data flow.

## Known limitations

**Reported as `unresolved`** (the scanner sees the call but cannot determine the algorithm): environment-driven or function-returned values, template literals with substitutions, string concatenation, spread arguments, function parameters, `let` bindings, ternaries, object property reads, WebCrypto/Node calls with no rule, key-material imports (`createPrivateKey`, `createPublicKey`, `createSecretKey`, `generateKey`), and crypto functions or modules that are stored, passed or returned as values (`crypto-reference-escapes`).

**Followed**: aliases (`const k = crypto.generateKeyPairSync`), destructuring from an imported module, `require()` and `import()` with a constant specifier, inline `require('crypto').x()`, and `.call()` / `.apply()` with an array literal.

**Not detected at all** (the call cannot be attributed to a crypto module, so no finding is produced): `require()`/`import()` with a non-constant specifier, crypto wrapped in another file's helper, and `eval`. A clean result is therefore not proof that no cryptography is used. These cases are pinned by `test/unsupported.test.ts`.

WebCrypto AES and HMAC are resolved from `length` and `hash` when they are literal in the parameters; otherwise they are `unresolved`. AES-128 is `unresolved` by policy (reduced quantum security margin). `exportKey` and utilities such as `timingSafeEqual` produce no finding, because the algorithm is reported where the key is created or imported.

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
- `unresolved`: the scanner lacks enough static evidence to make either determination. Review is required.
