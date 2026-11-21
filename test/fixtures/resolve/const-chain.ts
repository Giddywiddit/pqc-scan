import { generateKeyPairSync } from 'crypto';
const base = 'rsa';
const alias = base;
generateKeyPairSync(alias); // expect: RSA vulnerable
const typed = 'ml-kem-768' as const;
generateKeyPairSync(typed); // expect: ML-KEM-768 observed-resistant
