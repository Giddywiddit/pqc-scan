import crypto from 'crypto';
const a = crypto;
const b = a;
const gen = b.generateKeyPairSync;
gen('ec'); // expect: EC vulnerable
b.createHash('sha512'); // expect: SHA-512 observed-resistant
