-- ============================================================
-- Run this in Supabase SQL Editor (SQL Editor -> New query -> paste -> Run)
-- Creates the typing_results table used for result tracking.
-- ============================================================

create table if not exists typing_results (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  passage_title text,
  wpm numeric not null,
  accuracy numeric not null,
  errors int not null,
  duration int not null,           -- test duration in minutes (5 or 10)
  created_at timestamp with time zone default now()
);

alter table typing_results enable row level security;

-- A student can only see their own results
create policy "Users can view own typing_results"
  on typing_results for select
  using (auth.uid() = user_id);

-- A student can only insert results under their own user_id
create policy "Users can insert own typing_results"
  on typing_results for insert
  with check (auth.uid() = user_id);

-- Speeds up "last 10 results for this user, newest first" queries
create index if not exists typing_results_user_created_idx
  on typing_results (user_id, created_at desc);
