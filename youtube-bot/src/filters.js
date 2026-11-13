// Rule-based safety net. Claude se PEHLE aur BAAD me chalta hai - model galti kare tab bhi rules bachte hain.

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// a-z0-9 ke bahar boundary => Hindi (Devanagari) text ke saath bhi sahi kaam karta hai
const wordRe = (w) => new RegExp(`(?<![a-z0-9])${esc(w.toLowerCase().trim())}(?![a-z0-9])`, 'i');

export function normalize(text = '') {
  return String(text)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchAny(text, list = []) {
  const t = normalize(text).toLowerCase();
  for (const w of list) {
    if (!w || !w.trim()) continue;
    if (wordRe(w).test(t)) return w;
  }
  return null;
}

// Rule 6 (user spec): collab / paid promotion / number => AI reply nahi, owner ko forward
export const detectForward = (text, settings) => matchAny(text, settings.forwardPatterns);
export const detectBlocked = (text, settings) => matchAny(text, settings.blockedWords);

const PHONE = /(?:\+?\d[\d\s\-().]{8,}\d)/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const SECRET = /(sk-ant-[\w-]+|AIza[\w-]{20,}|ya29\.[\w-]+|-----BEGIN [A-Z ]+-----|api[_-]?key\s*[:=])/i;
const URL_RE = /https?:\/\/[^\s)]+|(?:www\.)[^\s)]+/gi;
const ROBOT = /\bas an ai\b|\bas a language model\b|\bi am an ai\b|\bmain ek ai hu\b/i;

export function allowedUrls(profile = {}) {
  return Object.values(profile.links || {}).filter(Boolean).map((u) => u.toLowerCase().replace(/\/$/, ''));
}

/**
 * Claude ka reply post karne se pehle check:
 *  - phone / email / API key leak nahi
 *  - sirf creator ke apne links (hallucinated link nahi)
 *  - "As an AI" jaisa robot-pan nahi
 *  - chhota reply
 */
export function sanitizeReply(reply, profile, maxChars = 280) {
  let text = normalize(reply);
  if (!text) return { ok: false, reason: 'empty' };
  if (PHONE.test(text)) return { ok: false, reason: 'phone number in reply' };
  if (EMAIL.test(text)) return { ok: false, reason: 'email in reply' };
  if (SECRET.test(text)) return { ok: false, reason: 'secret-like text in reply' };
  if (ROBOT.test(text)) return { ok: false, reason: 'robot phrasing' };
  const allowed = allowedUrls(profile);
  for (const u of text.match(URL_RE) || []) {
    const clean = u.toLowerCase().replace(/[.,!?]+$/, '').replace(/\/$/, '');
    if (!allowed.some((a) => clean === a || clean.startsWith(a))) {
      return { ok: false, reason: `link not in creator's list: ${u}` };
    }
  }
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
    const cut = Math.max(text.lastIndexOf('. '), text.lastIndexOf('! '), text.lastIndexOf('? '), text.lastIndexOf('। '));
    if (cut > 80) text = text.slice(0, cut + 1);
  }
  return { ok: true, text };
}
