from cryptography.hazmat.primitives.asymmetric import rsa as r, ec
from cryptography.hazmat.primitives import hashes

r.generate_private_key(public_exponent=65537, key_size=2048)  # expect: RSA vulnerable
ec.generate_private_key(ec.SECP256R1())  # expect: EC vulnerable
hashes.SHA256()  # expect: SHA-256 observed-resistant
hashes.SHA1()  # expect: SHA-1 needs-review
