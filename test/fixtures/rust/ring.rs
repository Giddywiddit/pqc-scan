// ring, and aws-lc-rs, which has the same interface and is read as ring.
use ring::{agreement, digest, rand, signature};
use aws_lc_rs::{kem, signature as aws_signature};

fn ring_uses(data: &[u8]) {
    let rng = rand::SystemRandom::new(); // expect: CSPRNG observed-resistant
    let hash = digest::digest(&digest::SHA256, data); // expect: SHA-256 observed-resistant
    let key = agreement::EphemeralPrivateKey::generate(&agreement::X25519, &rng); // expect: X25519 vulnerable
    let pkcs8 = signature::Ed25519KeyPair::generate_pkcs8(&rng); // expect: Ed25519 vulnerable
    let public = signature::UnparsedPublicKey::new(&signature::RSA_PKCS1_2048_8192_SHA256, data); // expect: RSA vulnerable
    let legacy = ring::digest::digest(&ring::digest::SHA1_FOR_LEGACY_USE_ONLY, data); // expect: SHA-1 needs-review
}

fn aws_lc_rs_uses(data: &[u8]) {
    let hash = aws_lc_rs::digest::digest(&aws_lc_rs::digest::SHA384, data); // expect: SHA-384 observed-resistant
    let sha3 = aws_lc_rs::digest::digest(&aws_lc_rs::digest::SHA3_256, data); // expect: SHA3-256 observed-resistant
    let decapsulation = kem::DecapsulationKey::generate(&kem::ML_KEM_768); // expect: ML-KEM-768 observed-resistant
    let signer = aws_signature::PqdsaKeyPair::generate(&aws_signature::ML_DSA_65_SIGNING); // expect: ML-DSA-65 observed-resistant
    let p521 = aws_signature::EcdsaKeyPair::generate(&aws_signature::ECDSA_P521_SHA512_ASN1_SIGNING); // expect: ECDSA vulnerable, ECDSA-P-521 vulnerable
}

// A `use` applies to its own module or block: the test module's `hmac` is the project's own, not ring's.
fn uses_ring_hmac() {
    use ring::hmac;
    let key = hmac::Key::new(hmac::HMAC_SHA256, b"k"); // expect: HMAC-SHA-256 observed-resistant
}

mod tests {
    use crate::hmac;

    fn own_hmac() {
        let key = hmac::HMAC_SHA256;
    }
}

// Code inside `macro_rules!` is read as text, on the line where it is written.
macro_rules! ecdsa_signer {
    ($name:ident, $alg:expr) => {
        pub struct $name(signature::EcdsaKeyPair); // expect: ECDSA vulnerable
    };
}
