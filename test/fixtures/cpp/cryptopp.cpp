// Crypto++: algorithms are classes, so every use of the class counts, including as a template argument.
#include <cryptopp/sha.h>
#include <cryptopp/aes.h>
#include <cryptopp/modes.h>
#include <cryptopp/osrng.h>
#include <cryptopp/rsa.h>

namespace cp = CryptoPP;

class Hasher {
    CryptoPP::SHA256 hash_; // expect: SHA-256 observed-resistant
};

void encrypt(const CryptoPP::byte *key, size_t length) {
    CryptoPP::AutoSeededRandomPool rng; // expect: CSPRNG observed-resistant
    CryptoPP::GCM<CryptoPP::AES>::Encryption gcm; // expect: AES unresolved
    CryptoPP::ECB_Mode<CryptoPP::AES>::Encryption ecb; // expect: ECB needs-review, AES unresolved
    cp::HMAC<cp::SHA1> mac(key, length); // expect: SHA-1 needs-review
    CryptoPP::Weak::MD5 legacy; // expect: MD5 needs-review
    CryptoPP::InvertibleRSAFunction params; // expect: RSA vulnerable
    params.GenerateRandomWithKeySize(rng, 3072);
    CryptoPP::RSAES_OAEP_SHA_Encryptor encryptor(params); // expect: RSA vulnerable
    std::string name = CryptoPP::SHA512().AlgorithmName(); // expect: SHA-512 observed-resistant
    std::unique_ptr<CryptoPP::SHA256> owned(new CryptoPP::SHA256); // expect: SHA-256 observed-resistant
}
