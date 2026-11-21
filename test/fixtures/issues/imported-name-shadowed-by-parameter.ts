import { createHash } from 'crypto';
function local(createHash: (name: string) => unknown) { return createHash('md5'); }
createHash('sha256'); // expect: SHA-256 observed-resistant
