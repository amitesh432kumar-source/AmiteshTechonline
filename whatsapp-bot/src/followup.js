// Follow-up: if a customer stops replying, send ONE gentle reminder.
// WhatsApp rule: free-text is allowed only within 24h of the customer's last message.
// So we send at ~22h (inside the window). After 24h only an approved TEMPLATE can be sent.
import { cfg } from "./config.js";
import * as store from "./store.js";
import * as wa from "./whatsapp.js";

const HOUR = 3600 * 1000;
const DONE = new Set(["Booking Requested", "Order Requested", "Not Interested"]);

function inQuietHours(now) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: cfg.business.timezone, hour: "2-digit", hour12: false }).format(new Date(now)));
  return h < 8 || h >= 21; // do not disturb at night
}

export async function runFollowups(now = Date.now()) {
  let sent = 0;
  for (const c of store.allCustomers()) {
    if (c.followupSent || c.humanMode || c.notInterested || DONE.has(c.profile.status)) continue;
    if (c.phone === cfg.wa.owner || !c.lastCustomerAt) continue;
    if (c.messages.length < 2) continue;
    if (c.messages[c.messages.length - 1].role !== "assistant") continue; // customer is waiting for us, not the reverse
    const hrs = (now - c.lastCustomerAt) / HOUR;
    if (hrs < cfg.followup.afterHours || hrs > 47) continue;
    if (inQuietHours(now)) continue;

    const name = (c.profile.name || "").split(" ")[0];
    const topic = c.profile.requirement ? ` ${c.profile.requirement} ke baare me` : "";
    const text = `Namaste${name ? " " + name + " ji" : ""} 🙏${topic ? " Aapne" + topic + " puchha tha." : ""} Kya aapko aur kuch jaanna hai? Main madad ke liye hu 😊`;

    let r;
    if (hrs < 23.5) r = await wa.sendText(c.phone, text);
    else if (cfg.followup.templateName) r = await wa.sendTemplate(c.phone, cfg.followup.templateName, [name || "ji"], "en");
    else continue; // window closed and no template configured
    c.followupSent = true;
    if (r?.ok) {
      store.addMessage(c, "assistant", text);
      c.followupSent = true;
      if (c.profile.status !== "Booking Requested") c.profile.status = "Follow-up Needed";
      sent++;
    }
    store.save();
  }
  return sent;
}

export function startFollowupTimer() {
  setInterval(() => runFollowups().catch((e) => console.error("followup error:", e.message)), 10 * 60 * 1000);
}
