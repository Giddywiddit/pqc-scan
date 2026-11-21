// `constructor` and `toString` are inherited object keys, never algorithm names.
import { createHash } from 'crypto';
createHash('constructor'); // expect: - unresolved
createHash('toString'); // expect: - unresolved
