import crypto from "node:crypto";
import { cfg } from "./config.js";

const base = () => `https://graph.facebook.com/${cfg.wa.graphVersion}/${cfg.wa.phoneId}`;

async function call(path, body) {
  if (cfg.wa.dryRun) {
    console.log(`\n[WA DRY-RUN -> ${body.to ?? "?"}]`, JSON.stringify(body.text?.body ?? body.template?.name ?? body.document?.link ?? body));
    return { ok: true };
  }
  const res = await fetch(`${base()}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.wa.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`WhatsApp API error ${res.status}:`, err);
    return { ok: false, status: res.status, error: err };
  }
  return { ok: true, data: await res.json() };
}

export const sendText = (to, text) =>
  call("messages", { to, type: "text", text: { body: text, preview_url: true } });

export const sendTemplate = (to, name, params = [], lang = "en") =>
  call("messages", {
    to,
    type: "template",
    template: {
      name,
      language: { code: lang },
      components: params.length
        ? [{ type: "body", parameters: params.map((p) => ({ type: "text", text: String(p).slice(0, 500) })) }]
        : [],
    },
  });

export const sendDocument = (to, link, filename, caption) =>
  call("messages", { to, type: "document", document: { link, filename, caption } });

export const markRead = (messageId) =>
  cfg.wa.dryRun ? Promise.resolve() : call("messages", { status: "read", message_id: messageId });

// Meta signs every webhook with your App Secret. Reject anything not signed.
export function validSignature(rawBody, header) {
  if (!cfg.wa.appSecret) return true; // not configured: skip (not recommended in production)
  if (!header || !rawBody) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", cfg.wa.appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
