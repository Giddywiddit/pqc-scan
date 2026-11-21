import { createHash } from 'crypto';
export function digest(name: string) {
  return createHash(name); // expect: - unresolved
}
export const fixed = () => createHash('sha256'); // expect: SHA-256 observed-resistant
