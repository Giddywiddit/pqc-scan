// jsonwebtoken verify reads options.algorithms (array), not options.algorithm.
import jwt from 'jsonwebtoken';
jwt.verify(token, key, { algorithms: ['RS256'] }); // expect: RSA vulnerable
jwt.verify(token, key); // expect: - unresolved
