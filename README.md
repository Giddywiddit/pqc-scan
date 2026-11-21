# pqc-scan

Conservative cryptographic inventory for JavaScript and TypeScript source code.

`pqc-scan` reports evidence, not a readiness score. It never declares an application secure or post-quantum ready. A scan exits non-zero for vulnerable or unresolved findings.

## Scope of the first release

- JavaScript and TypeScript source files only.
- Node.js `crypto` and `jsonwebtoken` rules only.
- Import aliases, CommonJS imports, computed property names, immutable constants, and immutable JWT options objects.
- Unsupported calls, dynamic values, mutable values, duplicate bindings, and parse errors become **unresolved**.

It does not yet scan deployed TLS configuration, certificate files, native binaries, dependencies as evidence of use, other languages, or cross-file data flow.

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
