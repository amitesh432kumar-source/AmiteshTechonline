# WhatsApp AI Assistant (Claude + WhatsApp Cloud API)

24x7 WhatsApp assistant for a small business. Speaks Hindi / Hinglish / English, answers from your own price list, collects leads into Google Sheets, books appointments, follows up, and hands angry customers to the owner.

**Start here:** `docs/1-SETUP.md`

| File | What it is |
|---|---|
| `docs/1-SETUP.md` | Step-by-step: WhatsApp Cloud API, Claude API, hosting |
| `docs/2-GOOGLE-SHEET.md` | Lead sheet structure and setup |
| `docs/3-SYSTEM-PROMPT.md` + `prompts/system_prompt.md` | The prompt that runs inside Claude |
| `docs/4-SAMPLE-CONVERSATIONS.md` | 20 example chats |
| `docs/5-TESTING-CHECKLIST.md` | Tick before going live |
| `business-data/knowledge.md` | **You edit this**: prices, timing, address, offers |
| `.env.example` | Settings and keys (copy to `.env`) |
| `src/server.js` | Webhook server (Express) |
| `src/bot.js` | Decides what to do with each message |
| `src/ai.js` | Talks to Claude, tools: save_lead, send_file, ask_owner, connect_owner, stop_conversation |
| `src/sheets.js`, `src/store.js`, `src/whatsapp.js`, `src/followup.js` | Sheet, memory, WhatsApp sender, follow-up |

Quick start: `cp .env.example .env` -> fill -> `npm install` -> edit `business-data/knowledge.md` -> `npm run chat` (test) -> `npm start`.
