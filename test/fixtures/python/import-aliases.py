import cryptography.hazmat.primitives.asymmetric.ec as elliptic
from cryptography.hazmat.primitives.asymmetric import ed25519 as signing

elliptic.generate_private_key(elliptic.SECP256R1())  # expect: EC vulnerable
signing.Ed25519PrivateKey.generate()  # expect: Ed25519 vulnerable
