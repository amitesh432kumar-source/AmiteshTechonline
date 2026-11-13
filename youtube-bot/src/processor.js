import { log } from './config.js';
import { claim, finishComment, releaseClaim } from './db.js';
import { detectForward, detectBlocked, sanitizeReply } from './filters.js';
import { decide } from './claude.js';
import { replyTo, holdForReview, sendChat } from './youtubeApi.js';
import { appendRow } from './sheets.js';
import { alertOwner } from './notify.js';
import * as quota from './quota.js';

const fmtDate = () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
const POLITE = 'Aapki baat samajh gaya bhai, dhyan rakhenge 🙏';

async function logSheet(tenant, c, f) {
  await appendRow(tenant, 'Comments', [
    fmtDate(), c.videoTitle, c.viewerName, c.body, f.reply || '', f.isLead ? 'Yes' : 'No', f.category || '', f.status, c.externalId, c.videoId || ''
  ]);
  if (f.isLead) {
    await appendRow(tenant, 'Leads', [fmtDate(), c.viewerName, c.viewerChannel || '', f.interest || '', c.body, c.videoTitle, 'New']);
  }
  if (f.action === 'forward_owner') {
    await appendRow(tenant, 'Owner_Inbox', [fmtDate(), c.viewerName, c.viewerChannel || '', c.body, f.reason || f.category || '', c.videoTitle, 'No']);
  }
}

/**
 * Ek comment / live-chat message ka poora pipeline.
 * c = { externalId, videoId, videoTitle, viewerName, viewerChannel, body }
 */
export async function handleMessage({ tenant, auth, c, source = 'comment', chatId }) {
  const s = tenant.settings;
  const live = source === 'live';
  const rowId = await claim(tenant.id, source, c.externalId, c);
  if (!rowId) return; // pehle hi handle ho chuka => 2 baar reply nahi (Rule 4)

  const finish = async (f) => {
    await finishComment(rowId, f);
    if (!live || f.reply || f.isLead || f.action === 'forward_owner') await logSheet(tenant, c, f);
  };

  try {
    // ---- 1. Hard rule: collab / paid promotion / number => AI reply nahi, owner ko forward ----
    const fw = detectForward(c.body, s);
    if (fw) {
      await alertOwner(tenant, { reason: fw, comment: c });
      return finish({ action: 'forward_owner', category: 'collab', status: 'forwarded', isLead: true, interest: `forward: ${fw}`, reason: fw });
    }

    // ---- 2. Gali / abuse: Claude ko bulaye bina (sasta + safe) ----
    const bad = detectBlocked(c.body, s);
    if (bad) {
      if (!live && s.hideAbusive && s.postReplies && s.botEnabled && (await quota.canSpend(tenant.id, quota.COST.moderate))) {
        await holdForReview(auth, c.externalId);
        await quota.spend(tenant.id, quota.COST.moderate);
        return finish({ action: 'hide', category: 'abuse', sentiment: 'negative', status: 'held' });
      }
      return await postOrDry({ tenant, auth, c, rowId, reply: POLITE, source, chatId, meta: { category: 'abuse', sentiment: 'negative' }, finish });
    }

    // ---- 3. Limits ----
    if (!(await quota.aiAllowed(tenant.id))) return finish({ action: 'skip', status: 'skipped_ai_limit' });

    // ---- 4. Claude ----
    const res = await decide({ profile: s.profile, mode: live ? 'live' : 'comment', comment: c });
    if (!res.ok) {
      log(`[tenant ${tenant.id}] claude fail: ${res.reason}`);
      if (res.retry) return releaseClaim(rowId);
      return finish({ action: 'skip', status: 'error' });
    }
    await quota.countAi(tenant.id);
    const d = res.data;
    const meta = { category: d.category, sentiment: d.sentiment, isLead: d.is_lead, interest: d.interest };

    if (d.action === 'forward_owner' || d.needs_owner) {
      await alertOwner(tenant, { reason: d.category, comment: c });
      if (d.action === 'forward_owner') return finish({ ...meta, action: 'forward_owner', status: 'forwarded' });
    }
    if (d.action === 'hide' && !live) {
      if (s.hideAbusive && s.postReplies && s.botEnabled && (await quota.canSpend(tenant.id, quota.COST.moderate))) {
        await holdForReview(auth, c.externalId);
        await quota.spend(tenant.id, quota.COST.moderate);
        return finish({ ...meta, action: 'hide', status: 'held' });
      }
    }
    if (d.action === 'skip' || !d.reply.trim()) return finish({ ...meta, action: 'skip', status: 'skipped' });

    // ---- 5. Reply sanitize (phone/email/key/fake link nahi) ----
    const clean = sanitizeReply(d.reply, s.profile, live ? 190 : 280);
    if (!clean.ok) {
      log(`[tenant ${tenant.id}] reply blocked: ${clean.reason}`);
      return finish({ ...meta, action: 'skip', status: `blocked: ${clean.reason}`.slice(0, 80) });
    }
    return await postOrDry({ tenant, auth, c, rowId, reply: clean.text, source, chatId, meta, finish });
  } catch (e) {
    log(`[tenant ${tenant.id}] handle error:`, e.message);
    await finishComment(rowId, { action: 'skip', status: 'error' }).catch(() => {});
  }
}

async function postOrDry({ tenant, auth, c, reply, source, chatId, meta, finish }) {
  const s = tenant.settings;
  const live = source === 'live';
  const live_ok = s.botEnabled && s.postReplies;
  if (!live_ok) return finish({ ...meta, reply, action: 'reply', status: 'dry_run' });

  const cost = live ? quota.COST.chatInsert : quota.COST.insert;
  if (!(await quota.canSpend(tenant.id, cost))) return finish({ ...meta, reply, action: 'reply', status: 'skipped_quota' });

  if (live) await sendChat(auth, chatId, reply);
  else await replyTo(auth, c.externalId, reply);
  await quota.spend(tenant.id, cost);
  return finish({ ...meta, reply, action: 'reply', status: 'posted' });
}
