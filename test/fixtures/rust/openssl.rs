// The openssl crate.
use openssl::hash::{hash, MessageDigest};
use openssl::pkey::PKey;
use openssl::rsa::Rsa;
use openssl::ssl::{SslConnector, SslMethod};
use openssl::symm::{encrypt, Cipher};

fn openssl_uses(data: &[u8], name: &str) {
    let digest = hash(MessageDigest::sha256(), data); // expect: SHA-256 observed-resistant
    let by_name = MessageDigest::from_name("sha3-512"); // expect: SHA3-512 observed-resistant
    let unknown = MessageDigest::from_name(name); // expect: - unresolved
    let rsa = Rsa::generate(2048).unwrap(); // expect: RSA vulnerable
    let ed = PKey::generate_ed25519().unwrap(); // expect: Ed25519 vulnerable
    let ciphertext = encrypt(Cipher::aes_128_cbc(), b"0123456789abcdef", None, data); // expect: AES-128-CBC needs-review
    let connector = SslConnector::builder(SslMethod::tls()).unwrap(); // expect: - unresolved
    openssl::rand::rand_bytes(&mut [0u8; 16]).unwrap(); // expect: CSPRNG observed-resistant
}
