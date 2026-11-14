// Amitesh Tech: the single Edge Function that guards the database.
// Deploy as function name "api" with JWT verification OFF (we verify the Firebase token ourselves).
// Environment: FIREBASE_PROJECT_ID, ADMIN_EMAIL  (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { createRemoteJWKSet, jwtVerify } from "https://esm.sh/jose@5.9.6";

const PID = Deno.env.get("FIREBASE_PROJECT_ID") ?? "";
const ADMIN = (Deno.env.get("ADMIN_EMAIL") ?? "").toLowerCase();
const URL_ = Deno.env.get("SUPABASE_URL")!;
const sb = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
class Fail extends Error { constructor(public msg: string, public status = 400) { super(msg); } }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ---------- validation ----------
const str = (v: unknown, max: number, req = false, name = "field") => {
  const s = typeof v === "string" ? v.trim() : "";
  if (req && !s) throw new Fail(`${name} is required`);
  if (s.length > max) throw new Fail(`${name} is too long`);
  return s;
};
const int = (v: unknown, min: number, max: number, name = "number") => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) throw new Fail(`${name} must be between ${min} and ${max}`);
  return n;
};
const url = (v: unknown, name = "link", req = false) => {
  const s = str(v, 1000, req, name);
  if (s && !/^https?:\/\//i.test(s)) throw new Fail(`${name} must start with http:// or https://`);
  return s;
};
const uuid = (v: unknown) => {
  if (typeof v !== "string" || !/^[0-9a-f-]{36}$/i.test(v)) throw new Fail("Invalid id");
  return v;
};
const UPI_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;
const q = <T>(r: { data: T; error: { message: string } | null }): T => {
  if (r.error) throw new Fail("Database error: " + r.error.message, 500);
  return r.data;
};

// ---------- auth ----------
type User = { uid: string; email: string; verified: boolean; name: string; admin: boolean };
async function authUser(req: Request): Promise<User | null> {
  const t = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!t || !PID) return null;
  try {
    const { payload } = await jwtVerify(t, JWKS, { issuer: `https://securetoken.google.com/${PID}`, audience: PID });
    if (!payload.email) return null;
    const email = String(payload.email).toLowerCase();
    const verified = payload.email_verified === true;
    return { uid: String(payload.sub), email, verified, name: String(payload.name ?? ""), admin: verified && email === ADMIN };
  } catch { return null; }
}
const need = (u: User | null): User => { if (!u) throw new Fail("Please log in", 401); return u; };
const needAdmin = (u: User | null): User => { if (!need(u).admin) throw new Fail("Admin only", 403); return u!; };

// ---------- helpers ----------
async function settings() { return (q(await sb.from("settings").select("data").eq("id", 1).maybeSingle()) as any)?.data ?? {}; }
async function hooks() { return (q(await sb.from("admin_config").select("data").eq("id", 1).maybeSingle()) as any)?.data ?? {}; }
const paypalView = (h: any) => ({ client_id: h.paypal?.client_id ?? "", mode: h.paypal?.mode ?? "sandbox", has_secret: !!h.paypal?.client_secret, currency: h.paypal?.currency ?? "INR", rate: h.paypal?.rate ?? 1 });
const ppBase = (mode: string) => mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
async function ppCall(h: any, path: string, body?: unknown) {
  const c = h.paypal;
  if (!c?.client_id || !c?.client_secret) throw new Fail("PayPal is not set up", 400);
  const base = ppBase(c.mode);
  const tr = await fetch(`${base}/v1/oauth2/token`, { method: "POST", headers: { Authorization: "Basic " + btoa(`${c.client_id}:${c.client_secret}`), "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  const tj = await tr.json().catch(() => ({}));
  if (!tr.ok || !tj.access_token) throw new Fail("PayPal login failed. Check Client ID / Secret and Sandbox/Live mode in admin.", 502);
  const r = await fetch(base + path, { method: "POST", headers: { Authorization: "Bearer " + tj.access_token, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error("paypal", path, JSON.stringify(j)); throw new Fail(j.details?.[0]?.description || j.message || "PayPal error", 502); }
  return j;
}
function fire(kind: "automation" | "welcome", payload: Record<string, unknown>) {
  const p = (async () => {
    try {
      const h = await hooks(); const target = h[kind];
      if (!target) return;
      await fetch(target, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(4000) });
    } catch { /* webhooks never block or fail anything */ }
  })();
  (globalThis as any).EdgeRuntime?.waitUntil?.(p);
}
const priceAfter = (item: { is_paid: boolean; price: number }, s: any) => {
  if (!item.is_paid || item.price <= 0) return 0;
  const pct = Number(s?.discount?.percent) || 0;
  return Math.max(1, Math.round(item.price * (100 - pct) / 100));
};
async function eligible(u: User) {
  if (u.admin) return true;
  if (!u.verified) return false;
  const reg = q(await sb.from("registrations").select("id").eq("email", u.email).eq("status", "verified").limit(1));
  if (!(reg as any[]).length) return false;
  const m = q(await sb.from("community_members").select("status").eq("email", u.email).maybeSingle()) as any;
  return m?.status !== "removed";
}
async function enrolled(u: User, kind: string, id: string) {
  if (u.admin) return true;
  const r = q(await sb.from("enrollments").select("item_id").eq("email", u.email).eq("kind", kind).eq("item_id", id).limit(1));
  return (r as any[]).length > 0;
}
const publicUrl = (bucket: string, path: string) => `${URL_}/storage/v1/object/public/${bucket}/${path}`;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/webm": "webm" };

function cleanSettings(s: any) {
  s = s ?? {};
  const upi = str(s.upi?.id, 100, false, "UPI ID");
  if (upi && !UPI_RE.test(upi)) throw new Fail("UPI ID looks wrong (example: name@bank)");
  const photos = Array.isArray(s.founder?.photos) ? s.founder.photos : [];
  if (photos.length > 5) throw new Fail("At most 5 About photos");
  const wa = str(s.support?.whatsapp, 20).replace(/\D/g, "");
  if (wa && (wa.length < 10 || wa.length > 15)) throw new Fail("WhatsApp number looks wrong");
  return {
    discount: { percent: int(s.discount?.percent ?? 0, 0, 90, "Discount %"), label: str(s.discount?.label, 80) },
    fee: int(s.fee ?? 499, 1, 100000, "Registration fee"),
    upi: { id: upi, name: str(s.upi?.name, 60) },
    qr_image: url(s.qr_image, "QR image"),
    founder: { name: str(s.founder?.name, 80), bio: str(s.founder?.bio, 3000), photos: photos.map((p: unknown) => url(p, "Photo", true)) },
    support: { whatsapp: wa || "917250947444" },
  };
}

// ---------- student actions ----------
const S: Record<string, (u: User | null, b: any) => Promise<unknown>> = {
  async sync(u0) {
    const u = need(u0);
    q(await sb.from("users").upsert({ email: u.email, uid: u.uid, name: u.name }, { onConflict: "email" }));
    const regs = q(await sb.from("registrations").select("*").eq("email", u.email).order("created_at", { ascending: false }).limit(1)) as any[];
    const enr = q(await sb.from("enrollments").select("kind,item_id").eq("email", u.email));
    const pur = q(await sb.from("purchases").select("id,kind,item_id,title,amount,status,created_at").eq("email", u.email).order("created_at", { ascending: false }).limit(100));
    const mem = q(await sb.from("community_members").select("status").eq("email", u.email).maybeSingle()) as any;
    return { admin: u.admin, email: u.email, verified: u.verified, registration: regs[0] ?? null, enrollments: enr, purchases: pur, eligible: await eligible(u), member: mem?.status === "active" };
  },

  async register(u0, b) {
    const u = need(u0);
    const s = await settings();
    const level = str(b.level, 20, true, "Level");
    if (!["Beginner", "Average", "Advanced"].includes(level)) throw new Fail("Choose a level");
    const phone = str(b.phone, 20, true, "Phone").replace(/[\s-]/g, "").replace(/^\+?91/, "");
    if (!/^[6-9]\d{9}$/.test(phone)) throw new Fail("Enter a valid 10-digit mobile number");
    const row = {
      name: str(b.name, 100, true, "Student name"), mother_name: str(b.mother_name, 100, true, "Mother's name"),
      father_name: str(b.father_name, 100, true, "Father's name"), level, email: u.email, phone, fee: int(s.fee ?? 499, 1, 100000),
    };
    const existing = q(await sb.from("registrations").select("*").eq("email", u.email).order("created_at", { ascending: false }).limit(1)) as any[];
    if (existing[0]?.status === "verified") return { registration: existing[0] };
    let reg: any;
    if (existing[0]) reg = q(await sb.from("registrations").update(row).eq("id", existing[0].id).select().single());
    else reg = q(await sb.from("registrations").insert(row).select().single());
    const base = { time: new Date().toISOString(), name: row.name, email: row.email, phone, level, title: "Registration", amount: row.fee, utr: "" };
    fire("automation", { event: "registration_submitted", ...base });
    if (!existing[0]) fire("welcome", { name: row.name, email: row.email });
    return { registration: reg };
  },

  async paypal_config() {
    const p = paypalView(await hooks());
    return p.client_id && p.has_secret ? { enabled: true, client_id: p.client_id, currency: p.currency } : { enabled: false };
  },

  async paypal_order(u0, b) {
    const u = need(u0); const h = await hooks(); const pv = paypalView(h);
    let amount = 0, custom = "", desc = "Amitesh Tech";
    if (b.type === "registration") {
      const r = (await S.register(u, b.form ?? {})) as any;
      if (r.registration.status === "verified") throw new Fail("Already registered");
      amount = r.registration.fee; custom = `reg:${r.registration.id}`; desc = "Registration fee";
    } else {
      const r = (await S.purchase(u, b)) as any;
      if (r.enrolled) throw new Fail("Already enrolled");
      amount = r.purchase.amount; custom = `pur:${r.purchase.id}`; desc = String(r.purchase.title).slice(0, 120);
    }
    const value = (amount / (Number(pv.rate) || 1)).toFixed(2);
    const o = await ppCall(h, "/v2/checkout/orders", { intent: "CAPTURE", purchase_units: [{ custom_id: custom, description: desc, amount: { currency_code: pv.currency, value } }] });
    return { id: o.id };
  },

  async paypal_capture(u0, b) {
    const u = need(u0); const h = await hooks();
    const oid = str(b.order_id, 64, true, "Order");
    const cap = await ppCall(h, `/v2/checkout/orders/${encodeURIComponent(oid)}/capture`);
    const unit = cap.purchase_units?.[0], c = unit?.payments?.captures?.[0];
    if (cap.status !== "COMPLETED" || c?.status !== "COMPLETED") throw new Fail("Payment was not completed. You were not charged for an approved order.", 402);
    const [kind, id] = String(c.custom_id ?? unit?.custom_id ?? "").split(":");
    if (kind === "pur") {
      const p = q(await sb.from("purchases").select("*").eq("id", uuid(id)).maybeSingle()) as any;
      if (!p || p.email !== u.email) throw new Fail("Payment does not match your account. Contact support with order " + oid, 403);
      await A.decide_purchase(u, { id: p.id, approve: true });
    } else if (kind === "reg") {
      const r = q(await sb.from("registrations").select("id,email").eq("id", uuid(id)).maybeSingle()) as any;
      if (!r || r.email !== u.email) throw new Fail("Payment does not match your account. Contact support with order " + oid, 403);
      await A.verify_registration(u, { id: r.id });
    } else throw new Fail("Unknown payment. Contact support with order " + oid);
    return { ok: true };
  },

  async content(u0, b) {
    const kind = b.kind, id = uuid(b.id);
    if (kind === "course") {
      const c = q(await sb.from("courses").select("*").eq("id", id).eq("published", true).maybeSingle()) as any;
      if (!c) throw new Fail("Course not found", 404);
      if (c.is_paid) { const u = need(u0); if (!(await enrolled(u, "course", id))) throw new Fail("Payment not approved yet", 403); }
      const lessons = q(await sb.from("course_lessons").select("id,position,title,kind,url").eq("course_id", id).order("position"));
      return { lessons };
    }
    if (kind === "class") {
      const u = need(u0);
      if (!(await enrolled(u, "class", id))) throw new Fail("Not enrolled yet", 403);
      const l = q(await sb.from("live_class_links").select("meet_url").eq("class_id", id).maybeSingle()) as any;
      return { meet_url: l?.meet_url ?? "" };
    }
    throw new Fail("Unknown content");
  },

  async purchase(u0, b) {
    const u = need(u0);
    const kind = b.kind === "class" ? "class" : "course", id = uuid(b.id);
    const item = q(await sb.from(kind === "course" ? "courses" : "live_classes").select("*").eq("id", id).eq("published", true).maybeSingle()) as any;
    if (!item) throw new Fail("Item not found", 404);
    const s = await settings();
    const amount = priceAfter(item, s);
    if (await enrolled(u, kind, id)) return { enrolled: true };
    if (amount === 0) {
      q(await sb.from("enrollments").upsert({ email: u.email, kind, item_id: id }));
      return { enrolled: true };
    }
    const open = q(await sb.from("purchases").select("*").eq("email", u.email).eq("kind", kind).eq("item_id", id).eq("status", "pending").limit(1)) as any[];
    if (open[0]) return { purchase: open[0] };
    const reg = q(await sb.from("registrations").select("name,phone").eq("email", u.email).order("created_at", { ascending: false }).limit(1)) as any[];
    const name = reg[0]?.name || u.name || u.email;
    const p = q(await sb.from("purchases").insert({ email: u.email, name, kind, item_id: id, title: item.title, amount }).select().single()) as any;
    fire("automation", { event: "purchase_submitted", time: new Date().toISOString(), name, email: u.email, phone: reg[0]?.phone ?? "", level: "", title: item.title, amount, utr: "" });
    return { purchase: p };
  },

  async feed(u0) {
    const u = need(u0);
    if (!(await eligible(u))) throw new Fail("Community is for verified students only", 403);
    const posts = q(await sb.from("community_posts").select("*").order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(100)) as any[];
    const ids = posts.map((p) => p.id);
    const likes = ids.length ? (q(await sb.from("community_likes").select("post_id,email").in("post_id", ids)) as any[]) : [];
    const cms = ids.length ? (q(await sb.from("community_comments").select("post_id").in("post_id", ids)) as any[]) : [];
    const mem = q(await sb.from("community_members").select("name,joined_at").eq("status", "active").order("joined_at").limit(500));
    return {
      posts: posts.map((p) => ({
        ...p, likes: likes.filter((l) => l.post_id === p.id).length,
        liked: likes.some((l) => l.post_id === p.id && l.email === u.email),
        comments: cms.filter((c) => c.post_id === p.id).length,
      })),
      members: mem,
    };
  },

  async join(u0) {
    const u = need(u0);
    if (!(await eligible(u))) throw new Fail("Not eligible", 403);
    const reg = q(await sb.from("registrations").select("name").eq("email", u.email).order("created_at", { ascending: false }).limit(1)) as any[];
    q(await sb.from("community_members").upsert({ email: u.email, name: reg[0]?.name || u.name || "Member", status: "active" }));
    return { ok: true };
  },

  async like(u0, b) {
    const u = need(u0);
    if (!(await eligible(u))) throw new Fail("Not eligible", 403);
    const id = uuid(b.post_id);
    const ex = q(await sb.from("community_likes").select("post_id").eq("post_id", id).eq("email", u.email).limit(1)) as any[];
    if (ex.length) q(await sb.from("community_likes").delete().eq("post_id", id).eq("email", u.email));
    else q(await sb.from("community_likes").insert({ post_id: id, email: u.email }));
    const n = q(await sb.from("community_likes").select("post_id").eq("post_id", id)) as any[];
    return { liked: !ex.length, likes: n.length };
  },

  async comments(u0, b) {
    const u = need(u0);
    if (!(await eligible(u))) throw new Fail("Not eligible", 403);
    const list = q(await sb.from("community_comments").select("id,name,email,body,created_at").eq("post_id", uuid(b.post_id)).order("created_at").limit(300)) as any[];
    return { comments: list.map((c) => ({ id: c.id, name: c.name, body: c.body, created_at: c.created_at, mine: c.email === u.email })) };
  },

  async add_comment(u0, b) {
    const u = need(u0);
    if (!(await eligible(u))) throw new Fail("Not eligible", 403);
    const body = str(b.body, 1000, true, "Comment");
    const since = new Date(Date.now() - 60_000).toISOString();
    const recent = q(await sb.from("community_comments").select("id").eq("email", u.email).gte("created_at", since)) as any[];
    if (recent.length >= 5) throw new Fail("Too many comments. Please wait a minute.", 429);
    const reg = q(await sb.from("registrations").select("name").eq("email", u.email).order("created_at", { ascending: false }).limit(1)) as any[];
    q(await sb.from("community_comments").insert({ post_id: uuid(b.post_id), email: u.email, name: u.admin ? "Amitesh (Admin)" : reg[0]?.name || u.name || "Student", body }));
    return { ok: true };
  },

  async delete_comment(u0, b) {
    const u = need(u0);
    const c = q(await sb.from("community_comments").select("email").eq("id", uuid(b.id)).maybeSingle()) as any;
    if (!c) return { ok: true };
    if (!u.admin && c.email !== u.email) throw new Fail("Not allowed", 403);
    q(await sb.from("community_comments").delete().eq("id", uuid(b.id)));
    return { ok: true };
  },
};

// ---------- admin actions ----------
const A: Record<string, (u: User | null, b: any) => Promise<unknown>> = {
  async admin_load() {
    const [courses, lessons, classes, links, testimonials, faqs, regs, purchases, posts, members, set, h] = await Promise.all([
      sb.from("courses").select("*").order("created_at", { ascending: false }),
      sb.from("course_lessons").select("*").order("position"),
      sb.from("live_classes").select("*").order("starts_at", { ascending: false }),
      sb.from("live_class_links").select("*"),
      sb.from("testimonials").select("*").order("created_at", { ascending: false }),
      sb.from("faqs").select("*").order("created_at"),
      sb.from("registrations").select("*").order("created_at", { ascending: false }).limit(500),
      sb.from("purchases").select("*").order("created_at", { ascending: false }).limit(500),
      sb.from("community_posts").select("*").order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(200),
      sb.from("community_members").select("*").order("joined_at", { ascending: false }).limit(500),
      settings(), hooks(),
    ]);
    const L = q(lessons) as any[], K = q(links) as any[], R = q(regs) as any[];
    const phone = new Map(R.map((r) => [r.email, r.phone]));
    return {
      courses: (q(courses) as any[]).map((c) => ({ ...c, lessons: L.filter((l) => l.course_id === c.id) })),
      classes: (q(classes) as any[]).map((c) => ({ ...c, meet_url: K.find((k) => k.class_id === c.id)?.meet_url ?? "" })),
      testimonials: q(testimonials), faqs: q(faqs), registrations: R,
      purchases: (q(purchases) as any[]).map((p) => ({ ...p, phone: phone.get(p.email) ?? "" })),
      posts: q(posts), members: q(members), settings: set, hooks: { automation: h.automation ?? "", welcome: h.welcome ?? "" },
      paypal: paypalView(h),
    };
  },

  async save_course(_u, b) {
    const row = {
      title: str(b.title, 150, true, "Title"), description: str(b.description, 3000), is_paid: !!b.is_paid,
      price: b.is_paid ? int(b.price, 1, 100000, "Price") : 0, instructor: str(b.instructor, 100),
      thumbnail: url(b.thumbnail, "Thumbnail"), published: !!b.published,
    };
    const lessons = Array.isArray(b.lessons) ? b.lessons : [];
    if (lessons.length > 200) throw new Fail("At most 200 lessons");
    const clean = lessons.map((l: any, i: number) => ({ position: i, title: str(l.title, 150, true, "Lesson title"), kind: l.kind === "video" ? "video" : "link", url: url(l.url, "Lesson link", true) }));
    let id = b.id ? uuid(b.id) : "";
    if (id) q(await sb.from("courses").update(row).eq("id", id));
    else id = (q(await sb.from("courses").insert(row).select("id").single()) as any).id;
    q(await sb.from("course_lessons").delete().eq("course_id", id));
    if (clean.length) q(await sb.from("course_lessons").insert(clean.map((l: any) => ({ ...l, course_id: id }))));
    return { id };
  },
  async delete_course(_u, b) { q(await sb.from("courses").delete().eq("id", uuid(b.id))); return { ok: true }; },

  async save_class(_u, b) {
    const row = {
      title: str(b.title, 150, true, "Title"), description: str(b.description, 3000), is_paid: !!b.is_paid,
      price: b.is_paid ? int(b.price, 1, 100000, "Price") : 0, instructor: str(b.instructor, 100),
      starts_at: b.starts_at ? new Date(b.starts_at).toISOString() : null, published: !!b.published,
    };
    let id = b.id ? uuid(b.id) : "";
    if (id) q(await sb.from("live_classes").update(row).eq("id", id));
    else id = (q(await sb.from("live_classes").insert(row).select("id").single()) as any).id;
    q(await sb.from("live_class_links").upsert({ class_id: id, meet_url: url(b.meet_url, "Google Meet link") }));
    return { id };
  },
  async delete_class(_u, b) { q(await sb.from("live_classes").delete().eq("id", uuid(b.id))); return { ok: true }; },

  async decide_purchase(_u, b) {
    const id = uuid(b.id);
    const p = q(await sb.from("purchases").select("*").eq("id", id).maybeSingle()) as any;
    if (!p) throw new Fail("Not found", 404);
    const status = b.approve ? "approved" : "rejected";
    q(await sb.from("purchases").update({ status, decided_at: new Date().toISOString() }).eq("id", id));
    if (b.approve) {
      q(await sb.from("enrollments").upsert({ email: p.email, kind: p.kind, item_id: p.item_id }));
      fire("automation", { event: "purchase_approved", time: new Date().toISOString(), name: p.name, email: p.email, phone: "", level: "", title: p.title, amount: p.amount, utr: "" });
    }
    return { ok: true };
  },
  async verify_registration(_u, b) {
    const id = uuid(b.id);
    const r = q(await sb.from("registrations").update({ status: "verified", verified_at: new Date().toISOString() }).eq("id", id).select().single()) as any;
    fire("automation", { event: "registration_verified", time: new Date().toISOString(), name: r.name, email: r.email, phone: r.phone, level: r.level, title: "Registration", amount: r.fee, utr: "" });
    return { ok: true };
  },
  async delete_registration(_u, b) { q(await sb.from("registrations").delete().eq("id", uuid(b.id))); return { ok: true }; },

  async save_testimonial(_u, b) {
    q(await sb.from("testimonials").insert({ name: str(b.name, 80, true, "Name"), role: str(b.role, 100), text: str(b.text, 1000, true, "Text") }));
    return { ok: true };
  },
  async delete_testimonial(_u, b) { q(await sb.from("testimonials").delete().eq("id", uuid(b.id))); return { ok: true }; },
  async save_faq(_u, b) {
    q(await sb.from("faqs").insert({ question: str(b.question, 300, true, "Question"), answer: str(b.answer, 2000, true, "Answer") }));
    return { ok: true };
  },
  async delete_faq(_u, b) { q(await sb.from("faqs").delete().eq("id", uuid(b.id))); return { ok: true }; },

  async save_post(_u, b) {
    const type = ["Notice", "Update", "New Course", "Live Class"].includes(b.type) ? b.type : "Notice";
    const row = { type, title: str(b.title, 200, true, "Title"), body: str(b.body, 5000), image: url(b.image, "Image"), link: url(b.link, "Link"), pinned: !!b.pinned };
    if (b.id) q(await sb.from("community_posts").update(row).eq("id", uuid(b.id)));
    else q(await sb.from("community_posts").insert(row));
    return { ok: true };
  },
  async delete_post(_u, b) { q(await sb.from("community_posts").delete().eq("id", uuid(b.id))); return { ok: true }; },
  async pin_post(_u, b) { q(await sb.from("community_posts").update({ pinned: !!b.pinned }).eq("id", uuid(b.id))); return { ok: true }; },
  async remove_member(_u, b) {
    const email = str(b.email, 200, true, "Email").toLowerCase();
    q(await sb.from("community_members").upsert({ email, status: "removed" }));
    return { ok: true };
  },
  async restore_member(_u, b) {
    q(await sb.from("community_members").delete().eq("email", str(b.email, 200, true, "Email").toLowerCase()));
    return { ok: true };
  },

  async save_settings(_u, b) {
    const clean = cleanSettings(b.settings);
    q(await sb.from("settings").upsert({ id: 1, data: clean }));
    return { settings: await settings() }; // read back so the admin sees what was really stored
  },
  async set_hooks(_u, b) {
    const a = url(b.automation, "Automation address"), w = url(b.welcome, "Welcome email address");
    const cur = await hooks();
    q(await sb.from("admin_config").upsert({ id: 1, data: { ...cur, automation: a, welcome: w } }));
    const h = await hooks();
    return { hooks: { automation: h.automation ?? "", welcome: h.welcome ?? "" } };
  },
  async set_paypal(_u, b) {
    const cur = await hooks();
    const id = str(b.client_id, 200, false, "PayPal Client ID").trim();
    const mode = b.mode === "live" ? "live" : "sandbox";
    // blank secret = keep the one already saved (the secret is never sent back to the browser)
    const secret = str(b.client_secret, 300, false, "PayPal Client Secret").trim() || cur.paypal?.client_secret || "";
    const currency = (str(b.currency, 3, false, "Currency") || "INR").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new Fail("Currency must be a 3-letter code like INR or USD");
    const rate = Number(b.rate) || 1;
    if (rate <= 0 || rate > 100000) throw new Fail("Rate must be above 0");
    q(await sb.from("admin_config").upsert({ id: 1, data: { ...cur, paypal: { client_id: id, client_secret: secret, mode, currency, rate } } }));
    return { paypal: paypalView(await hooks()) };
  },

  async upload(_u, b) {
    const type = str(b.type, 40, true, "Type");
    if (!type.startsWith("image/") || !EXT[type]) throw new Fail("Only JPG, PNG, WebP or GIF images");
    const bin = Uint8Array.from(atob(str(b.data, 8_000_000, true, "File")), (c) => c.charCodeAt(0));
    if (bin.length > 5 * 1024 * 1024) throw new Fail("Image must be under 5 MB");
    const path = `${crypto.randomUUID()}.${EXT[type]}`;
    const r = await sb.storage.from("site-assets").upload(path, bin, { contentType: type });
    if (r.error) throw new Fail("Upload failed: " + r.error.message, 500);
    return { url: publicUrl("site-assets", path) };
  },
  async signed_upload(_u, b) {
    const type = str(b.type, 40, true, "Type");
    if (type !== "video/mp4" && type !== "video/webm") throw new Fail("Only mp4 or webm video");
    if (int(b.size, 1, 52428800, "File size") > 52428800) throw new Fail("Video must be under 50 MB");
    const path = `${crypto.randomUUID()}.${EXT[type]}`;
    const r = await sb.storage.from("course-videos").createSignedUploadUrl(path);
    if (r.error) throw new Fail("Could not start upload: " + r.error.message, 500);
    return { upload_url: r.data.signedUrl, public_url: publicUrl("course-videos", path) };
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const b = await req.json().catch(() => ({}));
    const action = String(b.action ?? "");
    const u = await authUser(req);
    if (S[action]) return json(await S[action](u, b));
    if (A[action]) { needAdmin(u); return json(await A[action](u, b)); }
    throw new Fail("Unknown action", 404);
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.msg }, e.status);
    console.error(e);
    return json({ error: "Something went wrong" }, 500);
  }
});
