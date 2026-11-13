import crypto from 'node:crypto';
import { cfg } from './config.js';

const key = () => Buffer.from(cfg.encryptionKey, 'hex');

// AES-256-GCM: refresh token DB me plain text me kabhi nahi jaata
export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

export function decrypt(payload) {
  const [iv, tag, enc] = payload.split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

// Chhota signed cookie (JWT jaisa, bina extra library)
export function sign(obj, ttlSec = 60 * 60 * 24 * 14) {
  const body = Buffer.from(JSON.stringify({ ...obj, exp: Math.floor(Date.now() / 1000) + ttlSec })).toString('base64url');
  const mac = crypto.createHmac('sha256', cfg.sessionSecret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const good = crypto.createHmac('sha256', cfg.sessionSecret).update(body).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const o = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return o.exp > Date.now() / 1000 ? o : null;
  } catch { return null; }
}
