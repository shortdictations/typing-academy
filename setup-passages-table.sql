-- ============================================================
-- Run this in Supabase SQL Editor (SQL Editor -> New query -> paste -> Run)
-- Creates:
--   1. admins        - list of user_ids allowed to manage passages
--   2. passages      - the passage bank, now editable from the admin page
-- ============================================================

-- 1. ADMINS TABLE
-- A user only becomes an admin if their id appears in this table.
-- You add admins manually (see instructions below) — there is no
-- signup flow for admin accounts, on purpose.
create table if not exists admins (
  user_id uuid references auth.users on delete cascade primary key
);

alter table admins enable row level security;

-- A logged-in user is only allowed to check THEIR OWN row —
-- this is what lets the "am I an admin?" check work safely
-- from the browser without exposing the full admin list.
create policy "Users can check own admin status"
  on admins for select
  using (auth.uid() = user_id);


-- 2. PASSAGES TABLE
create table if not exists passages (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  content text not null,
  category text not null,       -- e.g. 'SSC' or 'Stenographer'
  difficulty text,               -- e.g. 'Easy', 'Medium', 'Hard'
  duration int not null,         -- 5 or 10 (minutes) — which test this passage is sized for
  active boolean default true,   -- inactive passages are hidden from students
  created_at timestamp with time zone default now()
);

alter table passages enable row level security;

-- Any logged-in student can read ACTIVE passages.
-- Admins can also read inactive ones (so they can re-activate them).
create policy "Authenticated users can view active passages"
  on passages for select
  using (
    active = true
    or exists (select 1 from admins where user_id = auth.uid())
  );

-- Only admins can add passages
create policy "Admins can insert passages"
  on passages for insert
  with check (exists (select 1 from admins where user_id = auth.uid()));

-- Only admins can edit passages
create policy "Admins can update passages"
  on passages for update
  using (exists (select 1 from admins where user_id = auth.uid()));

-- Only admins can delete passages
create policy "Admins can delete passages"
  on passages for delete
  using (exists (select 1 from admins where user_id = auth.uid()));


-- ============================================================
-- HOW TO MAKE YOURSELF AN ADMIN (do this after running the above)
-- ============================================================
-- 1. Supabase Dashboard -> Authentication -> Users
-- 2. Find your own account in the list, click it, copy its "UID"
-- 3. Come back to SQL Editor, run this (replace the UID below):
--
--    insert into admins (user_id) values ('PASTE-YOUR-UID-HERE');
--
-- You can add more admins later the same way.


-- ============================================================
-- OPTIONAL: seed a couple of starter passages so typing.html
-- isn't empty before you add your own in the admin page.
-- ============================================================
insert into passages (title, content, category, difficulty, duration, active) values
('The Role of the Civil Services', 'The civil services form the steel frame of Indian administration. Officers selected through rigorous examinations are entrusted with the task of implementing policy at every level of government. From maintaining law and order to running welfare schemes, their work touches the daily life of every citizen. A good civil servant balances rules with fairness, and speed with accuracy, much like a skilled typist balances pace with precision.', 'SSC', 'Medium', 5, true),
('Stenography as a Career', 'A stenographer must listen, understand, and record speech almost instantly. This demands complete concentration, a calm hand, and a trained ear for pace and pause. Government departments, courts, and legislative bodies rely on stenographers to produce a faithful written record of proceedings. The skill combines shorthand for dictation with a strong typing speed for transcription, and both must be sharpened together through steady daily practice.', 'Stenographer', 'Medium', 5, true);
