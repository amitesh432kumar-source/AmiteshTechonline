import { listActiveTenants, commentsSince } from './db.js';
import { authForTenant } from './google.js';
import { myChannel, recentUploadsWithStats } from './youtubeApi.js';
import { writeText } from './claude.js';
import { email } from './notify.js';
import { appendRow } from './sheets.js';
import { log } from './config.js';

function aggregate(rows) {
  const by = (k) => rows.reduce((m, r) => ((m[r[k] || 'unknown'] = (m[r[k] || 'unknown'] || 0) + 1), m), {});
  const perVideo = {};
  for (const r of rows) {
    const v = (perVideo[r.video_title || 'unknown'] ||= { comments: 0, leads: 0, negative: 0 });
    v.comments++; if (r.is_lead) v.leads++; if (r.sentiment === 'negative') v.negative++;
  }
  const topQuestions = rows.filter((r) => ['question', 'price', 'link'].includes(r.category)).slice(-40).map((r) => r.body.slice(0, 160));
  return {
    totalMessages: rows.length,
    byCategory: by('category'),
    bySentiment: by('sentiment'),
    byStatus: by('status'),
    leads: rows.filter((r) => r.is_lead).length,
    forwardedToOwner: rows.filter((r) => r.action === 'forward_owner').length,
    perVideo,
    topQuestions,
    leadInterests: rows.filter((r) => r.lead_interest).slice(-30).map((r) => r.lead_interest)
  };
}

export async function buildReport(tenant) {
  const rows = await commentsSince(tenant.id, 7);
  let videos = [];
  try {
    const auth = authForTenant(tenant);
    const ch = await myChannel(auth);
    videos = await recentUploadsWithStats(auth, ch.uploads, 7);
  } catch (e) { log(`[tenant ${tenant.id}] report: video stats nahi mile:`, e.message); }

  const data = { channel: tenant.settings.profile.channelName || tenant.channel_title, comments: aggregate(rows), videos };
  const system =
    'Tum ek YouTube growth analyst ho. Creator ko simple Hinglish me weekly report likho (friendly, seedha, bina bhari words ke). ' +
    'Sirf diye gaye data se baat karo; koi number invent mat karo. Sections: 1) Is hafte ka best video (views/likes/comments ke hisaab se) ' +
    '2) Log kya puch rahe hain (top sawal/themes) 3) Leads aur collab requests 4) Negative feedback ka pattern 5) Agle hafte kya improve karein (3-5 concrete suggestions: topics, title/thumbnail, pinned comment, description link). ' +
    'Agar data kam hai to saaf bolo.';
  return writeText({ system, user: JSON.stringify(data, null, 1) });
}

export async function sendReportFor(tenant) {
  const text = await buildReport(tenant);
  const week = new Date().toISOString().slice(0, 10);
  await appendRow(tenant, 'Weekly_Reports', [week, text]);
  await email(tenant.settings.ownerEmail || tenant.email, `Weekly Report - ${tenant.settings.profile.channelName || tenant.channel_title}`, text);
  return text;
}

export async function sendWeeklyReports() {
  for (const t of await listActiveTenants()) {
    if (!t.settings.weeklyReport) continue;
    try { await sendReportFor(t); log(`[tenant ${t.id}] weekly report bheja`); }
    catch (e) { log(`[tenant ${t.id}] report fail:`, e.message); }
  }
}
