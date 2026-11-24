from Crypto.PublicKey import RSA

RSA.unknown_operation(value)  # no finding: unsupported API is not silently classified
text = "RSA.generate(bits=2048)"  # no finding: string literal
