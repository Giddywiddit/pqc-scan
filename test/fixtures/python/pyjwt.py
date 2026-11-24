import jwt

jwt.encode({'sub': 'alice'}, key, algorithm='RS256')  # expect: RSA vulnerable
jwt.encode({'sub': 'alice'}, key, algorithm='HS256')  # expect: HMAC-SHA256 observed-resistant
