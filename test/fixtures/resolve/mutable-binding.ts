import { generateKeyPairSync } from 'crypto';
let algorithm = 'rsa';
algorithm = 'ml-kem-768';
generateKeyPairSync(algorithm); // expect: - unresolved
var legacy = 'rsa';
generateKeyPairSync(legacy); // expect: - unresolved
