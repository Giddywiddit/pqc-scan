// An import without a name of its own is used by the name Go tools assume from its path: jwt/v5 and jwt-go are `jwt`.
package tokens

import "github.com/golang-jwt/jwt/v5"

func sign() {
	token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, jwt.MapClaims{}) // expect: EdDSA vulnerable
	_ = jwt.SigningMethodHS256 // expect: HMAC-SHA256 observed-resistant
	_ = token
}
