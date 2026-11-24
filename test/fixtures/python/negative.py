text = "rsa.generate_private_key('rsa')"
def generate_private_key():
    return None

generate_private_key()  # no crypto import, no finding

def local_shadow(jwt):
    jwt.encode(payload, key, algorithm='RS256')  # no finding: parameter shadows import
