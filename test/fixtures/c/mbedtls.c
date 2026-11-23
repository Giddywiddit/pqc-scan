/* Mbed TLS 3.6: one-shot hashes take a flag that picks the variant, and key types are MBEDTLS_PK_* constants. */
#include <mbedtls/sha256.h>
#include <mbedtls/pk.h>
#include <mbedtls/md.h>

int digest_and_sign(mbedtls_pk_context *pk, const unsigned char *in, size_t len, unsigned char *out, int is224) {
    mbedtls_sha256(in, len, out, 0); // expect: SHA-256 observed-resistant
    mbedtls_sha256(in, len, out, is224); // expect: - unresolved
    mbedtls_sha256_starts(&ctx, 1); // expect: SHA-224 needs-review
    const mbedtls_md_info_t *md = mbedtls_md_info_from_type(MBEDTLS_MD_SHA1); // expect: SHA-1 needs-review
    const mbedtls_md_info_t *byname = mbedtls_md_info_from_string("SHA384"); // expect: SHA-384 observed-resistant
    mbedtls_pk_setup(pk, mbedtls_pk_info_from_type(MBEDTLS_PK_RSA)); // expect: RSA vulnerable
    mbedtls_rsa_gen_key(mbedtls_pk_rsa(*pk), mbedtls_ctr_drbg_random, &drbg, 3072, 65537); // expect: RSA vulnerable
    mbedtls_aes_setkey_enc(&aes, key, 256); // expect: AES-256 observed-resistant
    mbedtls_md_hmac(md, key, 32, in, len, out);
    return mbedtls_pk_sign(pk, MBEDTLS_MD_SHA256, in, len, out, 512, &len, NULL, NULL); // expect: - unresolved
}

void tls(mbedtls_ssl_config *conf) {
    mbedtls_ssl_config_defaults(conf, MBEDTLS_SSL_IS_CLIENT, MBEDTLS_SSL_TRANSPORT_STREAM, MBEDTLS_SSL_PRESET_DEFAULT); // expect: - unresolved
    mbedtls_pk_parse_keyfile(&key, "client.key", NULL, NULL, NULL); // expect: - unresolved
}
