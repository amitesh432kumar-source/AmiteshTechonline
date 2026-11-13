// The manager: receives a customer message, decides what to do, replies, saves lead.
import { cfg } from "./config.js";
import * as store from "./store.js";
import * as wa from "./whatsapp.js";
import * as sheets from "./sheets.js";
import { createAI } from "./ai.js";

const { aiName } = cfg.business;
const GREETING_RE = /^(hi+|hello+|hey+|hlo+|helo|namaste|namaskar|hii+|good\s*(morning|afternoon|evening)|gm|ram ram|pranam|salaam|assalam.*|नमस्ते|हेलो|हाय|नमस्कार)[\s!.🙏]*$/i;
const HUMAN_RE = /(human|insaan|insan|real person|manager|owner se|malik se|malik|aadmi se|kisi se baat|baat karni hai.*(owner|malik)|customer care|call me|call kar|इंसान|मालिक|ओनर|ह्यूमन)/i;
const STOP_RE = /^(stop|unsubscribe|band karo|mat bhejo|not interested|no thanks|nahi chahiye|nhi chahiye)[\s!.]*$/i;

const fixed = {
  greeting: () =>
    `Namaste! 🙏 ${cfg.business.name} me aapka swagat hai. Aapko kya chahiye?\n1. Price List\n2. Book Karna Hai\n3. Baat Karni Hai`,
  connecting: "Connecting you to owner 🙏 Wo jaldi aapse baat karenge.",
  notInterested: "Koi baat nahi, kabhi bhi zaroorat ho to message kijiyega 🙏",
  nonText: "Maaf kijiye, main abhi sirf text message samajh pata hu. Kripya type karke bataiye 🙏",
  oops: "Maaf kijiye, thodi technical dikkat aa gayi. Main owner ko bata deta hu, wo aapse jaldi baat karenge 🙏",
  repeatFallbacks: [
    "Ji, aap thoda aur bataiye, main madad karta hu 🙏",
    "Samajh gaya. Aap ek baar apni baat dobara likh denge?",
  ],
};

let ai = null;
const getAI = () => (ai ??= createAI());
export const _setAI = (x) => (ai = x); // for tests

// ---------- sending helpers ----------
async function say(c, text) {
  if (!text) return;
  // safety net: never leak secrets even if the model slipped
  if (/sk-ant-|EAA[A-Za-z0-9]{20,}/.test(text)) text = fixed.repeatFallbacks[0];
  // never send the exact same message twice in a row
  if (text.trim() === store.lastBotMessage(c).trim()) {
    text = fixed.repeatFallbacks[c.messages.length % fixed.repeatFallbacks.length];
  }
  store.addMessage(c, "assistant", text);
  await wa.sendText(c.phone, text);
}

async function tellOwner(text) {
  if (!cfg.wa.owner) return;
  const r = await wa.sendText(cfg.wa.owner, text);
  // Outside WhatsApp's 24h window free text fails -> use approved template if you made one
  if (!r.ok && cfg.ownerAlertTemplate) await wa.sendTemplate(cfg.wa.owner, cfg.ownerAlertTemplate, [text.slice(0, 900)]);
}

function lastChat(c, n = 6) {
  return c.messages
    .slice(-n)
    .map((m) => `${m.role === "user" ? "Customer" : aiName}: ${m.content}`)
    .join("\n");
}

function leadCard(c) {
  const p = c.profile;
  return `Name: ${p.name || c.waName || "-"}\nPhone: +${c.phone}\nCity: ${p.city || "-"}\nRequirement: ${p.requirement || "-"}\nBudget: ${p.budget || "-"}\nChat: https://wa.me/${c.phone}`;
}

async function saveLeadRow(c) {
  try {
    await sheets.upsertLead(c);
  } catch (e) {
    console.error("Sheet save failed:", e.message);
  }
}

async function handoff(c, reason, summary = "") {
  c.humanMode = true;
  c.profile.status = "Follow-up Needed";
  store.save();
  await say(c, fixed.connecting);
  await tellOwner(
    `🚨 ${reason === "angry_or_complaint" ? "ANGRY/COMPLAINT" : "Customer wants to talk to you"}\n${summary ? summary + "\n" : ""}${leadCard(c)}\n\nLast messages:\n${lastChat(c)}\n\nBot is paused for this customer. To turn bot on again, send me: /resume ${c.phone}`
  );
  await saveLeadRow(c);
}

// ---------- tools Claude can call ----------
function makeHandlers(c) {
  return {
    async save_lead(i) {
      const p = c.profile;
      const prevStatus = p.status;
      for (const k of ["name", "city", "requirement", "budget"]) if (i[k]) p[k] = String(i[k]).slice(0, 200);
      if (i.status) p.status = i.status;
      store.save();
      await saveLeadRow(c);
      const booked = ["Booking Requested", "Order Requested"].includes(p.status);
      if (booked && (prevStatus !== p.status || i.booking_details)) {
        await tellOwner(`✅ ${p.status.toUpperCase()}\n${leadCard(c)}\nDetails: ${i.booking_details || "-"}\nPlease confirm with the customer.`);
      }
      return { result: "saved" };
    },
    async send_file({ which }) {
      const url = { catalog: cfg.files.catalog, price_list: cfg.files.priceList, payment_link: cfg.files.paymentLink }[which];
      if (!url) {
        await tellOwner(`📎 Customer ${c.phone} wants ${which}, but link is not set in .env. Please send manually.\n${leadCard(c)}`);
        return { result: "not available; tell customer owner will send it shortly" };
      }
      if (which === "payment_link") await wa.sendText(c.phone, `Payment link: ${url}`);
      else await wa.sendDocument(c.phone, url, which === "catalog" ? "Catalog.pdf" : "Price-List.pdf", cfg.business.name);
      store.addMessage(c, "assistant", `[sent ${which}]`);
      return { result: "sent" };
    },
    async ask_owner({ question }) {
      await tellOwner(`❓ Customer question needs your answer\n${question}\n\n${leadCard(c)}\nBot is still replying to this customer. Message them directly on WhatsApp with the answer.`);
      return { result: "owner notified" };
    },
    async connect_owner({ reason, summary }) {
      await handoff(c, reason, summary);
      return { ended: "owner", result: "connected" };
    },
    async stop_conversation() {
      c.notInterested = true;
      c.profile.status = "Not Interested";
      store.save();
      await say(c, fixed.notInterested);
      await saveLeadRow(c);
      return { ended: "stopped", result: "stopped" };
    },
  };
}

// ---------- owner commands (owner sends from OWNER_WHATSAPP) ----------
async function ownerCommand(text) {
  const m = text.trim().match(/^\/(resume|pause|status)\s*(\d+)?/i);
  if (!m) return false;
  const [, cmd, phone] = m;
  if (cmd.toLowerCase() === "status") {
    const all = store.allCustomers();
    await wa.sendText(cfg.wa.owner, `Customers: ${all.length}\nWith human (paused): ${all.filter((x) => x.humanMode).length}`);
    return true;
  }
  if (!phone) return wa.sendText(cfg.wa.owner, `Use: /${cmd} 919876543210`), true;
  const c = store.getCustomer(phone);
  c.humanMode = cmd.toLowerCase() === "pause";
  store.save();
  await wa.sendText(cfg.wa.owner, `Bot ${c.humanMode ? "paused" : "resumed"} for +${phone}`);
  return true;
}

// ---------- main entry ----------
const pending = new Map(); // phone -> [texts waiting]
const running = new Set();

export function enqueue(phone, msg) {
  if (!pending.has(phone)) pending.set(phone, []);
  pending.get(phone).push(msg);
  if (!running.has(phone)) {
    running.add(phone);
    drain(phone).finally(() => running.delete(phone));
  }
  return running; // handy for tests
}

export async function idle() {
  while (running.size) await new Promise((r) => setTimeout(r, 20));
}

async function drain(phone) {
  while (pending.get(phone)?.length) {
    const batch = pending.get(phone).splice(0); // customer sent several messages quickly -> answer once
    try {
      await handle(phone, batch);
    } catch (e) {
      console.error("handle error:", e);
      try {
        const c = store.getCustomer(phone);
        await say(c, fixed.oops);
        await tellOwner(`⚠️ Bot error with +${phone}: ${e.message}`);
      } catch {}
    }
  }
}

async function handle(phone, batch) {
  if (cfg.wa.owner && phone === cfg.wa.owner) {
    for (const m of batch) if (m.text && (await ownerCommand(m.text))) return;
  }
  const c = store.getCustomer(phone);
  if (batch[0].name && !c.waName) c.waName = batch[0].name;

  const textMsgs = batch.filter((m) => m.text);
  if (!textMsgs.length) {
    store.addMessage(c, "user", "[customer sent a non-text message]");
    return say(c, fixed.nonText);
  }
  const text = textMsgs.map((m) => m.text).join("\n");
  const wasEmpty = c.messages.length === 0;
  if (c.notInterested) {
    c.notInterested = false; // they wrote again, so they are back
    if (c.profile.status === "Not Interested") c.profile.status = "Interested";
  }
  store.addMessage(c, "user", text);

  if (c.humanMode) return; // owner is talking to this customer

  if (HUMAN_RE.test(text)) return handoff(c, "wants_human", `Customer said: "${text.slice(0, 200)}"`);
  if (STOP_RE.test(text.trim())) return makeHandlers(c).stop_conversation();
  if (GREETING_RE.test(text.trim()) && (wasEmpty || c.messages.length <= 2)) {
    if (wasEmpty) await saveLeadRow(c);
    return say(c, fixed.greeting());
  }

  const out = await getAI().respond(c, makeHandlers(c));
  if (out.refusal) {
    await tellOwner(`⚠️ AI could not answer +${phone}. Please check.\n${leadCard(c)}`);
    return handoff(c, "other", "AI declined to answer");
  }
  if (out.ended) return; // handlers already sent the message
  if (out.text) await say(c, out.text);
  else await say(c, fixed.repeatFallbacks[0]);
}

export const _internals = { fixed };
