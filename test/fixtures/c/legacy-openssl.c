/* OpenSSL 1.x style low-level calls, where the algorithm is in the function name. */
#include <openssl/rsa.h>
#include <openssl/ec.h>
#include <openssl/sha.h>

void legacy(RSA *rsa, BIGNUM *e, unsigned char *d, size_t n, unsigned char *out) {
    RSA_generate_key_ex(rsa, 2048, e, NULL); // expect: RSA vulnerable
    EC_KEY *key = EC_KEY_new_by_curve_name(NID_X9_62_prime256v1); // expect: EC vulnerable
    EC_KEY *chosen = EC_KEY_new_by_curve_name(curve_from_config); // expect: EC vulnerable
    EC_KEY_generate_key(key); // expect: EC vulnerable
    SHA256(d, n, out); // expect: SHA-256 observed-resistant
    MD5(d, n, out); // expect: MD5 needs-review
    AES_set_encrypt_key(d, 128, &aes); // expect: AES-128 needs-review
    AES_set_encrypt_key(d, 256, &aes); // expect: AES-256 observed-resistant
}
