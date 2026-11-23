# pqc-scan 

```
 /\_/\
( 0.1 )    [ pqc-scan • Post-Quantum Cryptography Scanner ]
 > ^ <     Finds the cryptography in your JavaScript, TypeScript and C
           ---------------------------------------------------------
           Looks for what quantum computers will break (NIST FIPS 203/204/205)
```

**pqc-scan reads your JavaScript, TypeScript or C code and lists every place it uses cryptography, then tells you which of those uses a future quantum computer could break.**

*Cryptography* is the mathematics that keeps data secret (encryption), proves who sent something (digital signatures) and fingerprints data (hashing). Every time your code calls one of these, it names a specific method, called an *algorithm*, such as RSA or SHA-256. This tool finds those calls and tells you which algorithm each one uses.

## In short

- **The problem:** two widely used methods, RSA and elliptic-curve cryptography, protect most secure connections and signatures today. A powerful enough quantum computer could break both. Nobody has built one yet.
- **Why act now:** an attacker can copy encrypted data today and unlock it years later, once such a computer exists.
- **What this tool does:** it finds every use of cryptography in your code and labels it ❌ breakable by a quantum computer, ✅ believed safe, 🔍 needs a human decision, or ⚠️ could not be determined.
- **What it does not do:** it never says your code is "quantum safe". It reports only what it can read in the code, and says so when it cannot tell.
- **Safe to run:** it only reads files. It does not change your code, run it, or send anything over the internet.

## Why quantum computers matter

RSA and elliptic-curve cryptography are safe today because breaking them with an ordinary computer would take longer than the age of the universe. In 1994 a mathematician named Peter Shor published a method (Shor's algorithm) that a quantum computer could use to break both in under a week instead (see below).

How close is that?

- Today's quantum computers are small. Google's [Willow chip](https://blog.google/technology/research/google-willow-quantum-chip/), announced in December 2024, has 105 quantum bits (qubits), and its qubits make errors.
- A [2025 research paper](https://arxiv.org/abs/2505.15917) by Craig Gidney of Google estimated that breaking a 2048-bit RSA key (a size still in common use) would take fewer than one million error-prone qubits running for under a week, assuming each operation fails about 1 time in 1,000.
- Nobody knows when a machine that big will exist. The US standards body NIST has published its [final transition plan (IR 8547, October 2026)](https://csrc.nist.gov/pubs/ir/8547/final): RSA and elliptic-curve public-key methods are to be deprecated after 2030 and disallowed after 2035. The exact dates depend on the key size, so check the report for your case.

NIST has already published replacements that are believed to resist quantum computers: ML-KEM (for agreeing on secret keys), and ML-DSA and SLH-DSA (for digital signatures). Switching takes years, so the first step is to find where you use the old methods. That list is what this tool produces.

## Try it

You need [Node.js](https://nodejs.org) version 22 or newer (Node.js runs JavaScript outside a browser). `npm install` downloads about 90 MB: 23 MB is TypeScript (used to read JavaScript and TypeScript files), 13 MB is the C parser, and most of the rest is the tools that run the tests.

```sh
git clone https://github.com/Giddywiddit/pqc-scan.git
cd pqc-scan
npm install
npm run scan -- path/to/your/project
```

Replace `path/to/your/project` with a folder or a single file. Example result:

```
Cryptography found:
------------------------------------------------------------------------
✅ index.ts:3                           SHA-256            observed-resistant
❌ keys.js:3                            RSA                vulnerable
     ℹ️  A quantum computer could work out the private key from the public key (using Shor's algorithm). Plan to replace this key type.
------------------------------------------------------------------------
2 finding(s): 1 vulnerable, 0 needs-review, 0 unresolved, 1 observed-resistant.

🚨 Quantum risk found: the ❌ items use cryptography a quantum computer could break. Plan their migration.
```

Each line reads: label, `file:line number`, the algorithm found, and the status word.

Options:

| Option | What it does |
|---|---|
| `--json` | Prints the results as structured data that other programs can read (see "Using the results in other programs" below). The cat is left out so the output stays clean. |
| `--quiet` | Hides the cat banner |

## Using the results in other programs

`--json` prints one JSON document (JSON is a text format that almost every programming language can read):

```json
{
  "schemaVersion": 1,
  "tool": { "name": "pqc-scan", "version": "0.1.0" },
  "summary": { "total": 2, "vulnerable": 1, "observed-resistant": 1, "needs-review": 0, "unresolved": 0 },
  "findings": [
    { "ruleId": "node-keygen", "file": "keys.js", "line": 3, "algorithm": "RSA", "category": "keygen", "status": "vulnerable", "note": "…", "trace": [] }
  ]
}
```

The format is described by a JSON Schema file, [`schema/report-v1.schema.json`](schema/report-v1.schema.json), and `schemaVersion` changes only when a change could break a program that reads it. The tests check that the real output always matches the schema.

## What the labels mean

| Label | Meaning | What you should do |
|---|---|---|
| ❌ `vulnerable` | Uses RSA, elliptic curves or the older Diffie-Hellman key exchange. A quantum computer is expected to break these. | Plan to replace it with a NIST post-quantum method. |
| ✅ `observed-resistant` | Uses a method believed to withstand quantum computers, for example the SHA-256 fingerprint method, 256-bit AES encryption, or ML-KEM. | Nothing. This describes that one line of code, not your whole program. |
| 🔍 `needs-review` | We know exactly what it is, but whether it is acceptable is a judgement. Examples: 128-bit AES (a quantum computer halves its strength to about 64 bits, which some organisations consider too low), and the old fingerprint methods MD5 and SHA-1 (weak even against ordinary computers). | A person decides. |
| ⚠️ `unresolved` | The code picks the method in a way the tool cannot read, for example from a setting read while the program runs, or from a value passed into a function. | Look at that line by hand. |

The tool exits with status 0 (the "success" signal that automated checks look for) only when every finding is ✅ or nothing was found. Any other result exits with status 1, so you can use it to fail an automated check.

## What it understands

- **Languages:** JavaScript and TypeScript files (`.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, `.cts`), and C files (`.c`, `.h`).
- **Cryptography libraries for JavaScript and TypeScript:**
  - Node.js's built-in `crypto` module.
  - WebCrypto (`crypto.subtle`), the cryptography toolkit built into web browsers and also available in Node.js.
  - The `jsonwebtoken` and `jws` packages, which create and check login tokens.
- **Cryptography libraries for C:**
  - OpenSSL, the most widely used cryptography library, both the older style (`RSA_generate_key_ex`, `SHA256`) and the OpenSSL 3 style where the algorithm is a name (`EVP_PKEY_Q_keygen(..., "ML-KEM-768")`). Libraries that copy OpenSSL's function names (BoringSSL, LibreSSL, AWS-LC, and wolfSSL's OpenSSL compatibility layer) are matched as OpenSSL.
  - libsodium, including its post-quantum ML-KEM-768 and X-Wing functions.
  - Mbed TLS 3.6 (`mbedtls_...`) and the PSA Crypto API (`psa_...`), which Mbed TLS 3.6 and 4 and Trusted Firmware-M provide. Both are common on small embedded devices.
  - wolfSSL (`wc_...` and `wolfSSL_...`), including its ML-KEM, ML-DSA and SLH-DSA functions and the hybrid TLS group `X25519MLKEM768`.
  - GnuTLS (`gnutls_...`), including its ML-KEM and ML-DSA key types.
  - Every function and constant name in the C rules was checked against the real header files of each library.
- **Ways of writing the code:** renamed imports (`import { createHash as h } from 'crypto'`), the algorithm stored in a constant (`const name = 'sha256'`), `require('crypto')`, and a function copied into another variable before it is called.

## What it cannot see

The tool reads code without running it. That means it has blind spots. Read this list before trusting a result.

- **A clean result does not mean "no cryptography".** The tool misses cryptography that is reached in a way it cannot follow: loading a library whose name is built while the program runs (`require(someVariable)`), running text as code (`eval`), or hiding the call behind more than one level of helper files.
- **Other languages are not covered.** C++, Go, Rust, Python, Java and C# are not scanned yet. More languages are planned.
- **Other cryptography libraries are not covered.** Only the libraries listed above. In C that leaves out, for example, the Windows cryptography functions (`BCrypt...`), Apple's (`SecKey...`, `CC_SHA256`) and NSS. Cryptography built into a package you installed is not scanned unless you scan that package's own code.
- **Code split across files is only partly followed.** If a helper file takes the algorithm as an argument, each file that imports the helper gets an ⚠️ note saying so. The tool does not trace which value each caller passes.
- **In C, a crypto call inside a `#define` macro is reported on the line where the macro is defined**, even if the macro is never used. The tool also reads both sides of every `#if`, because it cannot know which one your build uses.
- **In C, calls through a function pointer** (`table->hash(data)`) and cryptography a project implements itself under its own function names are not recognised.
- **It does not inspect** the encryption settings of a web server (TLS), certificate files, or programs that are already compiled. For C, it flags where TLS is set up so you can check the settings yourself.

Every limitation above is pinned by an automated test (`test/unsupported.test.ts`), so it cannot change without anyone noticing.

## How we know it is reliable

- **Over 3,000 automated tests** run on every change. They cover every algorithm the tool recognises, code written in unusual styles, and the command-line behaviour.
- **Names are checked against the real thing.** Every cipher, hash and key type the tool recognises is checked to exist in Node.js itself, and the login-token algorithm names are checked against the official internet standard (RFC 7518).
- **Real projects.** During development the tool was run against well-known open-source projects: seven in JavaScript (`jose`, `ssh2`, `node-jsonwebtoken`, `express`, `web-push`, `send` and `webcrypto`) and, in C, `curl`, `nginx`, `OpenSSH` and the example programs and tests of Mbed TLS, wolfSSL and GnuTLS. In the C code it found every call to a library function it knows: about 4,800 calls in total, including 4,221 in wolfSSL's tests, where the code is so full of macros that the parser cannot fully read 90% of the main test file. Its results were compared with a separate text search of the same code. That comparison found and fixed real mistakes, for example a variable named `crypto` in one function hiding crypto calls in a different function of the same file.
- **Every fixed bug becomes a permanent test** (see `test/fixtures/issues/`).

Which algorithms count as risky is a judgement call. The tool's decisions are written openly in the `rules/` folder so you can read them and disagree with them.

## For developers

```sh
npm test            # run all tests
npm run typecheck   # check the TypeScript code for type errors
```

How the tests are organised:

- `test/fixtures/resolve`, `test/fixtures/issues` and `test/fixtures/c`: short real source files (one per C library). A comment such as `// expect: RSA vulnerable` states what the tool must report on that line. A line without such a comment must produce no finding, so both missing and unexpected findings fail the test.
- `test/rule-coverage.test.ts`: generates a call for every recognised function and algorithm, so no rule can be added without a test.
- `test/no-duplicates.test.ts`: one call in the code must never be reported twice.
- `test/language-adapter.test.ts`: proves the shared core works with a made-up second language that has no JavaScript code in it.
- `test/report-schema.test.ts`: the `--json` output must match the published schema, and the schema must match the code.
- `test/integration.test.ts`: scans whole folders and runs the command-line tool, checking exit codes, `--json` output and error messages.

To teach the tool a new library, add a rule file in `rules/<language>/` (for example `rules/c/`). Rule files are plain text in the YAML format and need no programming. The coverage tests then check the new rules automatically.

### Adding a language

The code is split into a shared core (`src/core/`: walking folders, matching rules, cross-file checks) and one adapter per language (`src/languages/<name>/`). An adapter does one job: read one file and list its cryptography findings. Rules for that language go in `rules/<name>/`. Register the adapter in `src/languages/index.ts` and the core, the output formats and the tests of the shared behaviour work with it unchanged. Then, step by step: tell `test/rule-coverage.test.ts` how a call is written in the new language (one line), so every rule gets a generated test; add marked example files in `test/fixtures/<name>/`, which the fixture test finds on its own; and add a command-line test like the C one in `test/integration.test.ts`. A test fails if a `rules/<name>/` folder has no adapter, or an adapter has no rules.

## Licence

Released under the [Apache License 2.0](LICENSE).
