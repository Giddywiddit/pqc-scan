import { generateKeyPairSync } from 'crypto';
function first() { const algorithm = 'rsa'; generateKeyPairSync(algorithm); } // expect: - unresolved
function second() { const algorithm = 'ml-kem-768'; generateKeyPairSync(algorithm); } // expect: - unresolved
