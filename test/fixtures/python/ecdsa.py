import ecdsa as curves
from ecdsa import SigningKey as signer

curves.SigningKey.generate(curve=curves.NIST256p)  # expect: ECDSA vulnerable
signer.from_string(raw_key)  # expect: ECDSA vulnerable
