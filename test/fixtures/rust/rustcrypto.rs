// RustCrypto crates, used the usual ways: through `use` lines, with full paths, as generic arguments and inside macros.
use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit};
use hmac::{Hmac, Mac};
use p256::ecdsa::{signature::Signer, Signature, SigningKey};
use rsa::{Pkcs1v15Encrypt, RsaPrivateKey};
use sha2::{Digest, Sha256};

type HmacSha512 = Hmac<sha2::Sha512>; // expect: SHA-512 observed-resistant

fn hash(data: &[u8]) -> Vec<u8> {
    let mut hasher = Sha256::new(); // expect: SHA-256 observed-resistant
    hasher.update(data);
    let mac = Hmac::<Sha256>::new_from_slice(b"key").unwrap(); // expect: SHA-256 observed-resistant
    let legacy = md5::compute(data); // expect: MD5 needs-review
    assert_eq!(sha3::Sha3_256::digest(data).len(), 32); // expect: SHA3-256 observed-resistant
    hasher.finalize().to_vec()
}

fn keys(rng: &mut impl rand_core::CryptoRng) {
    let signing_key = SigningKey::random(rng); // expect: ECDSA-P-256 vulnerable
    let signature: Signature = signing_key.sign(b"message"); // expect: ECDSA-P-256 vulnerable
    let private_key = RsaPrivateKey::new(rng, 2048).unwrap(); // expect: RSA vulnerable
    let ciphertext = private_key.to_public_key().encrypt(rng, Pkcs1v15Encrypt, b"m"); // expect: RSA vulnerable
    let cipher = Aes256Gcm::new_from_slice(&[0u8; 32]).unwrap(); // expect: AES-256-GCM observed-resistant
    let secret = x25519_dalek::EphemeralSecret::random(); // expect: X25519 vulnerable
    let (dk, ek) = ml_kem::MlKem768::generate(rng); // expect: ML-KEM-768 observed-resistant
}

// The project's own items that share a library name are not reported where they are defined.
struct Sha256Wrapper;
fn sha256(input: &[u8]) {}

// A lower-case name alone is a variable or a module, so it counts only when called.
use rsa::pss;
use md5::compute;
fn sign_with(pss: bool, data: &[u8]) {
    if pss {
        let key = pss::SigningKey::<sha2::Sha256>::new(todo!()); // expect: RSA vulnerable, SHA-256 observed-resistant
    }
    let digest = compute(data); // expect: MD5 needs-review
    println!(
        "a string over two lines \
        that mentions sha2::Sha256 and {:?}",
        sha1::Sha1::digest(data) // expect: SHA-1 needs-review
    );
}

// Inside a macro, comments and strings are single tokens, so their text is never read as code.
fn macro_tokens(data: &[u8]) {
    assert!(data.len() > 0 /* sha1::Sha1 is not used here */, "nor md5::compute");
    assert_eq!(
        sha2::Sha384::digest(data).len(), // expect: SHA-384 observed-resistant
        48 // and not ripemd::Ripemd160
    );
}
