/* Documented limits of the C scanner (rules/c/README.md). None of these lines may produce a finding; if one starts
 * to, the limit has changed and the README must change with it. */
#include <openssl/sha.h>
#define HASH SHA256

void limits(struct hashes *table, const unsigned char *d, size_t n, unsigned char *out) {
    table->SHA256(d, n, out);                  /* a call through a function pointer */
    HASH(d, n, out);                           /* a macro that renames a crypto function */
    run_with(SHA256, d, n);                    /* a crypto function passed without being called */
    my_own_sha256(d, n, out);                  /* cryptography a project implements itself */
    BCryptHashData(handle, d, n, 0);           /* the Windows functions are not covered */
    SecKeyCreateRandomKey(params, &error);     /* nor Apple's */
    CC_SHA256(d, (CC_LONG)n, out);
    PK11_GenerateKeyPair(slot, mech, params, &pub, 1, 1, NULL); /* nor NSS */
}
