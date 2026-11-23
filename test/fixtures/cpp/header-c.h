/* A `.h` file holding C that uses a C++ keyword as a name. The C++ grammar cannot read the call below, so the C
 * grammar is used, which reads all of it. */
#include <openssl/sha.h>

static inline void hash_twice(const unsigned char *d, unsigned char *out) {
    int new = 2;
    SHA256(d, new, out); /* expect: SHA-256 observed-resistant */
}
