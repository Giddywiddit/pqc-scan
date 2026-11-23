// Documented limits of the C++ scanner (rules/cpp/README.md). None of these lines may produce a finding.
#include "uses_cryptopp_namespace.h"

void limits(Hasher &hasher, const unsigned char *d, size_t n) {
    SHA256 fromHeader;                  // `using namespace CryptoPP` written in another file is not seen
    hasher.hash(d, n);                  // a call through an object of the project's own type
    auto f = &std::string::size;
    CryptoPP_SHA256_like(d, n);         // a name that merely contains a library's name
}
