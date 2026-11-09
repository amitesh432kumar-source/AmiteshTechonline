# Amitesh Tech (amiteshtech.online)

AI teaching site: live classes (Google Meet), video courses, members-only community, manual UPI payments.
Built from *Amitesh Tech: Website Summary and Build Plan*.

| Part | Where |
|---|---|
| Whole frontend (public site + admin panel) | `index.html` (plain HTML/CSS/JS, no build step) |
| Database, row-level security, storage buckets | `supabase/setup.sql` |
| The one backend Edge Function (`api`) | `supabase/functions/api/index.ts` |
| Hosting config | `vercel.json` |

## Setup checklist
1. **Google account** with 2-step verification; this becomes the admin email (currently `amitesh432kumar@gmail.com`).
2. **Firebase**: new project, enable *Google* and *Email/Password* sign-in, add a Web app, copy its config.
3. **Supabase**: new project, run `supabase/setup.sql` in the SQL editor.
4. **Edge Function**: create a function named `api`, paste `supabase/functions/api/index.ts`, **turn JWT verification off**, and set secrets
   `FIREBASE_PROJECT_ID` (= `amiteshtechonline`) and `ADMIN_EMAIL` (= `amitesh432kumar@gmail.com`) (or: `supabase functions deploy api --no-verify-jwt`).
5. **Site config**: in `index.html`, fill the `CONFIG` block at the top (Firebase web config, Supabase URL, Supabase *public anon* key). Never put the service key in the site.
6. **GitHub + Vercel**: connect this repo to a Vercel project (framework: Other, no build command).
7. Test on the Vercel address: login, registration, payment, admin verify, community.
8. Add the domain to Firebase *Authorized domains*, then attach `amiteshtech.online` in Vercel.
9. Log in as admin, open **Admin → Settings**: set UPI ID, fee, WhatsApp number, founder details/photos and webhook addresses.

## How it works
- **Public reads** (settings, published courses/classes, testimonials, FAQs) go straight to Supabase with the public key.
- **Everything private** (registrations, purchases, Meet links, lessons of paid courses, community, admin) goes through the `api` function, which verifies the Firebase ID token on every call. Admin = verified Google email equal to `ADMIN_EMAIL`, checked on the server.
- Private tables have RLS enabled with no policies, so the browser cannot read them.
- **Payments**: UPI QR is drawn in the browser with the fee pre-filled; the student sends a WhatsApp screenshot; the admin verifies/approves manually. No UTR field.
- **Community** needs a verified registration and a verified email address (Google sign-in is always verified; email/password users get a verification mail).
- **Webhooks** (Make.com/n8n events, Grok welcome email) are optional and never block a registration.

## Not built yet (per the plan)
Email notifications for community posts, live-class reminder emails, PWA / Play Store listing, festival poster artwork.
