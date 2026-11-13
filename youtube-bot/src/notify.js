import nodemailer from 'nodemailer';
import { cfg, log } from './config.js';

let tx;
function transport() {
  if (!cfg.smtp.user || !cfg.smtp.pass) return null;
  return (tx ||= nodemailer.createTransport({
    host: cfg.smtp.host, port: cfg.smtp.port, secure: cfg.smtp.port === 465,
    auth: { user: cfg.smtp.user, pass: cfg.smtp.pass }
  }));
}

export async function email(to, subject, text) {
  const t = transport();
  if (!t || !to) { log('email skip (SMTP/to missing):', subject); return false; }
  try { await t.sendMail({ from: cfg.smtp.from, to, subject, text }); return true; }
  catch (e) { log('email fail:', e.message); return false; }
}

// Creator ke webhook (Zapier / Make / apna WhatsApp bridge) pe JSON POST
export async function webhook(url, payload) {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;       // SSRF/plain-text se bachao
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(u.hostname)) return false;
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) });
    return r.ok;
  } catch (e) { log('webhook fail:', e.message); return false; }
}

export async function alertOwner(tenant, { reason, comment }) {
  const s = tenant.settings;
  const text =
    `Naya comment jisme "${reason}" hai - AI ne reply NAHI kiya.\n\n` +
    `Video: ${comment.videoTitle}\nViewer: ${comment.viewerName} (${comment.viewerChannel || '-'})\n\nComment:\n${comment.body}\n\n` +
    `YouTube Studio > Comments me ja kar khud reply karein.`;
  const a = await email(s.ownerEmail || tenant.email, `[${s.profile.channelName || 'Channel'}] Collab/Contact request`, text);
  const b = await webhook(s.webhookUrl, { type: 'owner_alert', reason, ...comment });
  return a || b;
}
