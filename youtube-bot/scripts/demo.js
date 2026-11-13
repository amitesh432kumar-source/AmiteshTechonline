// DEMO MODE: bina DB / Google / API key ke dashboard dekho (nakli data).
// Chalao: npm run demo   ->  http://localhost:4000
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DEFAULT_SETTINGS } from '../src/config.js';
import { detectForward, detectBlocked } from '../src/filters.js';

const samples = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/samples.json'), 'utf8'));
let settings = {
  ...DEFAULT_SETTINGS, botEnabled: true, postReplies: false, ownerEmail: 'creator@example.com',
  profile: { ...DEFAULT_SETTINGS.profile, channelName: 'Demo Tech Channel', aiName: 'Team Demo', ownerName: 'Rahul',
    topic: 'Tech / Business', audience: 'India, 18-35, students', priceInfo: '',
    links: { ...DEFAULT_SETTINGS.profile.links, course: 'https://example.com/course' },
    faqs: [{ q: 'Upload kab hota hai?', a: 'Har hafte naya video aata hai.' }] }
};
const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
const rows = samples.slice(0, 12).map((s, i) => ({
  created_at: ago(i * 7 + 2), viewer_name: ['Rahul', 'Priya', 'Aman', 'Sneha', 'Vikas'][i % 5], body: s.comment,
  reply: s.reply || null, is_lead: ['Price', 'Collab'].includes(s.type),
  status: s.action === 'forward_owner' ? 'forwarded' : s.action === 'hide' ? 'held' : s.action === 'skip' ? 'skipped' : 'dry_run'
}));

const app = express();
app.use(express.json());
app.get('/api/me', (_, res) => res.json({
  id: 1, email: 'creator@example.com', channelTitle: 'Demo Tech Channel', channelId: 'UCdemo', status: 'active',
  sheetUrl: 'https://docs.google.com/spreadsheets', settings,
  usage: { units: 640, ai_replies: 23, budget: 1500, aiLimit: 100 }
}));
app.put('/api/settings', (req, res) => {
  settings = { ...settings, ...req.body, profile: { ...settings.profile, ...req.body.profile } };
  res.json({ id: 1, channelTitle: 'Demo Tech Channel', sheetUrl: 'https://docs.google.com/spreadsheets', settings, usage: { units: 640, ai_replies: 23, budget: 1500, aiLimit: 100 } });
});
app.get('/api/comments', (_, res) => res.json(rows));
// Asli Claude nahi - sirf sample answers + asli filters
app.post('/api/try', (req, res) => {
  const t = String(req.body?.text || '');
  const fw = detectForward(t, settings);
  if (fw) return res.json({ action: 'forward_owner', note: `"${fw}" mila - AI reply nahi karega, aapko forward karega.` });
  if (detectBlocked(t, settings)) return res.json({ action: 'reply', reply: 'Aapki baat samajh gaya bhai, dhyan rakhenge 🙏', note: 'gali filter' });
  const hit = samples.find((s) => s.comment.toLowerCase().split(/\W+/).filter((w) => w.length > 3).some((w) => t.toLowerCase().includes(w)));
  res.json({ action: 'reply', category: hit?.type?.toLowerCase() || 'other', reply: hit?.reply || 'Thanks bhai ❤️ Koi aur doubt ho to batao', note: 'DEMO: asli me Claude likhega' });
});
app.post('/api/report-now', (_, res) => res.json({ ok: true }));
app.post('/auth/logout', (_, res) => res.json({ ok: true }));
app.delete('/api/account', (_, res) => res.json({ ok: true }));
app.get('/app', (_, res) => res.sendFile(path.join(ROOT, 'public/app.html')));
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));
app.listen(4000, () => console.log('DEMO: http://localhost:4000  (dashboard: /app)'));
