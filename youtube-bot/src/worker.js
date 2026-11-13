import cron from 'node-cron';
import { cfg, log } from './config.js';
import { listActiveTenants, touchPoll } from './db.js';
import { authForTenant, handleAuthError, isQuotaError } from './google.js';
import { newThreads, videoTitles, activeLiveChatId, chatMessages, sendChat } from './youtubeApi.js';
import { handleMessage } from './processor.js';
import * as quota from './quota.js';
import { sendWeeklyReports } from './report.js';

const state = new Map(); // tenantId -> { nextComments, since, live: {...} }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runPool(items, limit, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) { const it = queue.shift(); try { await fn(it); } catch (e) { log('worker err:', e.message); } }
  }));
}

async function pollComments(tenant, st) {
  const auth = authForTenant(tenant);
  if (!(await quota.canSpend(tenant.id, quota.COST.list))) return;
  const started = new Date();
  const since = st.since || new Date(Date.now() - 60 * 60 * 1000).toISOString();
  let threads;
  try {
    threads = await newThreads(auth, tenant.channel_id, since);
    await quota.spend(tenant.id, quota.COST.list);
  } catch (e) {
    if (await handleAuthError(tenant, e)) return log(`[tenant ${tenant.id}] token revoke - disconnected`);
    if (isQuotaError(e)) return log('YouTube quota khatam (project level)');
    throw e;
  }
  st.since = new Date(started.getTime() - 120 * 1000).toISOString(); // 2 min overlap, dedupe DB karega
  await touchPoll(tenant.id);

  const fresh = threads.filter((t) => t.viewerChannel !== tenant.channel_id && !t.ownerReplied);
  if (!fresh.length) return;
  const titleOf = await videoTitles(auth, fresh.map((t) => t.videoId));
  await quota.spend(tenant.id, quota.COST.list);

  for (const t of fresh) {
    await handleMessage({
      tenant, auth, source: 'comment',
      c: { externalId: t.commentId, videoId: t.videoId, videoTitle: titleOf(t.videoId), viewerName: t.viewerName, viewerChannel: t.viewerChannel, body: t.body }
    });
  }
}

async function pollLive(tenant, st) {
  const s = tenant.settings;
  const auth = authForTenant(tenant);
  const L = (st.live ||= { chatId: null, next: null, nextAt: 0, checkAt: 0, seen: new Set(), welcomed: new Set(), welcomeQ: [], sentTimes: [], initial: true });
  const now = Date.now();

  if (!L.chatId) {
    if (now < L.checkAt) return;
    L.checkAt = now + 3 * 60 * 1000;               // har 3 min me check: live shuru hua?
    if (!(await quota.canSpend(tenant.id, 1))) return;
    const b = await activeLiveChatId(auth).catch(() => null);
    await quota.spend(tenant.id, 1);
    if (!b) return;
    Object.assign(L, { chatId: b.chatId, videoId: b.videoId, title: b.title, next: null, initial: true });
    log(`[tenant ${tenant.id}] live chat mili: ${b.title}`);
  }
  if (now < L.nextAt) return;
  if (!(await quota.canSpend(tenant.id, quota.COST.chatList))) return;

  let page;
  try { page = await chatMessages(auth, L.chatId, L.next); }
  catch (e) { L.chatId = null; return; }          // live khatam
  await quota.spend(tenant.id, quota.COST.chatList);
  L.next = page.next;
  L.nextAt = now + Math.max(page.waitMs, 15000);  // quota bachane ke liye min 15s

  const minuteAgo = now - 60000;
  L.sentTimes = L.sentTimes.filter((t) => t > minuteAgo);

  for (const m of page.items) {
    if (L.seen.has(m.id)) continue;
    L.seen.add(m.id);
    if (m.authorId === tenant.channel_id || m.isOwner) continue;
    if (L.initial) { L.welcomed.add(m.authorId); continue; }     // puraana chat history pe reply nahi
    if (s.liveWelcome && !L.welcomed.has(m.authorId)) { L.welcomed.add(m.authorId); L.welcomeQ.push(m.authorName); }
    if (m.text.trim().length < 4) continue;
    if (L.sentTimes.length >= 6) continue;                       // rate limit: max 6 reply/min
    await handleMessage({
      tenant, auth, source: 'live', chatId: L.chatId,
      c: { externalId: m.id, videoId: L.videoId, videoTitle: L.title, viewerName: m.authorName, viewerChannel: m.authorId, body: m.text }
    });
    L.sentTimes.push(Date.now());
  }
  L.initial = false;

  // Welcome: ek saath 3 naam tak, ek message me (quota + spam bachta hai)
  if (s.liveWelcome && s.botEnabled && s.postReplies && L.welcomeQ.length && L.sentTimes.length < 6 && (await quota.canSpend(tenant.id, quota.COST.chatInsert))) {
    const names = L.welcomeQ.splice(0, 3).map((n) => n.replace(/^@/, ''));
    const msg = `Welcome ${names.join(', ')} 🙏 Live me aane ka shukriya! Sawal ho to chat me poochho ❤️`;
    await sendChat(auth, L.chatId, msg).catch(() => {});
    await quota.spend(tenant.id, quota.COST.chatInsert);
    L.sentTimes.push(Date.now());
  }
  if (L.seen.size > 5000) L.seen = new Set([...L.seen].slice(-1000));
}

async function tick() {
  const tenants = (await listActiveTenants()).filter((t) => t.settings.botEnabled || t.settings.postReplies === false);
  const now = Date.now();
  await runPool(tenants, 4, async (tenant) => {
    if (!tenant.settings.botEnabled) return;
    const st = state.get(tenant.id) || { nextComments: 0 };
    state.set(tenant.id, st);
    try {
      if (now >= st.nextComments) {
        st.nextComments = now + cfg.pollSeconds * 1000 + Math.random() * 10000; // jitter
        await pollComments(tenant, st);
      }
      if (tenant.settings.liveChat) await pollLive(tenant, st);
    } catch (e) {
      log(`[tenant ${tenant.id}] error:`, e.message);
    }
  });
}

export function startWorker() {
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try { await tick(); } finally { running = false; }
  }, 15000);
  // Har Sunday 9:00 IST (03:30 UTC) - weekly report sabke liye
  cron.schedule('30 3 * * 0', () => sendWeeklyReports().catch((e) => log('report err', e.message)), { timezone: 'UTC' });
  log(`worker chalu: poll har ~${cfg.pollSeconds}s`);
}
