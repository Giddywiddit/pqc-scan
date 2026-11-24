from Crypto.PublicKey import RSA as rsa, ECC as ecc
from Crypto.Cipher import AES

rsa.generate(bits=2048)  # expect: RSA vulnerable
ecc.generate(curve='P-256')  # expect: ECC vulnerable
AES.new(key, AES.MODE_GCM)  # expect: AES needs-review
