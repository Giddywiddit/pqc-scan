// rustls: the crypto provider and key-exchange groups decide the key exchange.
use std::sync::Arc;
use rustls::crypto::{aws_lc_rs, ring};
use rustls::ClientConfig;

fn configs() {
    let default = ClientConfig::builder(); // expect: - unresolved
    let aws = aws_lc_rs::default_provider(); // expect: X25519MLKEM768 observed-resistant
    let classical = ring::default_provider(); // expect: ECDH vulnerable
    let provider = rustls::crypto::CryptoProvider {
        kx_groups: vec![aws_lc_rs::kx_group::X25519MLKEM768, aws_lc_rs::kx_group::X25519], // expect: X25519MLKEM768 observed-resistant, X25519 vulnerable
        ..aws_lc_rs::default_provider() // expect: X25519MLKEM768 observed-resistant
    };
    // rustls 0.24: the providers are their own crates, and the provider is passed to builder().
    let config = rustls::ServerConfig::builder(Arc::new(rustls_ring::DEFAULT_PROVIDER)); // expect: - unresolved, ECDH vulnerable
}

// The configuration types are also exported from rustls::client and rustls::server.
fn from_modules() {
    use rustls::server::ServerConfig;
    let config = ServerConfig::builder(); // expect: - unresolved
}
