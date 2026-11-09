-- Amitesh Tech: database schema, row-level security and storage.
-- Run once in the Supabase SQL editor of a new project.
-- Private tables have RLS enabled with NO policies, so only the Edge Function (service key) can reach them.

create extension if not exists pgcrypto;

create table if not exists settings (id int primary key default 1 check (id = 1), data jsonb not null default '{}'::jsonb);
insert into settings (id, data) values (1, '{"discount":{"percent":0,"label":""},"fee":499,"upi":{"id":"","name":""},"qr_image":"","founder":{"name":"Amitesh","bio":"","photos":[]},"support":{"whatsapp":"917250947444"}}') on conflict (id) do nothing;

create table if not exists admin_config (id int primary key default 1 check (id = 1), data jsonb not null default '{}'::jsonb);
insert into admin_config (id, data) values (1, '{}') on conflict (id) do nothing;

create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  title text not null, description text not null default '',
  is_paid boolean not null default false, price int not null default 0 check (price between 0 and 100000),
  instructor text not null default '', thumbnail text not null default '',
  published boolean not null default false, created_at timestamptz not null default now());

create table if not exists course_lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  position int not null default 0, title text not null,
  kind text not null default 'link' check (kind in ('link','video')), url text not null);
create index if not exists course_lessons_course on course_lessons(course_id, position);

create table if not exists live_classes (
  id uuid primary key default gen_random_uuid(),
  title text not null, description text not null default '',
  is_paid boolean not null default false, price int not null default 0 check (price between 0 and 100000),
  instructor text not null default '', starts_at timestamptz,
  published boolean not null default false, created_at timestamptz not null default now());

create table if not exists live_class_links (class_id uuid primary key references live_classes(id) on delete cascade, meet_url text not null default '');

create table if not exists testimonials (id uuid primary key default gen_random_uuid(), name text not null, role text not null default '', text text not null, created_at timestamptz not null default now());
create table if not exists faqs (id uuid primary key default gen_random_uuid(), question text not null, answer text not null, created_at timestamptz not null default now());

create table if not exists registrations (
  id uuid primary key default gen_random_uuid(),
  name text not null, mother_name text not null, father_name text not null,
  level text not null check (level in ('Beginner','Average','Advanced')),
  email text not null, phone text not null, fee int not null,
  status text not null default 'pending' check (status in ('pending','verified')),
  created_at timestamptz not null default now(), verified_at timestamptz);
create index if not exists registrations_email on registrations(email);

create table if not exists users (email text primary key, uid text, name text, created_at timestamptz not null default now());

create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  email text not null, name text not null default '',
  kind text not null check (kind in ('course','class')), item_id uuid not null,
  title text not null default '', amount int not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(), decided_at timestamptz);
create index if not exists purchases_email on purchases(email);

create table if not exists enrollments (
  email text not null, kind text not null check (kind in ('course','class')), item_id uuid not null,
  created_at timestamptz not null default now(), primary key (email, kind, item_id));

create table if not exists community_posts (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'Notice' check (type in ('Notice','Update','New Course','Live Class')),
  title text not null, body text not null default '', image text not null default '', link text not null default '',
  pinned boolean not null default false, created_at timestamptz not null default now());
create table if not exists community_members (email text primary key, name text not null default '', status text not null default 'active' check (status in ('active','removed')), joined_at timestamptz not null default now());
create table if not exists community_likes (post_id uuid not null references community_posts(id) on delete cascade, email text not null, primary key (post_id, email));
create table if not exists community_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references community_posts(id) on delete cascade,
  email text not null, name text not null default '', body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now());
create index if not exists community_comments_post on community_comments(post_id, created_at);

-- Row-level security: on for everything.
do $$ declare t text; begin
  foreach t in array array['settings','admin_config','courses','course_lessons','live_classes','live_class_links','testimonials','faqs','registrations','users','purchases','enrollments','community_posts','community_members','community_likes','community_comments']
  loop execute format('alter table %I enable row level security', t); end loop;
end $$;

-- Public read policies (the only things the browser may read directly).
drop policy if exists "public read settings" on settings;        create policy "public read settings" on settings for select using (true);
drop policy if exists "public read courses" on courses;          create policy "public read courses" on courses for select using (published);
drop policy if exists "public read classes" on live_classes;     create policy "public read classes" on live_classes for select using (published);
drop policy if exists "public read testimonials" on testimonials; create policy "public read testimonials" on testimonials for select using (true);
drop policy if exists "public read faqs" on faqs;                create policy "public read faqs" on faqs for select using (true);

-- Storage: public buckets, 50 MB per file.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('site-assets','site-assets',true, 5242880, array['image/jpeg','image/png','image/webp','image/gif']),
  ('course-videos','course-videos',true, 52428800, array['video/mp4','video/webm'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
