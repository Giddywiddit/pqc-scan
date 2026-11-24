from cryptography.hazmat.primitives.asymmetric import rsa
import jwt

size = int(os.environ['KEY_SIZE'])
rsa.generate_private_key(public_exponent=65537, key_size=size)  # expect: RSA vulnerable
jwt.encode(payload, key, algorithm=os.environ['JWT_ALGORITHM'])  # expect: - unresolved

# cryptography.hazmat.primitives.asymmetric.rsa.generate_private_key('rsa')
