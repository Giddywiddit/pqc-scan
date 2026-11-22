#include <sodium.h>

int main(void) {
    unsigned char pk[crypto_box_PUBLICKEYBYTES], sk[crypto_box_SECRETKEYBYTES];
    crypto_box_keypair(pk, sk); // expect: X25519 vulnerable
    crypto_sign_detached(sig, NULL, m, mlen, sk); // expect: Ed25519 vulnerable
    crypto_secretbox_easy(c, m, mlen, nonce, key); // expect: XSalsa20-Poly1305 observed-resistant
    crypto_generichash(h, sizeof h, m, mlen, NULL, 0); // expect: BLAKE2b observed-resistant
    randombytes_buf(nonce, sizeof nonce); // expect: CSPRNG observed-resistant
    crypto_kem_mlkem768_keypair(kpk, ksk); // expect: ML-KEM-768 observed-resistant
    crypto_kem_enc(ct, ss, kpk); // expect: X-Wing observed-resistant
    crypto_scalarmult_curve25519(q, n, p); // expect: X25519 vulnerable
    return 0;
}
