import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { google } from 'googleapis';
import { cfg, ROOT, log, assertPlatformEnv, DEFAULT_SETTINGS } from './config.js';
import { migrate, upsertTenant, getTenant, saveSettings, deleteTenant, recentComments, countTenants, getUsage } from './db.js';
import { encrypt, sign, verify } from './crypto.js';
import { oauth2, authUrl, authForTenant } from './google.js';
import { myChannel } from './youtubeApi.js';
import { createSheetForTenant, sheetUrl } from './sheets.js';
import { sendReportFor } from './report.js';
import { startWorker } from './worker.js';
import { decide } from './claude.js';
import { sanitizeReply, detectForward, detectBlocked } from './filters.js';
import { budgetFor } from './quota.js';

assertPlatformEnv();
await migrate();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
  next();
});

const cookie = (req, n) => (req.headers.cookie || '').split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === n)?.[1];
const setCookie = (res, n, v, maxAge) =>
  res.append('Set-Cookie', `${n}=${v}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${cfg.baseUrl.startsWith('https') ? '; Secure' : ''}`);

async function me(req, res, next) {
  const s = verify(cookie(req, 'sid'));
  const t = s && (await getTenant(s.tid));
  if (!t) return res.status(401).json({ error: 'login required' });
  req.tenant = t;
  next();
}

// ---------- Public pages ----------
app.get('/health', (_, res) => res.json({ ok: true }));
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

// ---------- Google login ----------
app.get('/auth/google', (req, res) => {
  const nonce = crypto.randomBytes(16).toString('hex');
  setCookie(res, 'oauth_state', nonce, 600);
  res.redirect(authUrl(nonce));
});

app.get('/auth/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) return res.redirect('/?msg=cancelled');
    if (!state || state !== cookie(req, 'oauth_state')) return res.status(400).send('Invalid state');
    const o = oauth2();
    const { tokens } = await o.getToken(String(code));
    o.setCredentials(tokens);

    const info = await google.oauth2({ version: 'v2', auth: o }).userinfo.get();
    const ch = await myChannel(o);
    if (!ch) return res.redirect('/?msg=no_channel');

    if (!tokens.refresh_token) return res.redirect('/?msg=no_refresh'); // prompt=consent ke saath hamesha milna chahiye
    if ((await countTenants()) >= cfg.maxTenants) return res.redirect('/?msg=full');

    const tenant = await upsertTenant({
      sub: info.data.id, email: info.data.email, channelId: ch.id, channelTitle: ch.title,
      refreshTokenEnc: encrypt(tokens.refresh_token)
    });
    if (!tenant.sheet_id) await createSheetForTenant(tenant).catch((e) => log('sheet create fail:', e.message));

    setCookie(res, 'sid', sign({ tid: tenant.id }), 60 * 60 * 24 * 14);
    res.redirect('/app');
  } catch (e) {
    log('auth callback err:', e.message);
    res.redirect('/?msg=error');
  }
});

app.post('/auth/logout', (req, res) => { setCookie(res, 'sid', '', 0); res.json({ ok: true }); });

// ---------- Dashboard API ----------
const publicTenant = async (t) => ({
  id: t.id, email: t.email, channelId: t.channel_id, channelTitle: t.channel_title,
  sheetUrl: sheetUrl(t.sheet_id), settings: t.settings, status: t.status,
  usage: { ...(await getUsage(t.id)), budget: await budgetFor(t.id), aiLimit: cfg.tenantMaxAiReplies }
});

app.get('/api/me', me, async (req, res) => res.json(await publicTenant(req.tenant)));

const str = (v, n = 500) => String(v ?? '').slice(0, n);
const strList = (a, n = 60, len = 80) => (Array.isArray(a) ? a : []).map((x) => str(x, len).trim()).filter(Boolean).slice(0, n);

app.put('/api/settings', me, async (req, res) => {
  const b = req.body || {};
  const cur = req.tenant.settings;
  const p = b.profile || {};
  const next = {
    ...cur,
    botEnabled: !!b.botEnabled,
    postReplies: !!b.postReplies,
    hideAbusive: !!b.hideAbusive,
    liveChat: !!b.liveChat,
    liveWelcome: !!b.liveWelcome,
    weeklyReport: !!b.weeklyReport,
    ownerEmail: str(b.ownerEmail, 200),
    webhookUrl: /^https:\/\//.test(b.webhookUrl || '') ? str(b.webhookUrl, 400) : '',
    forwardPatterns: strList(b.forwardPatterns ?? cur.forwardPatterns),
    blockedWords: strList(b.blockedWords ?? cur.blockedWords),
    profile: {
      ...cur.profile,
      channelName: str(p.channelName, 100), aiName: str(p.aiName, 60), ownerName: str(p.ownerName, 60),
      topic: str(p.topic, 200), audience: str(p.audience, 200), style: str(p.style, 300),
      calling: str(p.calling, 300), languages: str(p.languages, 200),
      priceInfo: str(p.priceInfo, 600), nudge: str(p.nudge, 100),
      links: Object.fromEntries(Object.keys(DEFAULT_SETTINGS.profile.links).map((k) => [k, /^https?:\/\//.test(p.links?.[k] || '') ? str(p.links[k], 300) : ''])),
      faqs: (Array.isArray(p.faqs) ? p.faqs : []).slice(0, 20).map((f) => ({ q: str(f.q, 200), a: str(f.a, 500) })).filter((f) => f.q && f.a),
      extraRules: strList(p.extraRules, 15, 300)
    }
  };
  await saveSettings(req.tenant.id, next);
  res.json(await publicTenant(await getTenant(req.tenant.id)));
});

app.get('/api/comments', me, async (req, res) => res.json(await recentComments(req.tenant.id, 100)));

// "Try it" box - dashboard me live reply preview (YouTube pe kuch post nahi hota)
app.post('/api/try', me, async (req, res) => {
  const text = str(req.body?.text, 500);
  if (!text) return res.status(400).json({ error: 'text do' });
  const s = req.tenant.settings;
  const fw = detectForward(text, s);
  if (fw) return res.json({ action: 'forward_owner', note: `"${fw}" mila - AI reply nahi karega, aapko forward karega.` });
  if (detectBlocked(text, s)) return res.json({ action: 'reply', reply: 'Aapki baat samajh gaya bhai, dhyan rakhenge 🙏', note: 'gali filter' });
  const r = await decide({ profile: s.profile, comment: { videoTitle: 'Test video', viewerName: 'Test Viewer', body: text } });
  if (!r.ok) return res.status(502).json({ error: r.reason });
  const clean = r.data.reply ? sanitizeReply(r.data.reply, s.profile) : { ok: true, text: '' };
  res.json({ ...r.data, reply: clean.ok ? clean.text : '', note: clean.ok ? '' : `blocked: ${clean.reason}` });
});

app.post('/api/report-now', me, async (req, res) => {
  try { res.json({ report: await sendReportFor(req.tenant) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Disconnect + data delete (YouTube API Services policy: user ko control)
app.delete('/api/account', me, async (req, res) => {
  try {
    const auth = authForTenant(req.tenant);
    await auth.revokeToken?.(auth.credentials.refresh_token).catch(() => {});
  } catch { /* ignore */ }
  await deleteTenant(req.tenant.id);
  setCookie(res, 'sid', '', 0);
  res.json({ ok: true });
});

app.get('/app', (req, res) => res.sendFile(path.join(ROOT, 'public', 'app.html')));

app.listen(cfg.port, () => {
  log(`server chalu: ${cfg.baseUrl} (port ${cfg.port})`);
  startWorker();
});
