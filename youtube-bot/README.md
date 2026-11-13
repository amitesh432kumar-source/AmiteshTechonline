# YouTube AI Assistant (multi-creator) — Claude se chalne wala

Koi bhi YouTuber **Google se login** karke apna channel connect karta hai, dashboard me apna style/price/links bharta hai, aur AI uske channel ke comments + live chat 24x7 handle karta hai. Meta AI jaisa, lekin YouTube ke liye.

```
Viewer comment ──► YouTube API ──► Worker (har ~90 sec, har creator ke liye)
                                      │ 1. Pehle se handle? (DB UNIQUE) ─► haan: skip   [Rule: 2 baar reply nahi]
                                      │ 2. collab/number/promotion? ─► owner ko email/webhook  [AI reply nahi]
                                      │ 3. gali word? ─► hold for review / shant reply
                                      │ 4. Claude (creator ka apna system prompt) ─► JSON decision
                                      │ 5. Reply sanitize (phone/email/key/fake link block)
                                      ▼
                   YouTube pe reply  +  DB  +  creator ki apni Google Sheet
```

**Stack:** Node.js 20+ · Express · Postgres · Claude (`claude-sonnet-5-5`) · YouTube Data API v3 (comments + live chat) · Google Sheets.

> ⚠️ **Model note:** aapne "Sonnet 4" likha tha; abhi latest Sonnet `claude-sonnet-5-5` hai (sasta + tez), wahi default hai. `.env` me `CLAUDE_MODEL` se badal sakte ho.

---

## 1. Setup — step by step

### A. Google Cloud (ek baar, platform owner ke liye)
1. https://console.cloud.google.com → naya project.
2. **APIs & Services → Library**: enable karo **YouTube Data API v3** aur **Google Sheets API**.
3. **OAuth consent screen**: External → app name, support email, **Privacy Policy URL** (`https://TUMHARA-DOMAIN/privacy`), authorized domain.
   Scopes add karo: `youtube.force-ssl`, `drive.file`, `userinfo.email`, `openid`.
4. **Credentials → Create → OAuth client ID → Web application**.
   Authorized redirect URI: `https://TUMHARA-DOMAIN/auth/callback` (local test: `http://localhost:3000/auth/callback`).
   Client ID + Secret ko `.env` me daalo.
5. ⚠️ **Publishing status “Testing” me refresh token 7 din me expire hota hai aur sirf 100 test users.** Real use ke liye **“In production”** karo.
   `youtube.force-ssl` *sensitive scope* hai → Google **OAuth verification** maangta hai (demo video + privacy policy + domain). Verification ke bina users ko “unverified app” warning dikhti hai aur ~100 users ki limit rehti hai. Isliye `MAX_TENANTS` rakha hai.
6. **YouTube quota (sabse important):** default **10,000 units/din — poore project ke liye, sab creators ke beech shared.**
   Ek reply post = 50 units ⇒ pure platform pe ~180 replies/din. Zyada users ke liye Google ka **YouTube API Services – Audit and Quota Extension** form bharna padta hai.
   Code me fair-share budget (`src/quota.js`) hai: har creator ko `0.9 × quota ÷ creators` units milte hain, project 90% bharte hi sab ruk jaate hain.

### B. Claude API key
https://console.anthropic.com → API key → `.env` me `ANTHROPIC_API_KEY`. Kharcha platform ka hota hai, isliye `TENANT_MAX_AI_REPLIES_PER_DAY` se har creator pe limit hai.

### C. Database
Koi bhi Postgres (Supabase / Render / Railway). `DATABASE_URL` daalo. Tables server start pe khud ban jaate hain.

### D. Chalao
```bash
cd youtube-bot
cp .env.example .env     # sab values bharo
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # ENCRYPTION_KEY ke liye
npm install
npm test                 # filters/prompt/crypto tests
npm run try              # 20 sample comments asli Claude se (ANTHROPIC_API_KEY chahiye)
npm start                # http://localhost:3000
```

### E. Hosting (Render / Railway)
- **Always-on** service chahiye (worker background me poll karta hai). Render ka *free web service so jaata hai* ⇒ worker ruk jaata hai; paid instance ya Railway use karo.
- Build: `npm install` · Start: `npm start` · `BASE_URL=https://tumhara-domain` · HTTPS zaroori (Secure cookie).
- Sirf **1 instance** chalao (2 instance = duplicate polling; DB UNIQUE se double reply to nahi hoga, par quota waste hoga).

### Creator ka flow
1. Site kholo → **Google se login** → channel connect (apni Sheet auto-ban jaati hai, creator ki Drive me).
2. Dashboard me profile, verified info (price/links/FAQs), forward words bharo.
3. **“Try it”** me test comments → reply padho.
4. Pehle **DRY RUN** (Bot ON, “post” OFF) — recent comments table me dekho AI kya reply karta.
5. Khush ho to **“Replies post karo”** ON → LIVE.

---

## 2. Code kahan hai
| File | Kaam |
|---|---|
| `src/server.js` | Login, dashboard API, Try-it, account delete |
| `src/worker.js` | Har creator ke liye comments + live chat polling, weekly cron |
| `src/processor.js` | Ek message ka pipeline (rules → Claude → sanitize → post → Sheet) |
| `src/prompt.js` | **System prompt** (creator ke profile se banta hai) + JSON schema |
| `src/claude.js` | Claude call (structured output, refusal/fallback handling) |
| `src/filters.js` | Forward/gali detection + reply sanitizer |
| `src/youtubeApi.js` | YouTube Data + Live Chat API |
| `src/sheets.js` | Sheet banana + rows likhna |
| `src/quota.js` | Fair-share quota + AI reply cap |
| `src/report.js` | Weekly Hinglish report |
| `src/db.js`, `crypto.js`, `google.js`, `notify.js` | DB, encryption, OAuth, email/webhook |

Aur docs: [`docs/PROMPT.md`](docs/PROMPT.md) (system prompt), [`docs/SHEET.md`](docs/SHEET.md) (Sheet structure), [`docs/SAMPLES.md`](docs/SAMPLES.md) (20 samples), [`docs/CHECKLIST.md`](docs/CHECKLIST.md) (live se pehle testing).

## 3. Aapke 6 rules code me kahan lagte hain
| Rule | Kaise |
|---|---|
| Jhooti price/link nahi | Prompt me sirf “VERIFIED INFO”; price khali ⇒ “price kabhi mat batao”; `sanitizeReply` har URL ko creator ki list se match karta hai |
| Gali pe jhagda nahi | `blockedWords` ⇒ AI ko bulaye bina shant reply ya hold-for-review |
| Phone/email/key nahi | Prompt rule + `sanitizeReply` regex (phone, email, `sk-ant-…`, `AIza…`) — mile to reply drop |
| Ek comment pe 2 baar nahi | DB `UNIQUE(tenant, source, external_id)` + `ownerReplied` check + self-comment skip |
| Political/religious neutral | Prompt rule #4 |
| Collab/Paid/Number ⇒ forward | Code ka hard rule (Claude se pehle): email + webhook + Sheet `Owner_Inbox` |

## 4. Privacy / Policy (public service ke liye zaroori)
- Refresh tokens **AES-256-GCM** se encrypted. Comment text Claude ko jaata hai (Anthropic API data ko default me training ke liye use nahi karta — apni policy check kar lena).
- Dashboard me **Disconnect & delete**: token revoke + DB se saara data delete.
- `public/privacy.html` aur `terms.html` **templates** hain — apna naam/contact bharo, zarurat ho to vakil se check karao.
- YouTube API Services Terms ka paalan karna aapki zimmedari hai (jaise stored API data ko fresh rakhna, users ko control dena).

## 5. Limits jo aapko pata honi chahiye
- Is code ko maine **asli YouTube/Claude/Google accounts ke saath chala ke test nahi kiya** (yaha credentials nahi the). Tested: filters, prompt, encryption, session cookie, DB logic (in-memory Postgres). Pehli baar **DRY RUN me hi** chalao aur `docs/CHECKLIST.md` follow karo.
- Live chat par **WhatsApp seedha nahi**: WhatsApp Cloud API me bina template ke owner ko message bhejna possible nahi (24-hr window). Isliye email default hai, aur **Webhook URL** (Zapier/Make) se WhatsApp/Telegram jod sakte ho.
- Comment replies me 2-minute ka matlab: poll har ~90 sec. Live chat me poll min 15 sec (quota bachane ke liye).
