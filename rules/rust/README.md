# Rust

Files: `.rs`. A `target` folder next to a `Cargo.toml` is skipped, because it holds Cargo's build output, not your source. The code is read with the official tree-sitter Rust grammar (`tree-sitter-rust`), run as WebAssembly, so nothing is compiled on your machine and Cargo is not needed.

## Libraries

| Library | Rule file | What is matched |
|---|---|---|
| RustCrypto crates, and the dalek crates for Ed25519 and X25519 | `rustcrypto.yaml` | Hashes (`sha2`, `sha3`, `sha1`, `md5`, `md4`, `blake2`, `ripemd`), ciphers (`aes`, `aes-gcm`, `aes-gcm-siv`, `chacha20poly1305`, `chacha20`, `des`, `rc4`), RSA, DSA, ECDSA and the curves `p256`, `p384`, `p521`, `k256` and `sm2`, `ed25519-dalek`, `x25519-dalek`, Ed448 and X448, the post-quantum `ml-kem`, `ml-dsa`, `slh-dsa` and `x-wing`, and the password hashes `argon2` and `scrypt`. |
| ring and aws-lc-rs | `ring.yaml` | The algorithm constants passed to their functions (`&digest::SHA256`, `&agreement::X25519`, `&signature::ECDSA_P256_SHA256_ASN1_SIGNING`), the key-pair types and `SystemRandom`. aws-lc-rs copies ring's interface, so each name is written once for ring; what only aws-lc-rs has is listed under its own name: ML-KEM (`kem::ML_KEM_768`), ML-DSA (`signature::ML_DSA_65`), SHA-3, P-521 and secp256k1. |
| openssl crate (rust-openssl) | `openssl.yaml` | Digests (`MessageDigest::sha256()`, `Md::sha256()`, `openssl::sha::sha256`), a digest chosen by name (`MessageDigest::from_name("sha256")`), ciphers (`Cipher::aes_256_gcm()`), key types (`Rsa`, `EcKey`, `Dsa`, `Dh`, `PKey::generate_ed25519()`, `pkey::Id::X25519`, ...), `rand_bytes` and where TLS is set up (`SslConnector`, `SslAcceptor`, `SslContext`). |
| rustls (TLS) | `rustls.yaml` | Which key exchange TLS offers: the crypto provider (`rustls::crypto::aws_lc_rs::default_provider()` in rustls 0.23, `rustls_aws_lc_rs::DEFAULT_PROVIDER` in 0.24, and the same for ring), each key-exchange group named in code (`kx_group::X25519MLKEM768`, `kx_group::X25519`), and where a configuration is built (`ClientConfig::builder()`, `ServerConfig::builder()`). The aws-lc-rs provider offers the hybrid post-quantum group X25519MLKEM768 first by default and is reported ✅; the ring provider offers only classical groups and is reported ❌. |
| jsonwebtoken crate (JWT) | `jsonwebtoken.yaml` | The signing algorithm, a variant of its `Algorithm` enum (`Header::new(Algorithm::RS256)`, `Validation::new(Algorithm::ES256)`), wherever it is named. |
| getrandom, rand, rand_core | `random.yaml` | Random numbers read straight from the operating system: `getrandom`, `OsRng` and `SysRng`. |

Every name was checked against the crates' source code when the rules were written: RustCrypto, the dalek crates, ring, aws-lc-rs 1.19.0, the openssl crate 0.10.82, jsonwebtoken 12.0.0, rustls 0.23.46 and 0.24.0-dev.3 (with rustls-aws-lc-rs and rustls-ring), rand 0.10.4 and getrandom 0.4.3, all from November 2026. Names were also checked against older releases that projects still use: sha2 0.10.8, sha3 0.10.8, blake2 0.10.6, aes-gcm 0.10.3, rsa 0.9.8, ml-kem 0.2.1, ed25519-dalek 2.1.1, x25519-dalek 2.0.1, rand 0.8.5 and 0.9.2, rand_core 0.6.4 and 0.9.3, and getrandom 0.2.15. The names `MessageDigest::from_name` accepts were checked against OpenSSL's own list.

Choices worth knowing:

- **A crate with one algorithm is matched by its name.** Any path from `rsa`, `dsa`, `ecdsa`, `md5`, `sha1`, `ed25519_dalek` or `x25519_dalek` (and the others listed by crate name in `rustcrypto.yaml`) counts, including what the crate re-exports, such as `rsa::BoxedUint`. In `p256`, `p384`, `p521` and `k256`, the `ecdsa` and `ecdh` modules are reported as ECDSA and ECDH, and anything else in the crate as the curve (`EC-P-256`).
- **HMAC, HKDF and PBKDF2 from RustCrypto** take the hash as a type argument (`Hmac<Sha256>`), and only the hash is reported. ring's and aws-lc-rs's constants name both (`hmac::HMAC_SHA256` is reported as HMAC-SHA-256).
- **rand's `ThreadRng`** (`rand::rng()`, `rand::thread_rng()`) is seeded from the operating system too, but it is used for much else besides keys (shuffling, sampling, tests), so it is not reported.

## How Rust is read

- **Paths and `use` lines.** A name counts when it is written as a path from its crate (`sha2::Sha256::new()`), or through a `use` line, including renames (`use ring::signature as sig;` then `sig::ED25519`) and `use x::*`. A `use` line applies to its own module or block, as in Rust, so a test module's `use crate::hmac;` does not change what `hmac::` means elsewhere in the file. Paths that start with `crate`, `self`, `super` or `Self` are the project's own.
- **Names written alone.** `Sha256` counts when a `use` line brings it in. A lower-case name alone counts only when it is called (`compute(data)` after `use md5::compute;`): by Rust's naming rules it is otherwise a variable or a module, as in `if pss {` in a file that has `use rsa::pss;`. A name is not reported where the project defines its own item with it (`fn sha256()`, `struct Sha256Wrapper`).
- **Generic arguments.** Each is matched on its own, so `Hmac::<Sha256>::new_from_slice(key)` reports SHA-256.
- **One use per line.** A name used twice on one line (`let k: SigningKey = SigningKey::random(rng)`) is reported once.
- **Macros.** Rust does not parse a macro's arguments until the macro is expanded, so the arguments (`assert_eq!(Sha256::digest(data), ...)`) and the code inside a `macro_rules!` definition are searched as text for the same paths, with strings and comments left out. A finding inside a `macro_rules!` is reported on the line where it is written. A digest name inside a macro is read only when it is written directly as a string (`from_name("sha256")`).
- **Code the parser cannot read** that names a rule crate (`ring::digest::SHA256`) is reported as ⚠️ `unresolved`.

## Functions that choose the algorithm

A function of the project's own that passes one of its parameters on as the algorithm (`fn digest(name: &str)` calling `MessageDigest::from_name(name)`) is followed to where it is called, and a call that passes a written value (`digest("sha256")`) is reported with that algorithm. A private function is matched only in its own file, and a method called on a value (`self.digest(...)`) is not followed. See [Functions that choose the algorithm from a parameter](../wrappers.md).

## Limits specific to Rust

- A method call on a value (`hasher.update(data)`, `key.sign(msg)`) is not reported on its own. The algorithm is reported where the value's type or algorithm constant is named.
- A crate that re-exports another crate's types under its own name is not followed. webauthn-rs, for example, uses RustCrypto through the `crypto-glue` crate (`crypto_glue::s256::Sha256`), so nothing in it is reported.
- A project's own wrapper (`crate::crypto::sha256(data)`) is reported only where the wrapper itself uses the library, not where it is called.
- Code generated at build time, by a build script or a procedural macro, is not read.
- A library that sets up rustls for you, such as reqwest or hyper-rustls, is reported only where your code names rustls or a provider itself. Which provider rustls 0.23 uses by default also depends on its Cargo features (`aws_lc_rs` by default, or `ring`), which are in `Cargo.toml` and are not read.
- Not covered yet: `sodiumoxide` and `libsodium-sys`, `boring` (BoringSSL), `orion`, `hpke`, `ssh-key` and Windows or Apple system cryptography.

These limits are pinned by `test/fixtures/rust/limits.rs`, which must produce no findings.

## Tested on

The results were compared with a separate text search: in each file that names a rule crate, every line (other than `use` lines and comments) with the last part of a rule's name as a whole word (`SHA256` for `ring::digest::SHA256`), or a crate name followed by `::` for the crates matched by name, unless the word is reached through some other type or module (`SignatureScheme::RSA_PKCS1_SHA256`) or is being defined (`pub static ED25519`).

| Code | Library used | Lines found by the text search | Reported by the tool | What the rest are |
|---|---|---|---|---|
| rustls (TLS) | ring, aws-lc-rs, rustls | 457 | 278 | 62 lines with rustls's own names spelled like ring's: its own statics (`ED25519` in a list of them), its own `hmac` module, and enum variants; 26 lines of rustls's own code that define its groups and providers; 46 lines in its tests that reach a provider through `use super::provider`, which is chosen in another file; 41 lines where the word `builder` is something else; 4 lines with a variable named `rsa` |
| rage (file encryption) | RustCrypto, x25519-dalek | 59 | 46 | 12 uses of age's own `scrypt` module (`scrypt::Identity::new`), 1 enum variant named `Aes256Gcm` |
| russh (SSH) | RustCrypto, aws-lc-rs or ring | 92 | 77 | 6 of russh's own constants with the same names as ring's (`&AES_256_GCM`), 2 lines with a variable named `rsa`, and 1 line of an error message |
| vaultwarden (Bitwarden server) | ring, openssl crate, jsonwebtoken, rustls, argon2 | 23 | 23 | |
| jsonwebtoken (its own source) | RustCrypto, aws-lc-rs | 183 | 142 | 38 lines of its own tests that name its `Algorithm` enum from inside the crate (`use crate::algorithms::Algorithm`), and 3 variants of its own enum `ThumbprintHash` (`SHA256`) |
| webauthn-rs | crypto-glue | 0 | 0 | Its cryptography goes through `crypto-glue`, which the tool does not follow (see the limits above) |

The tool also reported 136 lines the text search did not find, each checked by hand: names renamed in a `use` line (`AES_256_GCM as ALGORITHM_AES_256_GCM`), types used as generic arguments (`DhGroupKex::<Sha1>`), names brought in by `use` and written alone (`StaticSecret`), calls inside macros (`define_rsa_signer!(..., &crypto_sig::RSA_PKCS1_SHA256)`), and providers passed as arguments (`ClientConfig::builder(rustls_aws_lc_rs::DEFAULT_PROVIDER.into())`).

Scanning took from 1.3 seconds (jsonwebtoken, 0.2 MB of Rust) to 2.3 seconds (rustls, 2.9 MB), including about 0.8 seconds of start-up.
