import { generateKeyPairSync } from 'crypto';
generateKeyPairSync.call(null, 'rsa'); // expect: RSA vulnerable
generateKeyPairSync.apply(null, ['ed25519']); // expect: Ed25519 vulnerable
generateKeyPairSync.apply(null, args); // expect: - unresolved
