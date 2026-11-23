# C

Files: `.c` and `.h`. The code is read with the official tree-sitter C grammar (`tree-sitter-c`), run as WebAssembly, so nothing is compiled on your machine and no build configuration is needed.

## Libraries

| Library | Rule file | What is matched |
|---|---|---|
| OpenSSL | `openssl.yaml` | The older functions (`RSA_generate_key_ex`, `SHA256`) and the OpenSSL 3 style where the algorithm is a name or constant (`EVP_PKEY_Q_keygen(..., "ML-KEM-768")`, `EVP_PKEY_CTX_new_id(EVP_PKEY_ED25519, ...)`), plus where TLS is set up and which key-exchange groups are configured. |
| BoringSSL, LibreSSL, AWS-LC, wolfSSL's OpenSSL compatibility layer | `openssl.yaml` | These copy OpenSSL's function names, so they are matched as OpenSSL. |
| libsodium | `libsodium.yaml` | Key exchange (`crypto_box`, `crypto_kx`, `crypto_scalarmult`), Ed25519 signatures, secret-key encryption, hashing, password hashing (Argon2id), message authentication and random numbers, plus the post-quantum ML-KEM-768 and X-Wing key exchange. |
| Mbed TLS 3.6 | `mbedtls.yaml` | `mbedtls_...` hashes, ciphers, RSA, elliptic curves, Diffie-Hellman, key types (`MBEDTLS_PK_*`) and TLS setup. |
| PSA Crypto API (Mbed TLS 3.6 and 4, TF-PSA-Crypto, Trusted Firmware-M) | `psa-crypto.yaml` | `psa_...` calls, with the algorithm read from macros such as `PSA_ALG_SHA_256` or `PSA_ALG_ECDSA(PSA_ALG_SHA_256)`, and key types from `psa_set_key_type`. |
| wolfSSL | `wolfssl.yaml` | `wc_...` functions, including ML-KEM, ML-DSA, SLH-DSA, LMS and XMSS, and `wolfSSL_...` TLS setup, including key shares such as the hybrid group `X25519MLKEM768`. |
| GnuTLS | `gnutls.yaml` | `gnutls_...` hashing, HMAC, ciphers, key generation and signing, with the algorithm read from `GNUTLS_*` constants, including the ML-KEM and ML-DSA key types. |

Every function and constant name in these rule files was checked against the library's header files when the rules were written: OpenSSL and libsodium from their current source, Mbed TLS 3.6, TF-PSA-Crypto, wolfSSL from its November 2026 source, and GnuTLS 3.8.14.

## How the preprocessor is handled

C code is full of `#if`, `#ifdef` and `#define`. The tool does not run the preprocessor, because that needs your build settings and keeps only one side of each `#if`. Instead:

- Both sides of every `#if` are read, because the tool cannot know which one your build uses.
- The code inside `#define` macros is read separately. A crypto call inside a macro is reported on the line where the macro is defined, even if the macro is never used.
- Where the parser cannot make sense of part of a file (common in code full of macros), any known crypto function name found there is still reported, as ⚠️ `unresolved`, instead of being dropped.

## Limits specific to C

- Calls through a function pointer (`table->hash(data)`) and a crypto function passed as an argument without being called are not reported.
- A macro that renames a crypto function (`#define HASH SHA256`, then `HASH(data)`) is not followed.
- Cryptography a project implements itself under its own function names is not recognised. For example, OpenSSH's sntrup761 key exchange is not reported. OpenSSH's ML-KEM-768 calls are reported, because its code uses the same function names as libsodium, so the report names libsodium as the library.
- Not covered yet: the Windows cryptography functions (`BCrypt...`), Apple's (`SecKey...`, `CC_SHA256`) and NSS (`PK11_...`).
- C++ files (`.cpp`, `.cc`) are not read yet. In a C++ project, `.h` files are read as C.

## Tested on

`curl`, `nginx`, `OpenSSH`, and the example programs and tests of Mbed TLS, TF-PSA-Crypto, wolfSSL and GnuTLS. In each, the results were compared with a separate text search for every function name in the rules:

| Code | Calls found by the text search | Reported by the tool |
|---|---|---|
| curl | 56 | 56 |
| nginx | 53 | 53 |
| Mbed TLS example programs | 184 | 184 |
| TF-PSA-Crypto example programs | 57 | 57 |
| wolfSSL examples | 103 | 103 |
| wolfSSL tests | 4,221 | 4,221 |
| GnuTLS examples | 26 | 26 |

In OpenSSH, the text search finds 23 more lines than the tool reports. All 23 are function declarations or definitions, which are not calls. wolfSSL's tests matter most here: the parser cannot fully read 90% of its main test file because of macros, and every call in it is still reported.
