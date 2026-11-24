import hashlib
import paramiko
from nacl.public import PrivateKey
from nacl.signing import SigningKey

hashlib.md5(data)  # expect: MD5 needs-review
hashlib.sha1(data)  # expect: SHA-1 needs-review
hashlib.sha256(data)  # expect: SHA-256 observed-resistant
paramiko.RSAKey.generate(bits=2048)  # expect: RSA vulnerable
PrivateKey.generate()  # expect: X25519 vulnerable
SigningKey.generate()  # expect: Ed25519 vulnerable
