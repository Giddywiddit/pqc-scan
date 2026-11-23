// A `.h` file holding C++: read with the C++ grammar.
#pragma once
#include <cryptopp/sha.h>
#include <memory>

namespace app {
template <typename Hash = CryptoPP::SHA256> // expect: SHA-256 observed-resistant
class Checksum {
    std::unique_ptr<Hash> hash_;
};
}
