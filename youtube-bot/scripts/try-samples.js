// 20 sample comments ko asli pipeline (filters + Claude) se guzaar ke dekho.
// Chalao:  ANTHROPIC_API_KEY=... node scripts/try-samples.js
import fs from 'node:fs';
import { DEFAULT_SETTINGS } from '../src/config.js';
import { detectForward, detectBlocked, sanitizeReply } from '../src/filters.js';
import { decide } from '../src/claude.js';

const samples = JSON.parse(fs.readFileSync(new URL('../docs/samples.json', import.meta.url)));
const S = {
  ...DEFAULT_SETTINGS,
  profile: {
    ...DEFAULT_SETTINGS.profile,
    channelName: 'Demo Channel', aiName: 'Team Demo', ownerName: 'Demo', topic: 'Tech', audience: 'India 18-35',
    links: { ...DEFAULT_SETTINGS.profile.links, description: '', course: '' },
    priceInfo: ''
  }
};
let ok = 0;
for (const s of samples) {
  let got;
  if (detectForward(s.comment, S)) got = { action: 'forward_owner', reply: '' };
  else if (detectBlocked(s.comment, S)) got = { action: 'hide', reply: 'Aapki baat samajh gaya bhai, dhyan rakhenge 🙏' };
  else {
    const r = await decide({ profile: S.profile, comment: { videoTitle: 'Demo', viewerName: 'Viewer', body: s.comment } });
    if (!r.ok) { console.log(`#${s.n} ERROR ${r.reason}`); continue; }
    const c = r.data.reply ? sanitizeReply(r.data.reply, S.profile) : { ok: true, text: '' };
    got = { action: r.data.action, reply: c.ok ? c.text : `[BLOCKED ${c.reason}]` };
  }
  const match = got.action === s.action;
  if (match) ok++;
  console.log(`#${s.n} [${s.type}] ${match ? '✅' : '⚠️ '} expected=${s.action} got=${got.action}\n   C: ${s.comment}\n   R: ${got.reply}`);
}
console.log(`\n${ok}/${samples.length} action match`);
