// Saves/updates one row per customer in Google Sheets:
// Date | Name | Phone | City | Requirement | Budget | Status  (+ Last Updated | Chat Link)
// If Google Sheets is not set up, it writes data/leads.csv instead, so no lead is lost.
import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";
import { cfg } from "./config.js";

let sheetsApi = null;

function credentials() {
  if (cfg.sheets.b64) return JSON.parse(Buffer.from(cfg.sheets.b64, "base64").toString("utf8"));
  if (cfg.sheets.json) return JSON.parse(cfg.sheets.json);
  return null;
}

function api() {
  if (sheetsApi) return sheetsApi;
  const creds = credentials();
  if (!creds || !cfg.sheets.id) return null;
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  sheetsApi = google.sheets({ version: "v4", auth });
  return sheetsApi;
}

const today = () =>
  new Intl.DateTimeFormat("en-GB", { timeZone: cfg.business.timezone, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date());
const nowStr = () =>
  new Intl.DateTimeFormat("en-GB", { timeZone: cfg.business.timezone, dateStyle: "short", timeStyle: "short" }).format(new Date());

export const HEADERS = ["Date", "Name", "Phone", "City", "Requirement", "Budget", "Status", "Last Updated", "Chat Link"];

export async function upsertLead(c) {
  const p = c.profile;
  const row = [
    null, // Date: kept as is when updating
    p.name || c.waName || "",
    c.phone,
    p.city,
    p.requirement,
    p.budget,
    p.status,
    nowStr(),
    `https://wa.me/${c.phone}`,
  ];
  const s = api();
  if (!s) return csvFallback(c, row);

  const range = (r) => `${cfg.sheets.tab}!${r}`;
  const col = await s.spreadsheets.values.get({ spreadsheetId: cfg.sheets.id, range: range("C:C") });
  const phones = (col.data.values || []).map((r) => (r[0] || "").toString());
  const idx = phones.indexOf(c.phone);
  if (idx === -1) {
    row[0] = today();
    await s.spreadsheets.values.append({
      spreadsheetId: cfg.sheets.id,
      range: range("A:I"),
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
  } else {
    const n = idx + 1;
    await s.spreadsheets.values.update({
      spreadsheetId: cfg.sheets.id,
      range: range(`B${n}:I${n}`),
      valueInputOption: "RAW",
      requestBody: { values: [row.slice(1)] },
    });
  }
}

// One-time helper used by `scripts/setup-sheet.js`: creates the header row.
export async function ensureHeader() {
  const s = api();
  if (!s) throw new Error("Google Sheets not configured (check GOOGLE_SHEET_ID and service account)");
  await s.spreadsheets.values.update({
    spreadsheetId: cfg.sheets.id,
    range: `${cfg.sheets.tab}!A1:I1`,
    valueInputOption: "RAW",
    requestBody: { values: [HEADERS] },
  });
}

function csvFallback(c, row) {
  const file = path.join(cfg.dataDir, "leads.csv");
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  let lines = [];
  if (fs.existsSync(file)) lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  if (!lines.length) lines = [HEADERS.join(",")];
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const i = lines.findIndex((l, n) => n > 0 && l.split(",")[2] === q(c.phone));
  let date = today();
  if (i > 0) date = lines[i].split(",")[0].replace(/"/g, "");
  const out = [date, ...row.slice(1)].map(q).join(",");
  if (i > 0) lines[i] = out;
  else lines.push(out);
  fs.writeFileSync(file, lines.join("\n") + "\n");
}
