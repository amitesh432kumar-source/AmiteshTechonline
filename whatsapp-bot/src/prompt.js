import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cfg } from "./config.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export function buildSystemPrompt() {
  const tpl = fs.readFileSync(path.join(root, "prompts/system_prompt.md"), "utf8");
  const knowledge = fs.readFileSync(path.join(root, "business-data/knowledge.md"), "utf8").replace(/<!--[\s\S]*?-->/g, "").trim();
  const b = cfg.business;
  const vars = {
    AI_NAME: b.aiName,
    BUSINESS_NAME: b.name,
    BUSINESS_TYPE: b.type,
    CITY: b.city,
    OWNER_NAME: b.owner,
    WORKING_TIME: b.workingTime,
    KNOWLEDGE: knowledge,
  };
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

// Short line placed in front of each customer message (keeps the big system prompt cacheable).
export function contextLine(c) {
  const now = new Intl.DateTimeFormat("en-IN", {
    timeZone: cfg.business.timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date());
  const p = c.profile;
  const saved = ["name", "city", "requirement", "budget"]
    .map((k) => `${k}=${p[k] || "unknown"}`)
    .join(", ");
  const nm = c.waName ? ` WhatsApp profile name: ${c.waName}.` : "";
  return `[Time now: ${now}. Shop hours: ${cfg.business.workingTime}.${nm} Saved info: ${saved}, status=${p.status}]`;
}
