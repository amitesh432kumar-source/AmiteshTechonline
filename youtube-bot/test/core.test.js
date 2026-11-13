import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.SESSION_SECRET = 'test-secret';

const { DEFAULT_SETTINGS } = await import('../src/config.js');
const { detectForward, detectBlocked, sanitizeReply, normalize } = await import('../src/filters.js');
const { buildSystemPrompt } = await import('../src/prompt.js');
const { encrypt, decrypt, sign, verify } = await import('../src/crypto.js');

const S = DEFAULT_SETTINGS;
const profile = { ...S.profile, channelName: 'Test', links: { ...S.profile.links, course: 'https://example.com/course' } };

test('collab / paid promotion / number => forward', () => {
  for (const t of ['Bhai collab karna hai', 'Paid Promotion ke liye contact?', 'apna number do bhai', 'Business enquiry for you', 'कोलैब करें?', 'whatsapp number dena']) {
    assert.ok(detectForward(t, S), t);
  }
});
test('normal comments forward nahi hote', () => {
  for (const t of ['Kitne number aaye exam me?', 'Great video bhai', 'price kya hai?', 'Bhai ye promotion wala ad skip kaise kare?x'.replace('promotion wala', 'wala')]) {
    assert.equal(detectForward(t, S), null, t);
  }
});
test('gali detect', () => {
  assert.ok(detectBlocked('tu chutiya hai', S));
  assert.equal(detectBlocked('class me ass ignment', S), null);
});
test('sanitize: phone/email/key/fake link block', () => {
  assert.equal(sanitizeReply('Call me on 9876543210', profile).ok, false);
  assert.equal(sanitizeReply('mail karo abc@gmail.com', profile).ok, false);
  assert.equal(sanitizeReply('key sk-ant-api03-abcdef', profile).ok, false);
  assert.equal(sanitizeReply('Link: https://evil.com/x', profile).ok, false);
  assert.equal(sanitizeReply('As an AI, I cannot', profile).ok, false);
  assert.equal(sanitizeReply('Course yaha hai https://example.com/course ❤️', profile).ok, true);
});
test('sanitize: lamba reply chhota hota hai', () => {
  const r = sanitizeReply('Bahut accha sawal hai. '.repeat(40), profile, 280);
  assert.ok(r.ok && r.text.length <= 280);
});
test('normalize html', () => assert.equal(normalize('a <b>b</b> &amp; c'), 'a b & c'));
test('prompt: price khali => price mat batao', () => {
  const p = buildSystemPrompt(profile);
  assert.match(p, /price kabhi mat batao/i);
  assert.match(p, /https:\/\/example.com\/course/);
  assert.match(p, /owner se puch ke batata hu/);
});
test('prompt: live mode', () => assert.match(buildSystemPrompt(profile, { mode: 'live' }), /LIVE CHAT MODE/));
test('crypto roundtrip + tamper', () => {
  const e = encrypt('refresh-token-123');
  assert.equal(decrypt(e), 'refresh-token-123');
  assert.throws(() => decrypt(e.slice(0, -4) + 'AAAA'));
});
test('session cookie sign/verify', () => {
  const t = sign({ tid: 5 });
  assert.equal(verify(t).tid, 5);
  assert.equal(verify(t + 'x'), null);
  assert.equal(verify(sign({ tid: 5 }, -10)), null);
});
