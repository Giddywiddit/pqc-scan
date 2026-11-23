// Go-specific cases: import names, local names that hide a package, dot imports, cgo and methods.
package edges

/*
#include <openssl/evp.h>
*/
import "C"

import (
	. "crypto/sha512"
	_ "crypto/sha1"
	jwtlib "github.com/golang-jwt/jwt/v4"
	"crypto/ed25519"
	"crypto/md5"
	"crypto/rsa"
	"crypto/sha256"
	"golang.org/x/crypto/ssh"
	"github.com/cloudflare/circl/kem/mlkem/mlkem768"
)

func edges(data []byte, name string) {
	token := jwtlib.NewWithClaims(jwtlib.SigningMethodRS256, nil) // expect: RSA vulnerable
	method := jwtlib.GetSigningMethod("ES256") // expect: ECDSA vulnerable
	byName := jwtlib.GetSigningMethod(name) // expect: - unresolved
	sum := Sum384(data) // expect: SHA-384 observed-resistant
	md := C.EVP_sha256() // expect: SHA-256 observed-resistant
	sign := (*rsa.PrivateKey).Sign // expect: RSA vulnerable
	pk, sk, _ := mlkem768.GenerateKeyPair(nil) // expect: ML-KEM-768 observed-resistant
	cfg := &ssh.ClientConfig{ // expect: - unresolved
		Config: ssh.Config{KeyExchanges: []string{ssh.KeyExchangeMLKEM768X25519}}, // expect: - unresolved, mlkem768x25519-sha256 observed-resistant
	}
	_, _, _, _, _, _, _, _, _, _ = token, method, byName, sum, md, sign, pk, sk, cfg, data
}

// A local name hides a package of the same name from the end of its declaration on, as in Go.
func shadowing(md5 string, data []byte) {
	h := sha256.New() // expect: SHA-256 observed-resistant
	sha256 := h.Sum(nil)
	again := sha256.Len
	_ = md5.Sum
	if ed25519 := data; len(ed25519) > 0 {
		_ = ed25519.Sign
	}
	_ = ed25519.GenerateKey // expect: Ed25519 vulnerable
	_ = again
}

// The project's own type named like a library's is not reported.
type PrivateKey struct{}
