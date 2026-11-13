// Test the bot in your terminal with the REAL Claude, without WhatsApp:  npm run chat
import readline from "node:readline";
process.env.WA_DRY_RUN = "1";
process.env.DATA_DIR ||= "./data-chat-test";
process.env.OWNER_WHATSAPP ||= "910000000000";
const { enqueue, idle } = await import("../src/bot.js");
const store = await import("../src/store.js");
store.load();
const phone = process.argv[2] || "919999900001";
console.log(`Chatting as customer +${phone}. Type messages. Ctrl+C to exit. (Bot replies appear as [WA DRY-RUN])\n`);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  enqueue(phone, { text: line, name: "Test Customer" });
  await idle();
  store.flush();
});
