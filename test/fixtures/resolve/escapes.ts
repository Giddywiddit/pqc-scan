import { createHash } from 'crypto';
register(createHash); // expect: - unresolved
export const lib = { createHash }; // expect: - unresolved
createHash('sha256'); // expect: SHA-256 observed-resistant
const text = 'createHash';
