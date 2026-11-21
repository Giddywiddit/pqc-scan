const alg = { name: 'ECDH', namedCurve: 'P-256' };
crypto.subtle.generateKey(alg, true, ['deriveBits']); // expect: ECDH vulnerable
crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, []); // expect: AES-256-GCM observed-resistant
crypto.subtle.generateKey({ name: 'AES-GCM', length: 128 }, true, []); // expect: AES-128-GCM needs-review
crypto.subtle.digest('SHA-256', data); // expect: SHA-256 observed-resistant
crypto.subtle.exportKey('raw', key);
