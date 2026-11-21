// A local `crypto` in one function must not hide the WebCrypto global in another (found scanning mozilla/send).
async function check() {
  await crypto.subtle.generateKey({ name: 'AES-GCM', length: 128 }, true, []); // expect: AES-128-GCM unresolved
}
async function other() {
  let crypto = await check();
  return crypto;
}
