# Go

Files: `.go`. A `vendor` folder next to a `go.mod` is skipped, because it holds copies of other modules made by `go mod vendor`, not your source. The code is read with the official tree-sitter Go grammar (`tree-sitter-go`), run as WebAssembly, so nothing is compiled on your machine and the Go toolchain is not needed.

Go code can call C libraries through cgo (`C.EVP_sha256()`), so every library on the [C page](../c/README.md) is matched in Go files too, when the file has `import "C"`.

## Libraries

| Library | Rule file | What is matched |
|---|---|---|
| Go's standard library | `stdlib.yaml` | Hashes (`sha256.New`, `sha512.Sum384`, `sha3.New256`, `md5`, `sha1`, and the `crypto.SHA256` constants), AES, DES and RC4, RSA, DSA, ECDSA, Ed25519, the elliptic curves and ECDH, ML-KEM (`crypto/mlkem`), ML-DSA (`crypto/mldsa`), HPKE's key exchanges (`crypto/hpke`), `crypto/rand`, the key and signature types in `crypto/x509`, and TLS: each key exchange named in code (`tls.X25519MLKEM768`, `tls.CurveP256`) and each `tls.Config` built. |
| golang.org/x/crypto | `x-crypto.yaml` | `sha3` (including Keccak), `blake2b`, `blake2s`, `md4`, `ripemd160`, `argon2`, `bcrypt`, `scrypt`, `chacha20poly1305`, `chacha20`, `salsa20`, `nacl/secretbox`, `nacl/box`, `nacl/sign`, `blowfish`, `cast5`, `curve25519`, `ed25519`, and SSH: the key-exchange and key-type constants (`ssh.KeyExchangeMLKEM768X25519`, `ssh.KeyAlgoRSA`) and each `ssh.ClientConfig`, `ssh.ServerConfig` or `ssh.Config` built. |
| Cloudflare CIRCL | `circl.yaml` | ML-KEM, ML-DSA, SLH-DSA, X-Wing and the hybrid `X25519MLKEM768`, the older pre-standard Kyber and Dilithium, FrodoKEM, Ed25519, Ed448, X25519, X448, BLS, and HPKE's key exchanges. |
| golang-jwt (v5, v4, v3) and dgrijalva/jwt-go | `jwt.yaml` | The signing methods (`jwt.SigningMethodRS256`) and a method chosen by name (`jwt.GetSigningMethod("ES256")`). |

Every name was checked against the source code when the rules were written: Go 1.27.4 (through its list of every exported name, in `api/`), golang.org/x/crypto, CIRCL and golang-jwt v5 from November 2026, golang-jwt v4 and v3.2.2, and dgrijalva/jwt-go 3 and 4.0.0-preview1. For each import path, the package name in its source was checked against the name Go code uses for it (see below).

Choices worth knowing:

- **A package with one algorithm is matched by its import path.** Any use of `crypto/rsa`, `crypto/ecdsa`, `crypto/md5`, `golang.org/x/crypto/curve25519` and the others listed by import path counts, including types such as `*rsa.PrivateKey` in a struct field or a type switch.
- **HMAC, HKDF and PBKDF2** take the hash as an argument (`hmac.New(sha256.New, key)`), and only the hash is reported.
- **AES** is reported as `unresolved`, because Go chooses AES-128, -192 or -256 by the length of the key passed to `aes.NewCipher`.
- **TLS and SSH set-up** is reported as `unresolved` where a `tls.Config`, `ssh.ClientConfig`, `ssh.ServerConfig` or `ssh.Config` is built, with what the defaults are. Go 1.24 and later offer the hybrid post-quantum key exchange X25519MLKEM768 first when `CurvePreferences` is not set (unless `GODEBUG=tlsmlkem=0`); Go 1.26 added SecP256r1MLKEM768 and SecP384r1MLKEM1024 to the defaults. golang.org/x/crypto v0.42.0 and later, with Go 1.24 or later, offer `mlkem768x25519-sha256` first for SSH when `KeyExchanges` is not set. A `tls.Config` named only as a type (`func f(c *tls.Config)`) is not reported.
- **The `crypto/hpke` and CIRCL `hpke` key exchanges** are reported by what they are made of: `hpke.MLKEM768X25519()` as the hybrid X25519MLKEM768, `hpke.DHKEM(...)` as a classical elliptic-curve key exchange.

## How Go is read

- **Package names.** A package is used through the name its import gives it: the name written in the import (`cryptorand "crypto/rand"`), or else the name Go tools assume from the import path. That is the path's last element, skipping a major version (`github.com/golang-jwt/jwt/v5` is `jwt`), without a `go-` prefix, and cut at the first character that cannot be in a Go name (`jwt-go` is `jwt`). goimports uses the same rule and writes the name out whenever the real one differs. `import _ "..."` is skipped, and with `import . "crypto/sha256"` the package's exported names written alone (`Sum256(data)`) are matched.
- **Local names hide packages.** A variable, parameter or constant named like a package (`rsa, err := makeKey()`) hides the package from the end of its declaration on, as in Go, so `rsa.PublicKey` after it is not reported, while `ecdsa, err := ecdsa.GenerateKey(...)` still is.
- **What counts.** A name counts wherever it is used: a call (`rsa.GenerateKey(...)`), a type (`*rsa.PrivateKey`), a constant (`crypto.SHA256`), or a function passed as a value (`sha256.New`). A struct listed as built (`tls.Config`) counts where it is built: `tls.Config{...}` or `&tls.Config{...}`.
- **One use per line.** A name used twice on one line is reported once.
- **Versions of one library.** golang-jwt v4 and v3 and dgrijalva/jwt-go have the same names as golang-jwt v5 and are read as v5.
- **Code the parser cannot read** that uses a rule package by its name in the file (`rsa.`) is reported as `unresolved`.

## Functions that choose the algorithm

A function of the project's own that passes one of its parameters on as the algorithm (`func method(name string)` calling `jwt.GetSigningMethod(name)`) is followed to where it is called, across packages, and a call that passes a written value (`sign.Method("ES256")`) is reported with that algorithm. An unexported function is matched only in its own package, and a method called on a value is not followed. See [Functions that choose the algorithm from a parameter](../../docs/wrappers.md).

## Limits specific to Go

- A method call on a value (`h.Write(data)`, `key.Sign(...)`) is not reported on its own. The algorithm is reported where the value's type or constructor is named.
- A setting changed on an existing value (`cfg.CurvePreferences = ...`, `cfg.KeyExchanges = ...`) is reported only where the key exchange it names is written (`tls.X25519`); key exchanges written as strings (`"curve25519-sha256"`) are not read.
- A project's own package with the same name as a library's (`mycompany/internal/crypto`) is told apart by its import path, so its functions are not reported. A project's own wrapper is reported only where the wrapper itself uses the library.
- The C code in a cgo comment above `import "C"` is not read, only the calls from Go.
- Not covered yet: go-jose, Tink, and the `crypto/cipher` modes on their own (the cipher is reported where it is created, as with `aes.NewCipher`).

These limits are pinned by `test/fixtures/go/limits.go`, which must produce no findings.

## Tested on

The results were compared with a separate text search: in each file that imports a rule package, every line (other than imports, comments and strings) with the package's usual name and a rule's member (`sha256.New`), followed by `(` or `{` for a struct counted where it is built, or the package's name followed by `.` for the packages matched as a whole.

| Code | Library used | Lines found by the text search | Reported by the tool | What the rest are |
|---|---|---|---|---|
| age (file encryption) | x/crypto, standard library | 178 | 178 | |
| Caddy (web server) | standard library, x/crypto, CIRCL | 126 | 122 | 4 functions that return a `*tls.Config` (`func ... *tls.Config {`), not a configuration being built |
| Smallstep certificates (certificate authority) | standard library, x/crypto | 434 | 432 | 2 functions that return a `*tls.Config` |
| wireguard-go (VPN) | x/crypto, standard library | 85 | 85 | |
| HashiCorp Vault (secrets manager) | standard library, x/crypto, golang-jwt | 1,727 | 1,710 | 4 functions that return a `*tls.Config`, 4 lists of `*tls.Config` values, 7 calls to `math/rand` in files that give `crypto/rand` another name, and 2 local variables named `rsa` and `ecdsa` |
| Sigstore cosign (signing) | standard library, x/crypto | 232 | 232 | |

The tool also reported 24 Go lines the text search did not find, each checked by hand: packages imported under another name (`stdx509 "crypto/x509"`, `crand "crypto/rand"`, `golangjwt "github.com/golang-jwt/jwt/v5"`).

Scanning took from 1.2 seconds (age, 0.3 MB of Go) to 3.8 seconds (Vault, 25 MB of Go plus its JavaScript user interface), including about 0.8 seconds of start-up.
