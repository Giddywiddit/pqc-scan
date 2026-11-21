const crypto = require('node:crypto');
const { createHmac: hmac } = crypto;
hmac('sha256', key); // expect: HMAC-SHA-256 observed-resistant
const lib = 'crypto';
require(lib).createHash('md5'); // expect: MD5 needs-review
require(process.env.LIB).createHash('md5');
