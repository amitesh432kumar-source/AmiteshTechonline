// Simple JSON-file storage: remembers the full chat of every customer.
// For a bigger business, swap this file for MongoDB (same function names).
import fs from "node:fs";
import path from "node:path";
import { cfg } from "./config.js";

const FILE = path.join(cfg.dataDir, "customers.json");
let customers = {};
let saveTimer = null;

export function load() {
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  try {
    customers = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    customers = {};
  }
}

function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const tmp = FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(customers));
    fs.renameSync(tmp, FILE); // atomic, file never half-written
  }, 300);
}

export function flush() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(customers));
}

export function getCustomer(phone) {
  if (!customers[phone]) {
    customers[phone] = {
      phone,
      waName: "",
      profile: { name: "", city: "", requirement: "", budget: "", status: "New" },
      messages: [], // {role: "user"|"assistant", content, ts}
      humanMode: false,
      notInterested: false,
      followupSent: false,
      createdAt: Date.now(),
      lastCustomerAt: 0,
    };
  }
  return customers[phone];
}

export function allCustomers() {
  return Object.values(customers);
}

export function addMessage(c, role, content) {
  c.messages.push({ role, content, ts: Date.now() });
  if (role === "user") {
    c.lastCustomerAt = Date.now();
    c.followupSent = false;
  }
  persist();
}

export function save() {
  persist();
}

// Messages in the shape Claude needs. Always starts with a "user" turn and
// alternates roles (consecutive same-role messages are merged).
export function historyForAI(c, limit) {
  const out = [];
  for (const m of c.messages.slice(-limit)) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += "\n" + m.content;
    else out.push({ role: m.role, content: m.content });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

export function lastBotMessage(c) {
  for (let i = c.messages.length - 1; i >= 0; i--) {
    if (c.messages[i].role === "assistant") return c.messages[i].content;
  }
  return "";
}
