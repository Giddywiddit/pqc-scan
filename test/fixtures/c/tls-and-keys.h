/* Header files are scanned too. TLS setup and key loading cannot be resolved statically, so they are flagged. */
#include <openssl/ssl.h>

static inline SSL_CTX *server(const char *key_file) {
    SSL_CTX *ctx = SSL_CTX_new(TLS_server_method()); // expect: - unresolved
    SSL_CTX_set1_groups_list(ctx, "X25519MLKEM768:X25519"); // expect: - unresolved
    SSL_CTX_use_PrivateKey_file(ctx, key_file, SSL_FILETYPE_PEM); // expect: - unresolved
    return ctx;
}
