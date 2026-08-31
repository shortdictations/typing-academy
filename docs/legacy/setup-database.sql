-- ============================================================
-- Run this ENTIRE file once in your Supabase project's
-- SQL Editor (Dashboard -> SQL Editor -> New query -> paste -> Run)
-- ============================================================

-- 1. Table to store student names (linked to Supabase's built-in auth users)
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text,
  created_at timestamp with time zone default now()
);

alter table profiles enable row level security;

create policy "Users can view own profile"
  on profiles for select
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on profiles for insert
  with check (auth.uid() = id);

create policy "Users can update own profile"
  on profiles for update
  using (auth.uid() = id);

-- 2. Table to store every typing test result
create table if not exists results (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  passage_title text,
  category text,
  duration_minutes int,
  wpm numeric,
  accuracy numeric,
  correct_chars int,
  total_chars int,
  created_at timestamp with time zone default now()
);

alter table results enable row level security;

create policy "Users can view own results"
  on results for select
  using (auth.uid() = user_id);

create policy "Users can insert own results"
  on results for insert
  with check (auth.uid() = user_id);

-- Done! You should now see "profiles" and "results" under
-- Table Editor in your Supabase dashboard.
