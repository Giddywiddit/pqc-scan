#include <openssl/hmac.h>
#include <openssl/evp.h>

void mac(const unsigned char *k, int kl, const unsigned char *d, size_t dl, unsigned char *out, unsigned int *ol) {
    HMAC(EVP_sha256(), k, kl, d, dl, out, ol); // expect: HMAC-SHA-256 observed-resistant, SHA-256 observed-resistant
    const EVP_MD *md = EVP_get_digestbynid(NID_sha1); // expect: SHA-1 needs-review
    const EVP_MD *fetched = EVP_MD_fetch(NULL, "SHA2-256", NULL); // expect: SHA-256 observed-resistant
    const EVP_CIPHER *c = EVP_get_cipherbyname(cipher_from_config); // expect: - unresolved
    HMAC(md, k, kl, d, dl, out, ol); // expect: - unresolved
}
