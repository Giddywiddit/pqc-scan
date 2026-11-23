/* GnuTLS: the algorithm is a GNUTLS_* constant passed to a general function. */
#include <gnutls/gnutls.h>
#include <gnutls/crypto.h>
#include <gnutls/abstract.h>

void crypto(gnutls_privkey_t key, gnutls_pubkey_t pub) {
    gnutls_hash_fast(GNUTLS_DIG_SHA256, data, len, out); // expect: SHA-256 observed-resistant
    gnutls_hash_init(&hash, GNUTLS_DIG_SHA1); // expect: SHA-1 needs-review
    gnutls_hmac_fast(GNUTLS_MAC_SHA384, k, klen, data, len, out); // expect: HMAC-SHA-384 observed-resistant
    gnutls_aead_cipher_init(&aead, GNUTLS_CIPHER_AES_128_GCM, &k); // expect: AES-128-GCM needs-review
    gnutls_privkey_generate(key, GNUTLS_PK_RSA, 3072, 0); // expect: RSA vulnerable
    gnutls_privkey_generate2(key, GNUTLS_PK_MLDSA65, 0, 0, NULL, 0); // expect: ML-DSA-65 observed-resistant
    gnutls_privkey_sign_data2(key, GNUTLS_SIGN_ECDSA_SHA256, 0, &data_d, &sig); // expect: ECDSA vulnerable
    gnutls_privkey_sign_data(key, GNUTLS_DIG_SHA256, 0, &data_d, &sig); // expect: - unresolved
    gnutls_pubkey_verify_data2(pub, algo, 0, &data_d, &sig); // expect: - unresolved
    gnutls_rnd(GNUTLS_RND_KEY, buf, sizeof buf); // expect: CSPRNG observed-resistant
}

void tls(gnutls_session_t session) {
    gnutls_set_default_priority(session); // expect: - unresolved
    gnutls_certificate_set_x509_key_file(creds, "cert.pem", "key.pem", GNUTLS_X509_FMT_PEM); // expect: - unresolved
}
