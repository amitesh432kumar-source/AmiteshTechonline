# Step-by-step Setup (simple language)

Total time: about 1 to 2 hours. You need: a Facebook account, a phone number for the bot, a credit/debit card (for Claude API), a Google account.

> Meta changes its screens often. If a button name is slightly different, look for the nearest match. The official guide is at developers.facebook.com/docs/whatsapp/cloud-api/get-started

---

## PART A. WhatsApp Cloud API

### A1. Important about your phone number
A number that is registered on WhatsApp Cloud API **cannot be used at the same time in the normal WhatsApp / WhatsApp Business phone app** (Meta has a newer "coexistence" option for some accounts, check Meta's docs). Best way: **buy a new SIM** for the bot, or use a number you can move away from the app. For testing, Meta gives a free test number, so you can start without any SIM.

### A2. Create the Meta app
1. Go to **developers.facebook.com** and log in. Click **Get Started** and finish the developer sign-up.
2. Click **My Apps -> Create App**. Choose use case **"Other"** (or "Connect with customers through WhatsApp"), app type **Business**. Give it a name.
3. In the app dashboard, find **WhatsApp** and click **Set up**. Create or choose a **Meta Business Account** when asked.
4. Open **WhatsApp -> API Setup**. You will see:
   - a **Test phone number** (free) and its **Phone number ID**  -> put in `.env` as `WHATSAPP_PHONE_NUMBER_ID`
   - a **Temporary access token** (valid 24 hours, only for first test)
   - a box "Send to": add your own WhatsApp number and verify it with the code.
5. Click **Send message** (hello_world template) to confirm WhatsApp is receiving messages on your phone.

### A3. Get the App Secret
App dashboard -> **App settings -> Basic -> App secret -> Show**. Put it in `.env` as `WHATSAPP_APP_SECRET`. (The bot uses it to reject fake messages.)

### A4. Get a PERMANENT access token (do this before going live)
The 24-hour token will stop working. To make a permanent one:
1. Go to **business.facebook.com -> Business settings -> Users -> System users -> Add**. Name: `whatsapp-bot`, role **Admin**.
2. Click **Add assets** -> choose your app -> give **Full control**. Also add your WhatsApp account asset.
3. Click **Generate new token** -> select your app -> tick **whatsapp_business_messaging** and **whatsapp_business_management** -> choose **Never** expiry -> copy the token.
4. Put it in `.env` as `WHATSAPP_TOKEN`.

### A5. Webhook (connect WhatsApp to your server) -- do this AFTER Part D (hosting) because Meta needs your public URL
1. **WhatsApp -> Configuration -> Webhook -> Edit**.
2. **Callback URL**: `https://YOUR-APP.onrender.com/webhook`
3. **Verify token**: the same secret word you wrote as `WHATSAPP_VERIFY_TOKEN` in `.env`.
4. Click **Verify and save**. (Your server must be running, or it will fail.)
5. Under **Webhook fields**, click **Manage** and **Subscribe** to **messages**.

### A6. Go live with your real number
1. **WhatsApp -> API Setup -> Add phone number**. Enter your business name, number, verify by SMS/call.
2. Your **display name** is reviewed by Meta (a day or less usually).
3. Add a payment method (WhatsApp -> Billing). Customer-started chats within 24 hours are free-form; Meta charges for business-started template messages (prices change, check Meta's pricing page).
4. Change `WHATSAPP_PHONE_NUMBER_ID` in `.env` to the new number's ID.
5. Optional but recommended: complete **Business verification** (Business settings -> Security center) for higher sending limits.

### A7. Message templates (needed for 2 things only)
WhatsApp allows free-text only for 24 hours after the customer's last message. Outside that, you need an approved **template**.
- `OWNER_ALERT_TEMPLATE_NAME`: used to alert YOU if you haven't messaged the bot number in 24 hours. Create in **WhatsApp -> Message templates -> Create**: category *Utility*, language English, body: `Alert from your shop bot: {{1}}`. After approval, put its name in `.env`.
- `FOLLOWUP_TEMPLATE_NAME` (optional): for follow-ups after 24 hours. The bot normally follows up at about 22 hours, inside the free window, so you can skip this at the start.

**Tip:** Every morning send "hi" to the bot number from the owner phone. That keeps the owner window open and alerts arrive as normal messages.

---

## PART B. Claude API (the brain)

1. Go to **console.anthropic.com**, sign up.
2. **Billing**: add a card and a small credit (for example $10 to start).
3. **API Keys -> Create Key**. Copy it (starts with `sk-ant-`). Put it in `.env` as `ANTHROPIC_API_KEY`. Never share it or put it on GitHub.
4. Model: `.env` has `CLAUDE_MODEL=claude-sonnet-5-5` (the newest Sonnet, fast and cheap). You asked for "Sonnet 4": it is older, so I defaulted to the newer Sonnet. You can change the model name in `.env` any time.
5. Cost idea: one customer reply is a few thousand input tokens (the system prompt is cached, so repeats are cheaper) and about 50 output tokens. Roughly a fraction of a rupee to a rupee per reply. Check **console -> Usage** after the first day.

---

## PART C. Google Sheet for leads (5 minutes)

See `docs/2-GOOGLE-SHEET.md`. Short version:
1. Create a sheet, rename the tab to **Leads**.
2. Google Cloud Console -> create project -> enable **Google Sheets API** -> **Service account** -> create a **JSON key**.
3. Share the sheet with the service account email (Editor).
4. Put the sheet ID in `GOOGLE_SHEET_ID` and the JSON (one line) in `GOOGLE_SERVICE_ACCOUNT_JSON`.
5. Run `npm run setup-sheet` once to create the header row.

If you skip this, leads are still saved to `data/leads.csv`, but on Render free hosting that file can be erased, so use the sheet.

---

## PART D. Run it

### D1. On your computer first
```bash
cd whatsapp-bot
cp .env.example .env        # then open .env and fill your details
npm install
```
Edit **`business-data/knowledge.md`** with your real products, prices, address, timing, offers. The bot answers ONLY from this file.

Test the AI in the terminal (no WhatsApp needed, uses your Claude key):
```bash
npm run chat
```
Type like a customer. Bot replies show as `[WA DRY-RUN]`. Run the automatic tests anytime: `npm test`.

### D2. Host it (Render, easiest)
1. Push this repo to GitHub (it's already in your repo, folder `whatsapp-bot`).
2. **render.com -> New -> Web Service** -> connect the repo.
3. Settings: **Root Directory** `whatsapp-bot`, **Build** `npm install`, **Start** `npm start`.
4. **Environment** tab: add every variable from `.env.example` with your real values. Do NOT upload the `.env` file.
5. Deploy. Your URL will be `https://something.onrender.com`. Open it: you should see "... WhatsApp AI is running".
6. Free Render plans go to sleep after inactivity and the first message can be slow (more than 2 seconds), and files on disk are erased on redeploy. For a real shop use a paid always-on plan plus a **Persistent Disk** mounted at `/var/data` and set `DATA_DIR=/var/data`. (Railway or a VPS work the same way: `npm install && npm start`; on a VPS use `pm2 start src/server.js`.)
7. Now do step **A5** (webhook) with your Render URL.

### D3. Optional: bigger scale
`src/store.js` keeps chats in one JSON file, fine for hundreds of customers. For thousands, replace its functions with MongoDB (same function names), and keep Google Sheets for the owner's view.

---

## How the owner controls the bot
Send these from the **OWNER_WHATSAPP** number to the bot number:
- `/resume 919876543210` -> bot starts replying again to that customer (after you finished talking to them)
- `/pause 919876543210` -> bot stops replying to that customer, so you can take over any time
- `/status` -> how many customers, how many are with you

When the bot says "Connecting you to owner", it pauses for that customer and sends you the name, phone, last messages and a link `wa.me/<number>` to open the chat.

## What happens automatically
| Situation | What the bot does |
|---|---|
| Customer says Hi | Instant fixed menu (no AI delay) |
| Customer asks something | Claude replies, using only your knowledge file |
| Learns name/city/need/budget | Saves/updates the row in Google Sheet |
| Wants catalog/price list/payment | Sends the file/link from `.env` |
| Ready to book/order | Collects details, marks "Booking Requested", alerts you |
| Does not know / discount asked | Says "owner se confirm karke batata hu", alerts you |
| Angry or asks for human | "Connecting you to owner", alerts you, bot pauses |
| Not interested | Polite goodbye, no more messages |
| Silent for ~22 hours | One gentle follow-up (not at night) |
