import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wabot-"));
Object.assign(process.env, {
  DATA_DIR: dir, WA_DRY_RUN: "1", OWNER_WHATSAPP: "910000000000", BUSINESS_NAME: "Test Shop",
  WHATSAPP_APP_SECRET: "shh", GOOGLE_SHEET_ID: "", GOOGLE_SERVICE_ACCOUNT_JSON: "", GOOGLE_SERVICE_ACCOUNT_B64: "",
});

// capture everything the bot "sends"
const sent = [];
const origLog = console.log;
console.log = (...a) => { const s = a.join(" "); if (s.includes("[WA DRY-RUN")) sent.push(s); else origLog(...a); };

const store = await import("../src/store.js");
const bot = await import("../src/bot.js");
const { createAI } = await import("../src/ai.js");
const { validSignature } = await import("../src/whatsapp.js");
const { runFollowups } = await import("../src/followup.js");
store.load();

const run = async (phone, text) => { sent.length = 0; bot.enqueue(phone, { text, name: "Ramesh" }); await bot.idle(); return sent.join("\n"); };

// fake Claude: scripted responses
function fake(script) {
  const calls = [];
  const client = { messages: { create: async (p) => { calls.push(structuredClone(p)); return script.shift(); } } };
  return { client, calls };
}

test("first 'Hi' gets fixed greeting menu without calling Claude", async () => {
  const f = fake([]); bot._setAI(createAI(f.client));
  const out = await run("911", "Hi");
  assert.match(out, /Namaste! 🙏 Test Shop me aapka swagat hai/);
  assert.match(out, /1\. Price List\\n2\. Book Karna Hai\\n3\. Baat Karni Hai/); // newlines are JSON-escaped in dry-run log
  assert.equal(f.calls.length, 0);
});

test("'human se baat karni hai' goes straight to owner, bot pauses", async () => {
  const f = fake([]); bot._setAI(createAI(f.client));
  const out = await run("912", "Mujhe human se baat karni hai");
  assert.match(out, /Connecting you to owner/);
  assert.match(out, /-> 910000000000/); // owner alerted
  assert.equal(store.getCustomer("912").humanMode, true);
  assert.equal(f.calls.length, 0);
  const again = await run("912", "hello?");
  assert.equal(again, ""); // bot silent while human mode
});

test("tool loop: Claude saves lead then replies; lead lands in CSV; history sent to Claude", async () => {
  const f = fake([
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "save_lead", input: { name: "Ramesh", requirement: "wedding sherwani" } }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Ramesh ji, aap kis city se hain?" }] },
  ]);
  bot._setAI(createAI(f.client));
  await run("913", "Hi"); // greeting
  const out = await run("913", "Mera naam Ramesh hai, wedding ke liye sherwani chahiye");
  assert.match(out, /Ramesh ji, aap kis city se hain\?/);
  const c = store.getCustomer("913");
  assert.equal(c.profile.name, "Ramesh");
  const csv = fs.readFileSync(path.join(dir, "leads.csv"), "utf8");
  assert.match(csv, /Date,Name,Phone,City,Requirement,Budget,Status/);
  assert.match(csv, /"Ramesh","913",.*"wedding sherwani"/);
  // second call carried the tool_result back
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].messages.at(-1).content[0].type, "tool_result");
  assert.match(f.calls[0].messages.at(-1).content, /^\[Time now:/); // context line
  assert.ok(f.calls[0].system[0].text.includes("Test Shop"));
});

test("same reply is never sent twice in a row", async () => {
  const same = () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "Ji bataiye." }] });
  bot._setAI(createAI(fake([same(), same()]).client));
  await run("914", "Hi");
  const a = await run("914", "price?");
  const b = await run("914", "price kya hai?");
  assert.match(a, /Ji bataiye\./);
  assert.doesNotMatch(b, /^\[WA DRY-RUN -> 914\] "Ji bataiye\."$/);
});

test("not interested -> polite stop message", async () => {
  bot._setAI(createAI(fake([]).client));
  await run("915", "Hi");
  const out = await run("915", "not interested");
  assert.match(out, /Koi baat nahi, kabhi bhi zaroorat ho to message kijiyega/);
  assert.equal(store.getCustomer("915").profile.status, "Not Interested");
});

test("owner can /resume a customer", async () => {
  await run("910000000000", "/resume 912");
  assert.equal(store.getCustomer("912").humanMode, false);
});

test("webhook signature check", async () => {
  const crypto = await import("node:crypto");
  const body = Buffer.from('{"a":1}');
  const good = "sha256=" + crypto.createHmac("sha256", "shh").update(body).digest("hex");
  assert.equal(validSignature(body, good), true);
  assert.equal(validSignature(body, "sha256=bad"), false);
  assert.equal(validSignature(body, undefined), false);
});

test("follow-up goes out once, ~22h after customer went silent", async () => {
  const c = store.getCustomer("916");
  c.messages = [{ role: "user", content: "price?", ts: 1 }, { role: "assistant", content: "Rs 500 ji", ts: 2 }];
  c.lastCustomerAt = Date.now() - 22.5 * 3600 * 1000;
  // pick a time of day that is not "quiet hours" regardless of when tests run
  const realNow = Date.now;
  const noon = new Date(); noon.setUTCHours(6, 30, 0, 0); // 12:00 IST
  const shift = noon.getTime() - realNow();
  c.lastCustomerAt = noon.getTime() - 22.5 * 3600 * 1000;
  const n1 = await runFollowups(noon.getTime());
  const n2 = await runFollowups(noon.getTime());
  assert.equal(n1, 1); assert.equal(n2, 0);
  void shift;
});
