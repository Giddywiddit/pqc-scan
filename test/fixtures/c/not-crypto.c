/* Names that merely look like crypto, in comments and strings, and a struct member call, must not be reported. */
// RSA_generate_key_ex(rsa, 2048, e, NULL);
const char *doc = "call EVP_sha256() to get SHA-256";
void f(struct table *t) { t->SHA256(x); my_SHA256_helper(); }
