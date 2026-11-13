import "dotenv/config";

const env = (k, d = "") => (process.env[k] ?? d).toString().trim();

export const cfg = {
  business: {
    name: env("BUSINESS_NAME", "Your Business"),
    type: env("BUSINESS_TYPE", "Shop"),
    city: env("CITY", ""),
    owner: env("OWNER_NAME", "Owner"),
    aiName: env("AI_NAME", "Riya"),
    workingTime: env("WORKING_TIME", "10 AM to 9 PM"),
    timezone: env("TIMEZONE", "Asia/Kolkata"),
  },
  wa: {
    token: env("WHATSAPP_TOKEN"),
    phoneId: env("WHATSAPP_PHONE_NUMBER_ID"),
    verifyToken: env("WHATSAPP_VERIFY_TOKEN"),
    appSecret: env("WHATSAPP_APP_SECRET"),
    graphVersion: env("GRAPH_VERSION", "v23.0"),
    owner: env("OWNER_WHATSAPP").replace(/\D/g, ""),
    dryRun: env("WA_DRY_RUN") === "1",
  },
  ai: {
    apiKey: env("ANTHROPIC_API_KEY"),
    model: env("CLAUDE_MODEL", "claude-sonnet-5-5"),
    maxHistory: 60, // messages sent to Claude (full history is still stored on disk)
  },
  sheets: {
    id: env("GOOGLE_SHEET_ID"),
    json: env("GOOGLE_SERVICE_ACCOUNT_JSON"),
    b64: env("GOOGLE_SERVICE_ACCOUNT_B64"),
    tab: "Leads",
  },
  files: {
    catalog: env("CATALOG_URL"),
    priceList: env("PRICE_LIST_URL"),
    paymentLink: env("PAYMENT_LINK"),
  },
  followup: {
    afterHours: Number(env("FOLLOWUP_AFTER_HOURS", "22")),
    templateName: env("FOLLOWUP_TEMPLATE_NAME"),
  },
  ownerAlertTemplate: env("OWNER_ALERT_TEMPLATE_NAME"),
  port: Number(env("PORT", "3000")),
  dataDir: env("DATA_DIR", "./data"),
};
