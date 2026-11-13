import pg from 'pg';
import { cfg, DEFAULT_SETTINGS } from './config.js';

let pool;
export function db() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: cfg.databaseUrl,
      max: 10,
      ssl: /localhost|127\.0\.0\.1/.test(cfg.databaseUrl || '') ? false : { rejectUnauthorized: false }
    });
  }
  return pool;
}
const q = (sql, params) => db().query(sql, params);

export async function migrate() {
  await q(`
    CREATE TABLE IF NOT EXISTS tenants (
      id            BIGSERIAL PRIMARY KEY,
      google_sub    TEXT UNIQUE NOT NULL,
      email         TEXT,
      channel_id    TEXT,
      channel_title TEXT,
      refresh_token TEXT,                       -- AES-256-GCM encrypted
      settings      JSONB NOT NULL DEFAULT '{}',
      sheet_id      TEXT,
      status        TEXT NOT NULL DEFAULT 'active',  -- active | disconnected
      last_poll_at  TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS comments (
      id           BIGSERIAL PRIMARY KEY,
      tenant_id    BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      source       TEXT NOT NULL DEFAULT 'comment',  -- comment | live
      external_id  TEXT NOT NULL,
      video_id     TEXT,
      video_title  TEXT,
      viewer_name  TEXT,
      viewer_channel TEXT,
      body         TEXT,
      reply        TEXT,
      action       TEXT,       -- reply | forward_owner | hide | skip | dry_run
      category     TEXT,
      sentiment    TEXT,
      is_lead      BOOLEAN DEFAULT FALSE,
      lead_interest TEXT,
      status       TEXT,       -- posted | dry_run | forwarded | held | skipped | error
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, source, external_id)
    );
    CREATE INDEX IF NOT EXISTS comments_tenant_time ON comments (tenant_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS usage (
      tenant_id  BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      day        TEXT NOT NULL,
      units      INT NOT NULL DEFAULT 0,
      ai_replies INT NOT NULL DEFAULT 0,
      PRIMARY KEY (tenant_id, day)
    );
  `);
}

const mergeSettings = (s = {}) => ({
  ...DEFAULT_SETTINGS,
  ...s,
  profile: { ...DEFAULT_SETTINGS.profile, ...(s.profile || {}), links: { ...DEFAULT_SETTINGS.profile.links, ...((s.profile || {}).links || {}) } }
});

const hydrate = (r) => r && { ...r, settings: mergeSettings(r.settings) };

export async function upsertTenant({ sub, email, channelId, channelTitle, refreshTokenEnc }) {
  const { rows } = await q(
    `INSERT INTO tenants (google_sub, email, channel_id, channel_title, refresh_token, settings)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (google_sub) DO UPDATE SET
       email=EXCLUDED.email, channel_id=EXCLUDED.channel_id, channel_title=EXCLUDED.channel_title,
       refresh_token=COALESCE(EXCLUDED.refresh_token, tenants.refresh_token), status='active'
     RETURNING *`,
    [sub, email, channelId, channelTitle, refreshTokenEnc, JSON.stringify({ ownerEmail: email, profile: { channelName: channelTitle } })]
  );
  return hydrate(rows[0]);
}
export async function countTenants() {
  return +(await q(`SELECT count(*) FROM tenants WHERE status='active'`)).rows[0].count;
}
export async function getTenant(id) {
  return hydrate((await q('SELECT * FROM tenants WHERE id=$1', [id])).rows[0]);
}
export async function listActiveTenants() {
  return (await q(`SELECT * FROM tenants WHERE status='active' AND refresh_token IS NOT NULL`)).rows.map(hydrate);
}
export async function saveSettings(id, settings) {
  await q('UPDATE tenants SET settings=$2 WHERE id=$1', [id, JSON.stringify(settings)]);
}
export async function setSheet(id, sheetId) {
  await q('UPDATE tenants SET sheet_id=$2 WHERE id=$1', [id, sheetId]);
}
export async function markDisconnected(id) {
  await q(`UPDATE tenants SET status='disconnected', refresh_token=NULL WHERE id=$1`, [id]);
}
export async function touchPoll(id) {
  await q('UPDATE tenants SET last_poll_at=now() WHERE id=$1', [id]);
}
// "Disconnect + delete my data" - YouTube API policy ke liye zaroori
export async function deleteTenant(id) {
  await q('DELETE FROM tenants WHERE id=$1', [id]);
}

export async function alreadyHandled(tenantId, source, externalId) {
  return (await q('SELECT 1 FROM comments WHERE tenant_id=$1 AND source=$2 AND external_id=$3', [tenantId, source, externalId])).rowCount > 0;
}
// UNIQUE constraint = ek comment pe 2 baar kabhi nahi (Rule 4). false => kisi aur ne pehle claim kar liya
export async function claim(tenantId, source, externalId, row) {
  const r = await q(
    `INSERT INTO comments (tenant_id, source, external_id, video_id, video_title, viewer_name, viewer_channel, body, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'processing') ON CONFLICT DO NOTHING RETURNING id`,
    [tenantId, source, externalId, row.videoId, row.videoTitle, row.viewerName, row.viewerChannel, row.body]
  );
  return r.rows[0]?.id || null;
}
export async function finishComment(id, f) {
  await q(
    `UPDATE comments SET reply=$2, action=$3, category=$4, sentiment=$5, is_lead=$6, lead_interest=$7, status=$8 WHERE id=$1`,
    [id, f.reply || null, f.action, f.category || null, f.sentiment || null, !!f.isLead, f.interest || null, f.status]
  );
}
export async function recentComments(tenantId, limit = 50) {
  return (await q('SELECT * FROM comments WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2', [tenantId, limit])).rows;
}
export async function commentsSince(tenantId, days = 7) {
  return (await q(`SELECT * FROM comments WHERE tenant_id=$1 AND created_at > now() - ($2 || ' days')::interval ORDER BY created_at`, [tenantId, String(days)])).rows;
}

// Quota din ka hisaab: YouTube quota Pacific Time midnight pe reset hota hai
export const quotaDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
export async function getUsage(tenantId) {
  const r = await q('SELECT units, ai_replies FROM usage WHERE tenant_id=$1 AND day=$2', [tenantId, quotaDay()]);
  return r.rows[0] || { units: 0, ai_replies: 0 };
}
export async function addUsage(tenantId, units = 0, aiReplies = 0) {
  await q(
    `INSERT INTO usage (tenant_id, day, units, ai_replies) VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id, day) DO UPDATE SET units=usage.units+$3, ai_replies=usage.ai_replies+$4`,
    [tenantId, quotaDay(), units, aiReplies]
  );
}
export async function projectUnitsToday() {
  return +((await q('SELECT COALESCE(SUM(units),0) s FROM usage WHERE day=$1', [quotaDay()])).rows[0].s);
}

// Temporary failure (Claude down) => claim wapas lo taaki agle poll me retry ho
export async function releaseClaim(id) {
  await q('DELETE FROM comments WHERE id=$1 AND status=$2', [id, 'processing']);
}
