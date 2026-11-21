import jwt from 'jsonwebtoken';
const options = { algorithm: 'RS256' } as const;
jwt.sign({}, key, options); // expect: RSA vulnerable
jwt.sign({}, key, { algorithm: 'HS256' }); // expect: HMAC-SHA256 observed-resistant
jwt.sign({}, key, { ...base }); // expect: - unresolved
jwt.verify(t, key, { algorithms: ['ES256', 'RS256'] }); // expect: ECDSA vulnerable, RSA vulnerable
