import { createHash } from 'crypto';

export function digest(name: string) {
  return createHash(name);
}
