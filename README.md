# pqc-scan 

```
 /\_/\
( 0.1 )    [ pqc-scan • Post-Quantum Cryptography Scanner ]
 > ^ <     Scans your JavaScript, TypeScript, C, C++, Rust, Go and Python
           ---------------------------------------------------------
           Flags the cryptography a quantum computer could break
```

**pqc-scan reads your source code, lists the places it uses cryptography, and tells you which of those uses a future quantum computer could break.**

*Cryptography* is the mathematics that keeps data secret (encryption), proves who sent something (digital signatures) and fingerprints data (hashing). Each use relies on a specific method, called an *algorithm*, such as RSA or SHA-256. This tool finds the calls to cryptography libraries and reports which algorithm each one uses, or says that it cannot tell.

## In short

- **The problem:** RSA and elliptic-curve cryptography are the most widely used methods for digital signatures and for setting up encrypted connections. A large enough quantum computer could break both. None exists yet.
- **Why act now:** an attacker can record encrypted data today and decrypt it once such a computer exists. NIST calls this "harvest now, decrypt later".
- **What this tool does:** it finds the uses of cryptography it can recognise in your code (see [Languages](#languages)) and labels each one vulnerable (a quantum computer could break it), resistant (believed safe), needs review (a human decision), or unresolved (could not be determined).
- **What it does not do:** it never says your code is "quantum safe". It reports only what it can read in the code, and says so when it cannot tell.
- **Safe to run:** it does not change your code, run it, or send anything over the internet. The only file it writes is the cache, and only if you ask for one with `--cache`.

## Why quantum computers matter

Against ordinary computers, a 2048-bit RSA key is rated by NIST at 112 bits of security: the best known attack needs on the order of 2^112 operations, which is out of reach. In 1994 Peter Shor published a method (Shor's algorithm) that would let a large enough quantum computer break RSA and elliptic-curve cryptography.

- Today's quantum computers are small. Google's [Willow chip](https://blog.google/technology/research/google-willow-quantum-chip/) (December 2024) has 105 qubits (quantum bits), and they still make errors.
- A [2025 paper](https://arxiv.org/abs/2505.15917) by Craig Gidney of Google estimated that a 2048-bit RSA key could be broken in under a week by fewer than one million qubits, assuming each operation fails about 1 time in 1,000.
- The US standards body NIST will deprecate RSA, elliptic-curve and Diffie-Hellman methods after 2030 and disallow them after 2035, at every key size ([NIST IR 8547](https://csrc.nist.gov/pubs/ir/8547/final), October 2026).

NIST has published replacements believed to resist quantum computers: ML-KEM (FIPS 203, for agreeing on secret keys), and ML-DSA (FIPS 204) and SLH-DSA (FIPS 205) for signatures. NIST notes that past moves to new algorithms took 10 to 20 years, and recommends beginning with an inventory of the cryptography in use. pqc-scan builds the part of that inventory found in your source code.

## Try it

You need [Node.js](https://nodejs.org) 22 or newer. `npm install` downloads the language parsers, TypeScript, and the tools that run the tests.

```sh
git clone https://github.com/Giddywiddit/pqc-scan.git
cd pqc-scan
npm install
npm run scan -- path/to/your/project
```

Example result:

```
Cryptography found:
----------------------------------------------------------------------------
RESISTANT   index.ts:3                               SHA-256
VULNERABLE  keys.js:3                                RSA
            A quantum computer could work out the private key from the public key (using Shor's algorithm). Plan to replace this key type.
----------------------------------------------------------------------------
2 finding(s): 1 vulnerable, 0 needs review, 0 unresolved, 1 resistant.

Quantum risk found: the VULNERABLE items use cryptography a quantum computer could break. Plan their migration.
```

| Option | What it does |
|---|---|
| `--json` | Prints the results as JSON for other programs. The format is described by [`schema/report-v1.schema.json`](schema/report-v1.schema.json); its `schemaVersion` changes only when a change could break a program that reads it. |
| `--quiet` | Hides the cat banner. |
| `--sarif <file>` | Also writes the vulnerable, needs-review and unresolved findings to `<file>` in SARIF 2.1.0, the format GitHub code scanning reads, so they appear as alerts on pull requests. Resistant findings are left out, since they need no action. |
| `--cbom <file>` | Also writes the full inventory to `<file>` as a cryptography bill of materials (CBOM) in CycloneDX 1.7, the format standardised as ECMA-424: one entry per algorithm, with every file and line where it is used, its CycloneDX family and type, and its NIST quantum security category where a NIST standard states one (0 for methods a quantum computer could break). |
| `--write-baseline <file>` | Also writes every finding to `<file>`, to accept the current findings for now. |
| `--baseline <file>` | Leaves out the findings listed in `<file>`, so the exit status is 1 only for new ones. A finding is recognised by its rule, file and the text of its line, so it still matches after code above it moves. |
| `--cache <file>` | Saves each file's results in `<file>` and reuses them on the next run while the file is unchanged. The saved results are discarded whenever the scanner or its rules change. Anyone who can change the cache file can change the results, so keep it outside the folder you scan (the tool refuses a cache inside it), or set the environment variable `PQC_SCAN_CACHE_KEY` to a secret: the cache is then signed, and a cache that was changed or signed with another key is not used. |
| `--max-file-size <MB>` | Files larger than this (default 20 MB) are not read, and are reported as unresolved (not scanned). |

Exit status: 0 when every finding is resistant or nothing was found, 1 when any finding is vulnerable, needs review or is unresolved, and 2 when the scan could not run (for example, the path does not exist).

## What the labels mean

| Label | Meaning | What you should do |
|---|---|---|
| `vulnerable` | RSA, DSA, elliptic-curve methods (such as ECDSA, Ed25519, ECDH and X25519) or Diffie-Hellman. Shor's algorithm breaks these. | Plan to replace it with a NIST post-quantum method. |
| `observed-resistant` | A method believed to withstand quantum computers, such as SHA-256, 256-bit AES or ML-KEM. | Nothing. This describes that one line, not your whole program. |
| `needs-review` | Known exactly, but acceptable only by judgement. Examples: 128-bit AES, which NIST still accepts but some organisations replace with 256-bit AES for a larger safety margin against quantum attacks; SHA-224, whose 112-bit collision strength is a security level NIST plans to disallow in 2030; and MD5 and SHA-1, which are broken even by ordinary computers. | A person decides. |
| `unresolved` | The code picks the method in a way the tool cannot read, such as a setting read at run time or a value passed into a function. | Look at that line by hand. |

## Languages

| Language | Libraries | Details |
|---|---|---|
| JavaScript / TypeScript | Node.js crypto, WebCrypto, jsonwebtoken, jws | [rules/javascript](rules/javascript/README.md) |
| C | OpenSSL, libsodium, Mbed TLS, PSA Crypto, wolfSSL, GnuTLS, Botan | [rules/c](rules/c/README.md) |
| C++ | Crypto++, Botan, and every C library above | [rules/cpp](rules/cpp/README.md) |
| Rust | RustCrypto, ring, aws-lc-rs, the openssl crate, rustls, jsonwebtoken | [rules/rust](rules/rust/README.md) |
| Go | The standard library (including TLS), golang.org/x/crypto (including SSH), CIRCL, golang-jwt, and every C library above through cgo | [rules/go](rules/go/README.md) |
| Python | `cryptography`, PyJWT | [rules/python](rules/python/README.md) |

Java is planned. Each language page lists what is matched, its limits, and the real projects it was tested on.

## What it cannot see

The tool reads code without running it, so it has blind spots. Read these before trusting a result.

- **A clean result does not mean "no cryptography".** Cryptography reached in a way the tool cannot follow is missed. Each language page lists those ways.
- **Only the languages and libraries listed above are covered.** Cryptography inside a package you installed is scanned only if you scan that package's code.
- **Cryptography a project writes itself**, under its own function names, is not recognised.
- **It does not inspect** server settings, certificate files or compiled programs. In C, C++, Rust (the openssl crate and rustls) and Go (crypto/tls and x/crypto/ssh), it flags where TLS (the encryption behind HTTPS) or SSH is set up, so you can check the settings yourself.

The limits listed on each language page are pinned by automated tests, so they cannot change without anyone noticing.

## How we know it is reliable

- **Over 3,000 automated tests** run on every change, including a generated test for every function and algorithm the tool recognises.
- **Names are checked against the real thing:** the JavaScript names against Node.js itself and the JWT standards (RFC 7518 and RFC 8037) in automated tests, the C and C++ names against each library's header files, the Rust names against each crate's source code, and the Go names against Go's list of every exported name and each library's source code, when the rules were written.
- **Real projects:** it was run on well-known open-source projects in each language, and its results were compared with a separate text search of the same code. The language pages list the projects and the numbers.
- **Every fixed bug becomes a permanent test.**

Which algorithms count as risky is a judgement call. The decisions are written openly in the [`rules/`](rules/) folder so you can read them and disagree with them.

## Contributing

See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for how the code is organised, how to add a library or a language, and how the tests work.

## Licence

Released under the [Apache License 2.0](LICENSE).
