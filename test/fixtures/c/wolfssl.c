/* wolfSSL's wolfCrypt functions, including its ML-KEM, ML-DSA and SLH-DSA support. */
#include <wolfssl/wolfcrypt/sha256.h>
#include <wolfssl/wolfcrypt/hmac.h>
#include <wolfssl/wolfcrypt/wc_mlkem.h>
#include <wolfssl/ssl.h>

void crypto(void) {
    wc_InitSha256(&sha);  // expect: SHA-256 observed-resistant
    wc_Sha256Update(&sha, data, len);
    wc_Sha256Final(&sha, digest);
    wc_InitMd5(&md5); // expect: MD5 needs-review
    wc_HmacSetKey(&hmac, WC_SHA256, key, 32); // expect: HMAC-SHA-256 observed-resistant
    wc_AesGcmSetKey(&aes, key, 32); // expect: AES-256 observed-resistant
    wc_AesSetKey(&aes, key, sizeof(key), iv, AES_ENCRYPTION); // expect: - unresolved
    wc_MakeRsaKey(&rsa, 3072, WC_RSA_EXPONENT, &rng); // expect: RSA vulnerable
    wc_ecc_make_key(&rng, 32, &ecc); // expect: EC vulnerable
    wc_ed25519_sign_msg(msg, len, sig, &sig_len, &ed); // expect: Ed25519 vulnerable
    wc_MlKemKey_Init(&kem, WC_ML_KEM_768, NULL, INVALID_DEVID); // expect: ML-KEM-768 observed-resistant
    wc_MlKemKey_MakeKey(&kem, &rng);
    wc_MlDsaKey_SetParams(&dsa, WC_ML_DSA_65); // expect: ML-DSA-65 observed-resistant
    wc_RNG_GenerateBlock(&rng, buf, sizeof buf); // expect: CSPRNG observed-resistant
}

void tls(WOLFSSL *ssl) {
    WOLFSSL_CTX *ctx = wolfSSL_CTX_new(wolfTLS_client_method()); // expect: - unresolved
    wolfSSL_UseKeyShare(ssl, WOLFSSL_X25519MLKEM768); // expect: X25519MLKEM768 observed-resistant
    wolfSSL_UseKeyShare(ssl, WOLFSSL_ECC_SECP256R1); // expect: ECDH-P-256 vulnerable
}
