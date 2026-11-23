// Libraries put an export macro between `class` and the class name. It is blanked before parsing, so the class
// header, including its base classes, can be read.
#pragma once
#include <botan/rsa.h>

namespace app {
class APP_PUBLIC_API(3, 6) Signer final : public virtual Base,
                                         public virtual Botan::RSA_PublicKey { // expect: RSA vulnerable
  public:
    int size() const;
};
}
