# pqc-scan 

```
 /\_/\
( 0.1 )    [ pqc-scan • Post-Quantum Cryptography Scanner ]
 > ^ <     Finds the cryptography in your JavaScript, TypeScript and C
           ---------------------------------------------------------
           Looks for what quantum computers will break (NIST FIPS 203/204/205)
```

**pqc-scan reads your source code and lists every place it uses cryptography, then tells you which of those uses a future quantum computer could break.**

*Cryptography* is the mathematics that keeps data secret (encryption), proves who sent something (digital signatures) and fingerprints data (hashing). Every call to it names an *algorithm*, such as RSA or SHA-256. This tool finds those calls and tells you which algorithm each one uses.

## In short

- **The problem:** RSA and elliptic-curve cryptography protect most secure connections and signatures today. A powerful enough quantum computer could break both. Nobody has built one yet.
- **Why act now:** an attacker can copy encrypted data today and unlock it years later, once such a computer exists.
- **What this tool does:** it finds every use of cryptography in your code and labels it ❌ breakable by a quantum computer, ✅ believed safe, 🔍 needs a human decision, or ⚠️ could not be determined.
- **What it does not do:** it never says your code is "quantum safe". It reports only what it can read in the code, and says so when it cannot tell.
- **Safe to run:** it only reads files. It does not change your code, run it, or send anything over the internet.

## Why quantum computers matter

Breaking RSA or elliptic-curve cryptography with an ordinary computer would take longer than the age of the universe. In 1994 Peter Shor published a method (Shor's algorithm) that lets a quantum computer break both far faster.

- Today's quantum computers are small. Google's [Willow chip](https://blog.google/technology/research/google-willow-quantum-chip/) (December 2024) has 105 quantum bits (qubits), and they make errors.
- A [2025 paper](https://arxiv.org/abs/2505.15917) by Craig Gidney of Google estimated that breaking a 2048-bit RSA key would take fewer than one million error-prone qubits running for under a week.
- The US standards body NIST plans for RSA and elliptic-curve public-key methods to be deprecated after 2030 and disallowed after 2035 ([IR 8547](https://csrc.nist.gov/pubs/ir/8547/final); the dates depend on key size).

NIST has published replacements believed to resist quantum computers: ML-KEM (for agreeing on secret keys), and ML-DSA and SLH-DSA (for signatures). Switching takes years, and the first step is finding where the old methods are used. That list is what this tool produces.

## Try it

You need [Node.js](https://nodejs.org) 22 or newer. `npm install` downloads about 90 MB, mostly TypeScript (23 MB), the C parser (13 MB) and the test tools.

```sh
git clone https://github.com/Giddywiddit/pqc-scan.git
cd pqc-scan
npm install
npm run scan -- path/to/your/project
```

Example result:

```
Cryptography found:
------------------------------------------------------------------------
✅ index.ts:3                           SHA-256            observed-resistant
❌ keys.js:3                            RSA                vulnerable
     ℹ️  A quantum computer could work out the private key from the public key (using Shor's algorithm). Plan to replace this key type.
------------------------------------------------------------------------
2 finding(s): 1 vulnerable, 0 needs-review, 0 unresolved, 1 observed-resistant.
```

| Option | What it does |
|---|---|
| `--json` | Prints the results as JSON for other programs. The format is described by [`schema/report-v1.schema.json`](schema/report-v1.schema.json); its `schemaVersion` changes only when a change could break a program that reads it. |
| `--quiet` | Hides the cat banner. |

The tool exits with status 0 only when every finding is ✅ or nothing was found, and 1 otherwise, so it can fail an automated check.

## What the labels mean

| Label | Meaning | What you should do |
|---|---|---|
| ❌ `vulnerable` | RSA, elliptic curves or Diffie-Hellman. A quantum computer is expected to break these. | Plan to replace it with a NIST post-quantum method. |
| ✅ `observed-resistant` | A method believed to withstand quantum computers, such as SHA-256, 256-bit AES or ML-KEM. | Nothing. This describes that one line, not your whole program. |
| 🔍 `needs-review` | Known exactly, but acceptable only by judgement: 128-bit AES (a quantum computer halves its strength to about 64 bits), or MD5 and SHA-1 (weak even against ordinary computers). | A person decides. |
| ⚠️ `unresolved` | The code picks the method in a way the tool cannot read, such as a setting read at run time or a value passed into a function. | Look at that line by hand. |

## Languages

| Language | Libraries | Details |
|---|---|---|
| JavaScript / TypeScript | Node.js crypto, WebCrypto, jsonwebtoken, jws | [rules/javascript](rules/javascript/README.md) |
| C | OpenSSL, libsodium, Mbed TLS, PSA Crypto, wolfSSL, GnuTLS | [rules/c](rules/c/README.md) |

C++, Go, Rust, Python and Java are planned. Each language page lists exactly what is matched, its limits, and the real projects it was tested on.

## What it cannot see

The tool reads code without running it, so it has blind spots. Read these before trusting a result.

- **A clean result does not mean "no cryptography".** Cryptography reached in a way the tool cannot follow is missed. Each language page lists those ways.
- **Only the languages and libraries listed above are covered.** Cryptography inside a package you installed is scanned only if you scan that package's code.
- **Cryptography a project writes itself**, under its own function names, is not recognised.
- **It does not inspect** server settings, certificate files or compiled programs. It flags where TLS (the encryption behind HTTPS) is set up, so you can check the settings yourself.

Every documented limit is pinned by an automated test, so it cannot change without anyone noticing.

## How we know it is reliable

- **Over 3,000 automated tests** run on every change, including a generated test for every function and algorithm the tool recognises.
- **Names are checked against the real thing:** Node.js itself, the internet standards, and each C library's header files.
- **Real projects:** it was run on well-known open-source projects in each language, and its results were compared with a separate text search of the same code. The language pages give the numbers.
- **Every fixed bug becomes a permanent test.**

Which algorithms count as risky is a judgement call. The decisions are written openly in the [`rules/`](rules/) folder so you can read them and disagree with them.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how the code is organised, how to add a library or a language, and how the tests work.

## Licence

Released under the [Apache License 2.0](LICENSE).
