import { createHash } from 'crypto';

export const fingerprint = (data: string) => createHash('sha256').update(data).digest('hex');
