# JavaScript and TypeScript

Files: `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, `.cts`. The code is read with the TypeScript compiler's parser.

## Libraries

| Library | Rule file | What is matched |
|---|---|---|
| Node.js's built-in `crypto` module (also `node:crypto`) | `node-crypto.yaml` | Key generation, signing, encryption, hashing, HMAC, ciphers, key exchange and random numbers, with the algorithm read from the arguments (`createHash('sha256')`, `generateKeyPairSync('rsa')`). |
| WebCrypto (`crypto.subtle`), built into browsers and Node.js | `node-crypto.yaml` | Every `crypto.subtle` method, with the algorithm read from the `{ name: ... }` argument. |
| `@peculiar/webcrypto`, a WebCrypto implementation for Node.js | `webcrypto-polyfills.yaml` | `new Crypto()` is treated like the built-in WebCrypto. |
| `jsonwebtoken`, login tokens (JWT) | `jsonwebtoken.yaml` | `sign` and `verify`, with the algorithm read from the options (`{ algorithm: 'RS256' }` for `sign`, `{ algorithms: [...] }` for `verify`). |
| `jws`, signed tokens | `jws.yaml` | `sign`, `createSign`, `verify` and `createVerify`, with the algorithm read from the header or options (`{ header: { alg: 'RS256' } }`). |

Every cipher, hash and key type name is checked against Node.js itself, and the token algorithm names against the JWT standards RFC 7518 and RFC 8037, in `test/rules-vs-node.test.ts`.

## Ways of writing the code that are followed

- Renamed imports: `import { createHash as h } from 'crypto'`.
- `require('crypto')`, `await import('node:crypto')`, and a `require` whose name is a constant.
- The algorithm stored in a constant: `const name = 'sha256'; createHash(name)`.
- A function or object copied into another variable before it is called, `.call()` and `.apply()`.
- Helper files: if a file passes an algorithm it received as an argument, every local file that imports it gets an ⚠️ note saying the caller chooses the algorithm.

## Limits specific to JavaScript

- A library loaded by a name built while the program runs (`require(someVariable)`) and code run from text (`eval`) are not followed.
- The algorithm is reported as ⚠️ when it comes from a `let` variable, a function result, a setting, a template string with a substitution, or an object property.
- Across files, the tool says that a helper's callers choose the algorithm, but does not trace which value each caller passes. Only files that import the helper directly get the ⚠️ note; a file that imports them does not.

These limits are pinned by `test/unsupported.test.ts`.

## Tested on

`jose`, `ssh2`, `node-jsonwebtoken`, `express`, `web-push`, `send` and `webcrypto`. The results were compared with a separate text search of the same code. That comparison found and fixed real mistakes, for example a variable named `crypto` in one function hiding crypto calls in another function of the same file.
