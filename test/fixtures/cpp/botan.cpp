// Botan 3: algorithms are named by strings given to factory functions, or by key classes.
#include <botan/hash.h>
#include <botan/cipher_mode.h>
#include <botan/pk_algs.h>
#include <botan/rsa.h>
#include <botan/auto_rng.h>

void use(const std::string &chosen) {
    Botan::AutoSeeded_RNG rng; // expect: CSPRNG observed-resistant
    auto sha = Botan::HashFunction::create("SHA-256"); // expect: SHA-256 observed-resistant
    auto md5 = Botan::HashFunction::create_or_throw("MD5"); // expect: MD5 needs-review
    auto gcm = Botan::Cipher_Mode::create("AES-256/GCM", Botan::Cipher_Dir::Encryption); // expect: AES-256-GCM observed-resistant
    auto dynamic = Botan::HashFunction::create(chosen); // expect: - unresolved
    Botan::RSA_PrivateKey rsa(rng, 3072); // expect: RSA vulnerable
    auto kem = Botan::create_private_key("ML-KEM", rng, "ML-KEM-768"); // expect: ML-KEM observed-resistant
    auto ed = std::make_unique<Botan::Ed25519_PrivateKey>(rng); // expect: Ed25519 vulnerable
    Botan::PK_Signer signer(*ed, rng, "Pure"); // expect: - unresolved
    Botan::Kyber_PrivateKey kyber(rng, Botan::KyberMode::ML_KEM_768); // expect: ML-KEM or Kyber needs-review
}

void wrapped(const std::string &cipher_name, Botan::Cipher_Dir dir) {
    std::unique_ptr<Botan::Cipher_Mode> mode(Botan::Cipher_Mode::create(cipher_name, dir)); // expect: - unresolved
    Botan::Sodium::crypto_box_easy(c, m, n, nonce, pk, sk); // expect: X25519 vulnerable
}

class TPM2_RSA_PublicKey final : public virtual Botan::RSA_PublicKey { // expect: RSA vulnerable
};
