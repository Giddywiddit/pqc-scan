/* #if branches that leave braces unbalanced used to hide everything below them from the parser. */
#include <openssl/evp.h>

#ifdef USE_NEW_API
static int setup(void) {
#else
static int setup(int legacy) {
#endif
    const EVP_CIPHER *c = EVP_aes_256_gcm(); // expect: AES-256 observed-resistant
#if OPENSSL_VERSION_NUMBER >= 0x30000000L
    EVP_MD *md = EVP_MD_fetch(NULL, "SHA256", NULL); // expect: SHA-256 observed-resistant
#else
    const EVP_MD *md = EVP_sha1(); // expect: SHA-1 needs-review
#endif
    return 0;
}

/* A call that exists only inside a macro is reported where the macro is defined. */
#define HASH_WITH_MD5(d, n, o) MD5(d, n, o) // expect: MD5 needs-review
#define MULTI_LINE_KEY(k)                \
    do {                                 \
        AES_set_encrypt_key(k, 256, &s); /* expect: AES-256 observed-resistant */ \
    } while (0)
void uses(void) { HASH_WITH_MD5(a, b, c); }
