// C libraries called from C++: in classes, lambdas and templates, with or without a leading `::`.
#include <openssl/evp.h>
#include <openssl/sha.h>

class Digest {
public:
    void run(const unsigned char *d, size_t n, unsigned char *out) {
        ::SHA256(d, n, out); // expect: SHA-256 observed-resistant
        auto md = [] { return EVP_sha1(); }; // expect: SHA-1 needs-review
    }
};

template <typename T>
EVP_PKEY *make(T bits) {
    return EVP_PKEY_Q_keygen(nullptr, nullptr, "RSA", bits); // expect: RSA vulnerable
}

namespace app {
void tls() {
    SSL_CTX *ctx = SSL_CTX_new(TLS_client_method()); // expect: - unresolved
    std::string name = "SHA256";
}
}

// C++'s "most vexing parse": these read as function declarations, but are objects built from a crypto call.
void wrappers(int nid) {
    rnp::ossl::evp::PKeyCtx ctx(EVP_PKEY_CTX_new_id(EVP_PKEY_DH, NULL)); // expect: DH vulnerable
    rnp::ossl::ECKey ec(EC_KEY_new_by_curve_name(nid)); // expect: EC vulnerable
    Holder h(EVP_PKEY_CTX_new_id(nid, NULL)); // expect: - unresolved
}
