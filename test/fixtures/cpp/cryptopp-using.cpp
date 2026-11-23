// With `using namespace CryptoPP`, the class names are written without the namespace.
#include <cryptopp/eccrypto.h>
using namespace CryptoPP;

void sign() {
    AutoSeededRandomPool rng; // expect: CSPRNG observed-resistant
    ECDSA<ECP, SHA256>::PrivateKey key; // expect: ECDSA vulnerable, SHA-256 observed-resistant
    ed25519::Signer signer; // expect: Ed25519 vulnerable
    Weak::MD5 legacy; // expect: MD5 needs-review
}

// A class of the project's own that shares a name is not reported: only names used, not defined, count.
struct SHA1 {
    int state;
};
