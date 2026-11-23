// The older dgrijalva/jwt-go, imported without a name: its package is `jwt`, and its names are read as golang-jwt's.
package old

import "github.com/dgrijalva/jwt-go"

var method = jwt.SigningMethodPS256 // expect: RSA-PSS vulnerable
