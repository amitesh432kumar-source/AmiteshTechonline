// The "brain": talks to Claude, lets it call tools (save lead, send file, call owner...).
import Anthropic from "@anthropic-ai/sdk";
import { cfg } from "./config.js";
import { buildSystemPrompt, contextLine } from "./prompt.js";
import * as store from "./store.js";

export const TOOLS = [
  {
    name: "save_lead",
    description:
      "Save or update what you learned about this customer. Call it as soon as you learn a new detail (name, city, requirement, budget) or the status changes. Only include fields that are new or changed.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Customer's name" },
        city: { type: "string" },
        requirement: { type: "string", description: "What they want, in a few words" },
        budget: { type: "string", description: "Budget as the customer said it, e.g. '5000' or '2-3 lakh'" },
        status: {
          type: "string",
          enum: ["New", "Interested", "Booking Requested", "Order Requested", "Follow-up Needed", "Not Interested"],
        },
        booking_details: { type: "string", description: "For bookings/orders: item, date/time, address, anything the owner must know" },
      },
    },
  },
  {
    name: "send_file",
    description: "Send the catalog, price list PDF, or payment link to the customer on WhatsApp.",
    input_schema: {
      type: "object",
      properties: { which: { type: "string", enum: ["catalog", "price_list", "payment_link"] } },
      required: ["which"],
    },
  },
  {
    name: "ask_owner",
    description:
      "Ask the owner a question you cannot answer from BUSINESS INFORMATION (unknown price, stock, discount request). The chat continues with the bot; tell the customer you will confirm with the owner.",
    input_schema: {
      type: "object",
      properties: { question: { type: "string", description: "The exact question for the owner, with item names" } },
      required: ["question"],
    },
  },
  {
    name: "connect_owner",
    description:
      "Hand the chat to the human owner right now (customer asked for a human, is angry, or has a serious complaint). The bot stops replying after this.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string", enum: ["wants_human", "angry_or_complaint", "payment_issue", "other"] },
        summary: { type: "string", description: "One line: what the customer wants/complains about" },
      },
      required: ["reason"],
    },
  },
  {
    name: "stop_conversation",
    description: "Customer clearly said they are not interested. Ends the conversation politely.",
    input_schema: { type: "object", properties: {} },
  },
];

function buildParams(system, messages) {
  const p = {
    model: cfg.ai.model,
    max_tokens: 1024,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    tools: TOOLS,
    messages,
  };
  // Claude Sonnet 5.5: keep it fast (target < 2 sec). "between_tools" = no long thinking, low effort.
  if (cfg.ai.model.startsWith("claude-sonnet-5-5")) {
    p.thinking = { type: "between_tools" };
    p.output_config = { effort: "low" };
  }
  return p;
}

export function createAI(client = new Anthropic({ apiKey: cfg.ai.apiKey })) {
  let system = null;
  const getSystem = () => (system ??= buildSystemPrompt());

  /**
   * Runs one customer turn.
   * handlers = { save_lead, send_file, ask_owner, connect_owner, stop_conversation } (async functions)
   * Returns { text, ended }  - ended = "owner" | "stopped" | null
   */
  async function respond(customer, handlers) {
    const history = store.historyForAI(customer, cfg.ai.maxHistory);
    // add the small context line to the newest customer message
    const last = history[history.length - 1];
    const messages = history.slice(0, -1).concat({
      role: "user",
      content: `${contextLine(customer)}\n${last.content}`,
    });

    let text = "";
    for (let round = 0; round < 5; round++) {
      const res = await client.messages.create(buildParams(getSystem(), messages));

      if (res.stop_reason === "refusal") return { text: "", ended: "owner", refusal: true };

      const parts = res.content.filter((b) => b.type === "text").map((b) => b.text.trim()).filter(Boolean);
      if (parts.length) text = parts.join("\n");

      const calls = res.content.filter((b) => b.type === "tool_use");
      if (res.stop_reason !== "tool_use" || !calls.length) return { text, ended: null };

      messages.push({ role: "assistant", content: res.content });
      const results = [];
      let ended = null;
      for (const call of calls) {
        let out;
        try {
          out = await handlers[call.name](call.input || {});
        } catch (e) {
          console.error(`tool ${call.name} failed:`, e.message);
          out = { error: "failed, continue without it" };
        }
        if (out?.ended) ended = out.ended;
        results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(out?.result ?? out ?? "ok") });
      }
      if (ended) return { text: "", ended };
      messages.push({ role: "user", content: results });
    }
    return { text, ended: null };
  }

  return { respond };
}
