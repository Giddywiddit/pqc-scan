# pqc-scan

```
 /\_/\
( 0.1 )    [ pqc-scan • Post-Quantum Cryptography Scanner ]
 > ^ <     Scans your JavaScript, TypeScript, C, C++, Rust, Go and Python
           ---------------------------------------------------------
           Flags the cryptography a quantum computer could break
```

pqc-scan reads your source code, lists where it uses cryptography, and flags each use a quantum computer could break.

A cryptanalytically relevant quantum computer (CRQC), one able to attack real cryptographic systems, would break RSA and elliptic-curve cryptography, which protect most signatures and encrypted connections today. None exists yet; a 2025 estimate is that one with fewer than a million noisy qubits could break 2048-bit RSA in under a week ([Gidney](https://arxiv.org/abs/2505.15917)). Two reasons to act before then, both set out in [NIST IR 8547](https://csrc.nist.gov/pubs/ir/8547/final):

- **Harvest now, decrypt later:** encrypted data recorded today can be decrypted once a CRQC exists.
- **Mosca's theorem:** if data must stay secret for X years, moving to new cryptography takes Y years, and a CRQC is Z years away, then when X + Y > Z that data will be exposed. The move has to start before that point.

NIST's transition plan begins phasing out quantum-vulnerable public-key algorithms after 2030, with broader disallowance milestones by 2035. The exact date depends on the algorithm and security strength. Replacing them starts with knowing where they are.

## Try it

```sh
npx pqc-scan .
```

Needs Node.js 22 or newer. It reads your code without running, changing or uploading it, and needs no build.

```
RESISTANT   index.ts:3                               SHA-256
VULNERABLE  keys.js:3                                RSA
            A quantum computer could work out the private key from the public key (using Shor's algorithm). Plan to replace this key type.
```

Each finding is one of:

| Label | Meaning |
|---|---|
| Vulnerable | RSA, DSA, elliptic curves or Diffie-Hellman. Plan to replace it. |
| Observed-resistant | The algorithm on this line is believed to withstand quantum computers, such as SHA-256, AES-256 or ML-KEM. This does not prove that the whole program is safe. |
| Review | Known exactly, but acceptable only by judgement, such as AES-128, SHA-1 or MD5. |
| Unresolved | The algorithm is chosen in a way the code does not show. Check that line by hand. |

## Output and CI

| Option | Writes |
|---|---|
| `--json` | The findings as JSON ([report schema](schema/report-v1.schema.json)). |
| `--sarif <file>` | SARIF for GitHub code scanning. |
| `--cbom <file>` | A CycloneDX 1.7 cryptography bill of materials. |
| `--write-baseline <file>`, `--baseline <file>` | Accepts the current findings, so CI fails only on new ones. |

The exit status is 1 when anything is vulnerable, needs review or is unresolved. There is a [GitHub Action](docs/github-action.md).

## Languages

| Language | Libraries |
|---|---|
| [JavaScript / TypeScript](rules/javascript/README.md) | Node.js crypto, WebCrypto, jsonwebtoken, jws |
| [C](rules/c/README.md) | OpenSSL, libsodium, Mbed TLS, PSA Crypto, wolfSSL, GnuTLS, Botan |
| [C++](rules/cpp/README.md) | Crypto++, Botan, and the C libraries |
| [Rust](rules/rust/README.md) | RustCrypto, ring, aws-lc-rs, openssl, rustls, jsonwebtoken |
| [Go](rules/go/README.md) | Standard library, golang.org/x/crypto, CIRCL, golang-jwt |
| [Python](rules/python/README.md) | cryptography, PyJWT, PyCryptodome, ecdsa, hashlib, Paramiko, PyNaCl |
