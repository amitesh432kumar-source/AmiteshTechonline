import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(__dirname, '..');
const int = (v, d) => (v === undefined || v === '' ? d : parseInt(v, 10));

export const cfg = {
  baseUrl: (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  port: int(process.env.PORT, 3000),
  databaseUrl: process.env.DATABASE_URL,
  claudeModel: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',
  claudeEffort: process.env.CLAUDE_EFFORT || 'low',
  claudeFallback: (process.env.CLAUDE_FALLBACK ?? 'true') === 'true',
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  encryptionKey: process.env.ENCRYPTION_KEY,
  sessionSecret: process.env.SESSION_SECRET,
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: int(process.env.SMTP_PORT, 465),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || process.env.SMTP_USER
  },
  projectQuota: int(process.env.YOUTUBE_PROJECT_QUOTA, 10000),
  tenantMaxUnits: int(process.env.TENANT_MAX_DAILY_UNITS, 1500),
  tenantMaxAiReplies: int(process.env.TENANT_MAX_AI_REPLIES_PER_DAY, 100),
  pollSeconds: int(process.env.COMMENT_POLL_SECONDS, 90),
  maxTenants: int(process.env.MAX_TENANTS, 200)
};

export function assertPlatformEnv() {
  const need = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    DATABASE_URL: cfg.databaseUrl,
    GOOGLE_CLIENT_ID: cfg.googleClientId,
    GOOGLE_CLIENT_SECRET: cfg.googleClientSecret,
    ENCRYPTION_KEY: cfg.encryptionKey,
    SESSION_SECRET: cfg.sessionSecret
  };
  const missing = Object.keys(need).filter((k) => !need[k]);
  if (missing.length) throw new Error(`.env me missing: ${missing.join(', ')}`);
  if (!/^[0-9a-fA-F]{64}$/.test(cfg.encryptionKey)) {
    throw new Error('ENCRYPTION_KEY 64 hex characters ka hona chahiye');
  }
}

export const log = (...a) => console.log(new Date().toISOString(), ...a);

// Default profile - har naye creator ko ye milta hai, wo dashboard se badal sakta hai
export const DEFAULT_SETTINGS = {
  botEnabled: false,          // naya user pehle DRY RUN me test kare
  postReplies: false,         // false = sirf dikhao, YouTube pe post mat karo
  hideAbusive: true,
  liveChat: false,
  liveWelcome: true,
  weeklyReport: true,
  ownerEmail: '',
  webhookUrl: '',             // collab alerts ke liye (Zapier / Make / WhatsApp bridge)
  profile: {
    channelName: '',
    aiName: '',
    ownerName: '',
    topic: '',
    audience: '',
    style: 'Friendly, respectful, simple Hinglish',
    calling: "Viewer ko 'Bhai', 'Didi' ya 'Sir' bolo, jaise creator bolta hai",
    languages: 'Hinglish, Hindi, English - jis language me viewer ne likha usi me reply',
    priceInfo: '',
    links: { description: '', course: '', website: '', telegram: '', instagram: '' },
    faqs: [],
    extraRules: [],
    nudge: 'Koi aur doubt ho to batao'
  },
  forwardPatterns: [
    'collab', 'collaboration', 'paid promotion', 'paid promo', 'promotion', 'sponsor', 'sponsorship',
    'brand deal', 'business inquiry', 'business enquiry', 'partnership', 'work together',
    'your number', 'apna number', 'number do', 'number dena', 'number send', 'contact number',
    'phone number', 'mobile number', 'whatsapp number', 'whatsapp no', 'call me', 'call karo',
    'email id', 'mail id', 'नंबर', 'कोलैब', 'प्रमोशन'
  ],
  blockedWords: [
    'madarchod', 'behenchod', 'bhosdi', 'bhosdike', 'chutiya', 'gandu', 'harami', 'randi',
    'fuck', 'bitch', 'bastard', 'asshole'
  ]
};
