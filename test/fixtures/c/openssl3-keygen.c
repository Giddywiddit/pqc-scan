/* OpenSSL 3 style: the algorithm is a name string or an EVP_PKEY_* constant. */
#include <openssl/evp.h>

EVP_PKEY *make_keys(void) {
    EVP_PKEY *rsa = EVP_PKEY_Q_keygen(NULL, NULL, "RSA", (size_t)3072); // expect: RSA vulnerable
    EVP_PKEY *kem = EVP_PKEY_Q_keygen(NULL, NULL, "ML-KEM-768"); // expect: ML-KEM-768 observed-resistant
    EVP_PKEY_CTX *ctx = EVP_PKEY_CTX_new_id(EVP_PKEY_ED25519, NULL); // expect: Ed25519 vulnerable
    EVP_PKEY_CTX *named = EVP_PKEY_CTX_new_from_name(NULL, "SLH-DSA-SHA2-128s", NULL); // expect: SLH-DSA-SHA2-128s observed-resistant
    EVP_PKEY_CTX *dynamic = EVP_PKEY_CTX_new_from_name(NULL, algorithm_name, NULL); // expect: - unresolved
    EVP_PKEY_keygen(ctx, &rsa);
    return rsa;
}
