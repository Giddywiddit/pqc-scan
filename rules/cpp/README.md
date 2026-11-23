# C++

Files: `.cpp`, `.cc`, `.cxx`, `.c++`, `.h`, `.hpp`, `.hh`, `.hxx` and `.h++`. The code is read with the official tree-sitter C++ grammar (`tree-sitter-cpp`), run as WebAssembly, so nothing is compiled on your machine and no build configuration is needed.

C++ code also calls C libraries directly, so every library on the [C page](../c/README.md) (OpenSSL, libsodium, Mbed TLS, PSA Crypto, wolfSSL, GnuTLS and Botan's C interface) is matched in C++ files too.

## Libraries

| Library | Rule file | What is matched |
|---|---|---|
| Crypto++ (namespace `CryptoPP`) | `cryptopp.yaml` | Its algorithm classes wherever they are used: as a variable's type (`CryptoPP::SHA256 h;`), as a template argument (`CryptoPP::GCM<CryptoPP::AES>`), in `new`, or as a temporary (`CryptoPP::SHA256().CalculateDigest(...)`). Covers hashes, ciphers and modes, RSA, elliptic curves, Ed25519, X25519, Diffie-Hellman, DSA and its random number generators. |
| Botan 3 (namespace `Botan`) | `botan.yaml` | Factory functions with the algorithm as a string (`Botan::HashFunction::create("SHA-256")`, `Botan::Cipher_Mode::create("AES-256/GCM", ...)`, `Botan::create_private_key("ML-KEM", ...)`), key classes (`Botan::RSA_PrivateKey`, `Botan::ML_KEM_PrivateKey`, `Botan::ML_DSA_PrivateKey`, ...), random number generators and TLS clients and servers. |

Every class, function and namespace name in these rule files was checked against the library's header files when the rules were written: Crypto++ 8 from its October 2026 source, and Botan 3.14. Botan's algorithm-name strings were checked against its source and tests.

Two Botan details are reported as 🔍 rather than ✅:

- In Botan, `ML_KEM_PrivateKey` is another name for `Kyber_PrivateKey`, and the class holds either ML-KEM or the older pre-standard Kyber, depending on a mode value. The same is true of `Dilithium_PrivateKey` (ML-DSA or Dilithium) and `SphincsPlus_PrivateKey` (SLH-DSA or SPHINCS+). Code that names the ML-KEM, ML-DSA or SLH-DSA class is reported ✅; code that names the older class is reported 🔍 so the mode can be checked.
- FrodoKEM and Classic McEliece are believed to resist quantum computers but are not NIST standards.

## How C++ is read

- **Namespaces.** A name counts when it is written with its library's namespace (`CryptoPP::SHA256`, `::Botan::HashFunction::create`), through a namespace alias (`namespace cp = CryptoPP;` then `cp::SHA256`), or without the namespace in a file that has `using namespace CryptoPP;` or `using CryptoPP::SHA256;`. A class of the project's own that happens to share a name is not reported where it is defined.
- **Templates.** Each template argument is matched on its own, so `CryptoPP::ECB_Mode<CryptoPP::AES>::Encryption` reports both ECB and AES, and `std::make_unique<Botan::Ed25519_PrivateKey>(rng)` reports Ed25519.
- **One use per line.** A type named twice on one line (`std::unique_ptr<CryptoPP::SHA256> p(new CryptoPP::SHA256)`) is reported once.
- **Calls inside a declaration.** C++ reads `Wrapper w(EVP_PKEY_CTX_new_id(EVP_PKEY_DH, NULL));` as declaring a function (the "most vexing parse"). Inside a function body, the tool treats it as the call it almost always is.
- **Export macros.** A macro between `class` and the class name (`class BOTAN_PUBLIC_API(3, 6) RSA_PublicKey`) is blanked before parsing, so the rest of the class header, including its base classes, can be read.
- **The preprocessor** is handled as for C: both sides of every `#if` are read, code inside `#define` macros is read separately and reported on the line where the macro is defined, and a known name inside code the parser cannot read is reported as ⚠️ `unresolved`.

## `.h` files

A `.h` file can hold C or C++, so it is read by the C++ adapter and checked against both the C and the C++ rules. It is read with the C++ grammar, unless the C++ grammar could not read all of it and found nothing only C++ has (`namespace`, `class`, `template`, `using` or `::`). In that case the C grammar is tried too, and whichever leaves less of the file unreadable is used. C code that uses a C++ keyword as a name (`int new = 2;`) is the usual reason.

## Limits specific to C++

- A `using namespace` written in another file (usually a header the file includes) is not seen, so unqualified names that rely on it are not matched.
- Code written inside a library's own namespace, as the library's own source is, uses names without the namespace and is not matched. In Crypto++'s own tests this misses 10 calls such as `NaCl::crypto_sign(...)`.
- A macro used as a whole statement, with no semicolon, can stop the grammar reading the code right after it.
- A call through an object (`hash.Update(data)`) is not reported on its own. The algorithm is reported where the object's type is named.
- Cryptography a project implements itself under its own names is not recognised.
- Not covered yet: Qt (`QCryptographicHash`), the Windows cryptography functions (`BCrypt...`) and Apple's.

These limits are pinned by `test/fixtures/cpp/limits.cpp`, which must produce no findings.

## Tested on

The results were compared with a separate text search for every rule name: calls to a C rule function, and names of a C++ rule written with its namespace.

| Code | Library used | Lines found by the text search | Reported by the tool | What the rest are |
|---|---|---|---|---|
| RNP (OpenPGP) | Botan's C interface, OpenSSL | 166 | 166 | |
| MEGA SDK | Crypto++ | 55 | 54 | 1 `using` line |
| Poco | OpenSSL | 74 | 71 | 3 string constants named `SHA256`, `SHA384` and `SHA512` |
| cpp-httplib | OpenSSL | 56 | 50 | 3 definitions of its own `MD5` function, and 3 of the `SHA1` class in a library bundled for its benchmarks |
| Botan (its own source) | Botan | 1,338 | 1,215 | 122 declarations or definitions of Botan's own functions, and 1 real miss: a base class `Botan::RSA_PublicKey` right after a macro used as a statement (`BOTAN_DIAGNOSTIC_IGNORE_INHERITED_VIA_DOMINANCE`), which the grammar cannot read |
| Crypto++ (its own source) | Crypto++ | 52 | 21 | 21 declarations, definitions or `using` lines, and the 10 calls in its own tests described above |

Scanning took from 1.7 seconds (RNP, 5 MB of code) to 4.9 seconds (Botan, 15 MB), including about 0.8 seconds of start-up.
