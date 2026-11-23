// Documented limits of the Go scanner (rules/go/README.md). None of these lines may produce a finding.
package limits

import (
	"crypto/tls"
	"crypto/aes"
	"mycompany/internal/crypto"
)

func limits(h interface{ Write([]byte) }, cfg *tls.Config, block interface{}, data []byte) {
	h.Write(data)                             // a method call on a value
	_ = crypto.SHA256(data)                   // a project's own package named like the library's
	cfg.CurvePreferences = nil                // a setting changed on an existing value
	_ = "crypto/sha256"                       // an import path inside a string
	var _ = aes.BlockSize                     // a constant that does not choose an algorithm
}
