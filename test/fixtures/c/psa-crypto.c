/* PSA Crypto API (Mbed TLS 3.6 and 4, TF-M): the algorithm macro may wrap a hash, as in PSA_ALG_ECDSA(PSA_ALG_SHA_256). */
#include <psa/crypto.h>

void keys(psa_key_attributes_t *attributes, mbedtls_svc_key_id_t key) {
    psa_set_key_type(attributes, PSA_KEY_TYPE_ECC_KEY_PAIR(PSA_ECC_FAMILY_SECP_R1)); // expect: EC vulnerable
    psa_set_key_type(attributes, PSA_KEY_TYPE_RSA_KEY_PAIR); // expect: RSA vulnerable
    psa_set_key_type(attributes, PSA_KEY_TYPE_AES); // expect: AES unresolved
    psa_set_key_bits(attributes, 256);
    psa_generate_key(attributes, &key);
    psa_sign_hash(key, PSA_ALG_ECDSA(PSA_ALG_SHA_256), hash, 32, sig, sizeof sig, &sig_len); // expect: ECDSA vulnerable
    psa_hash_compute(PSA_ALG_SHA_256, in, len, out, 32, &out_len); // expect: SHA-256 observed-resistant
    psa_hash_setup(&op, PSA_ALG_SHA_1); // expect: SHA-1 needs-review
    psa_aead_encrypt(key, PSA_ALG_GCM, nonce, 12, NULL, 0, in, len, out, sizeof out, &out_len); // expect: GCM unresolved
    psa_aead_encrypt(key, PSA_ALG_CHACHA20_POLY1305, nonce, 12, NULL, 0, in, len, out, sizeof out, &out_len); // expect: ChaCha20-Poly1305 observed-resistant
    psa_raw_key_agreement(PSA_ALG_ECDH, key, peer, 65, secret, 32, &secret_len); // expect: ECDH vulnerable
    psa_key_derivation_setup(&kdf, PSA_ALG_HKDF(PSA_ALG_SHA_256)); // expect: HKDF unresolved
    psa_cipher_encrypt(key, chosen_alg, in, len, out, sizeof out, &out_len); // expect: - unresolved
    psa_generate_random(buf, sizeof buf); // expect: CSPRNG observed-resistant
}
