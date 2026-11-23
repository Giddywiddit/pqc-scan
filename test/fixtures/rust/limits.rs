// Documented limits of the Rust scanner (rules/rust/README.md). None of these lines may produce a finding.
use crate::crypto::Hasher;

fn limits(hasher: &mut Hasher, key: &impl Signer, data: &[u8]) {
    let thread_rng = rand::rng();                         // rand's ThreadRng is not reported
    hasher.update(data);                                  // a method call on a value
    let signature = key.sign(data);                       // a method call on a value
    let digest = crypto_glue::s256::Sha256::digest(data); // a crate that re-exports another crate's types
    let h = crate::crypto::sha256(data);                  // a project's own wrapper, where it is called
    let s = "sha2::Sha256";                               // a name inside a string
    let mac = hmac::Hmac::<MyHash>::new_from_slice(b"k"); // HMAC is reported through its hash type only
}
