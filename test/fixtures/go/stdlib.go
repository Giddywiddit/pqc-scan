// Go's standard library, used the usual ways: calls, types, constants and values passed as arguments.
package keys

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hmac"
	"crypto/mlkem"
	cryptorand "crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
)

type Signer struct {
	key *rsa.PrivateKey // expect: RSA vulnerable
}

func keys(data []byte) {
	rsaKey, _ := rsa.GenerateKey(cryptorand.Reader, 2048) // expect: RSA vulnerable, CSPRNG observed-resistant
	sig, _ := rsa.SignPKCS1v15(cryptorand.Reader, rsaKey, crypto.SHA256, data) // expect: RSA vulnerable, CSPRNG observed-resistant, SHA-256 observed-resistant
	ecKey, _ := ecdsa.GenerateKey(elliptic.P256(), cryptorand.Reader) // expect: ECDSA vulnerable, EC-P-256 vulnerable, CSPRNG observed-resistant
	mac := hmac.New(sha256.New, data) // expect: SHA-256 observed-resistant
	sum := sha256.Sum256(data) // expect: SHA-256 observed-resistant
	dk, _ := mlkem.GenerateKey768() // expect: ML-KEM-768 observed-resistant
	der := x509.MarshalPKCS1PrivateKey(rsaKey) // expect: RSA vulnerable
	_, _, _, _, _, _, _ = sig, ecKey, mac, sum, dk, der, data
}

func config() *tls.Config {
	return &tls.Config{ // expect: - unresolved
		CurvePreferences: []tls.CurveID{tls.X25519MLKEM768, tls.X25519}, // expect: X25519MLKEM768 observed-resistant, X25519 vulnerable
	}
}
