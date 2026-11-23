// The jsonwebtoken crate: the algorithm is a variant of its Algorithm enum.
use jsonwebtoken::{decode, encode, Algorithm, Header, Validation};

const JWT_ALGORITHM: Algorithm = Algorithm::RS256; // expect: RSA vulnerable

fn tokens() {
    let header = Header::new(Algorithm::ES256); // expect: ECDSA vulnerable
    let validation = jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::HS256); // expect: HMAC-SHA256 observed-resistant
    let from_constant = Header::new(JWT_ALGORITHM);
}
