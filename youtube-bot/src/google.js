import { google } from 'googleapis';
import { cfg } from './config.js';
import { decrypt } from './crypto.js';
import { markDisconnected } from './db.js';

// Sirf itne scopes - kam scope = Google verification aasaan
export const SCOPES = [
  'https://www.googleapis.com/auth/youtube.force-ssl',   // comments padhna, reply, hide, live chat
  'https://www.googleapis.com/auth/drive.file',          // sirf wahi Sheet jo ye app banaye
  'https://www.googleapis.com/auth/userinfo.email',
  'openid'
];

export function oauth2() {
  return new google.auth.OAuth2(cfg.googleClientId, cfg.googleClientSecret, `${cfg.baseUrl}/auth/callback`);
}

export function authUrl(state) {
  return oauth2().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',           // har baar refresh_token mile
    include_granted_scopes: true,
    scope: SCOPES,
    state
  });
}

export function authForTenant(tenant) {
  const o = oauth2();
  o.setCredentials({ refresh_token: decrypt(tenant.refresh_token) });
  return o;
}

export const youtubeFor = (auth) => google.youtube({ version: 'v3', auth });
export const sheetsFor = (auth) => google.sheets({ version: 'v4', auth });

// Token revoke ho gaya (user ne access hata diya) => tenant ko disconnected mark karo
export async function handleAuthError(tenant, err) {
  const msg = JSON.stringify(err?.response?.data || err?.message || '');
  if (/invalid_grant|Token has been expired or revoked|unauthorized_client/i.test(msg)) {
    await markDisconnected(tenant.id);
    return true;
  }
  return false;
}
export const isQuotaError = (err) =>
  /quotaExceeded|rateLimitExceeded|dailyLimitExceeded/i.test(JSON.stringify(err?.response?.data || err?.message || ''));
