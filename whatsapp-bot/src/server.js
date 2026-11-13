import express from "express";
import { cfg } from "./config.js";
import * as store from "./store.js";
import * as wa from "./whatsapp.js";
import { enqueue } from "./bot.js";
import { startFollowupTimer } from "./followup.js";

store.load();
const app = express();
app.use(express.json({ limit: "2mb", verify: (req, _res, buf) => (req.rawBody = buf) }));

app.get("/", (_req, res) => res.send(`${cfg.business.name} WhatsApp AI is running ✅`));

// Meta calls this once to check your webhook URL
app.get("/webhook", (req, res) => {
  const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = req.query;
  if (mode === "subscribe" && token && token === cfg.wa.verifyToken) return res.status(200).send(challenge);
  res.sendStatus(403);
});

const seen = new Set(); // WhatsApp sometimes delivers the same message twice
function firstSeen(id) {
  if (seen.has(id)) return false;
  seen.add(id);
  if (seen.size > 5000) seen.delete(seen.values().next().value);
  return true;
}

export function processWebhook(body) {
  if (body?.object !== "whatsapp_business_account") return;
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      const names = Object.fromEntries((v.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of v.messages ?? []) {
        if (!firstSeen(m.id)) continue;
        wa.markRead(m.id).catch(() => {});
        let text = null;
        if (m.type === "text") text = m.text?.body;
        else if (m.type === "button") text = m.button?.text;
        else if (m.type === "interactive") text = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title;
        enqueue(m.from, { text: text?.slice(0, 2000) ?? null, name: names[m.from] });
      }
    }
  }
}

app.post("/webhook", (req, res) => {
  if (!wa.validSignature(req.rawBody, req.get("x-hub-signature-256"))) return res.sendStatus(401);
  res.sendStatus(200); // answer Meta immediately, work in background
  try {
    processWebhook(req.body);
  } catch (e) {
    console.error("webhook error:", e);
  }
});

app.listen(cfg.port, () => {
  console.log(`✅ ${cfg.business.name} bot listening on port ${cfg.port}`);
  if (!cfg.wa.appSecret) console.warn("⚠️  WHATSAPP_APP_SECRET not set: webhook signatures are NOT checked.");
  if (!cfg.ai.apiKey) console.warn("⚠️  ANTHROPIC_API_KEY missing.");
  startFollowupTimer();
});

for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => (store.flush(), process.exit(0)));
