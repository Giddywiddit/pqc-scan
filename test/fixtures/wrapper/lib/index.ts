import { createHash } from 'crypto';

export const hash = (name: string) => createHash(name);
