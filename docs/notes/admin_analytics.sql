-- ============================================================
-- Admin Overview / Analytics — run this ONCE in your Supabase
-- project's SQL Editor (Dashboard -> SQL Editor -> New query ->
-- paste -> Run), same as setup-database.sql / setup-passages-table.sql.
--
-- IMPORTANT: I was not able to apply this migration directly this
-- session (no live Supabase tool access), so this file needs to be
-- run manually before the analytics section will return real data.
-- Everything below was written against the ACTUAL schema already in
-- use elsewhere in this project — verified directly against the real
-- insert/query code in js/mock-test-attempt.js, js/auth.js, and
-- supabase/functions/_shared/fulfill.ts and
-- supabase/functions/create-razorpay-order/index.ts — not assumed
-- or invented table/column names.
-- ============================================================

create or replace function admin_get_analytics_overview(p_period text default 'all')
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_period_start timestamptz;
  v_total_students bigint;
  v_active_students bigint;
  v_mock_tests_taken bigint;
  v_credits_consumed bigint;
  v_pass_sales bigint;
  v_revenue numeric;
  v_top_passages json;
begin
  -- Security (requirement 16): only a real admin — checked the same
  -- way every other admin gate in this project checks it, against
  -- the existing `admins` table — may ever get real numbers back.
  -- security definer + this internal check is what lets this be
  -- called safely from the browser without needing a service-role
  -- key anywhere near frontend code, exactly like the existing
  -- can_access_mock / start_mock_test RPCs already do.
  select exists(select 1 from admins where user_id = auth.uid()) into v_is_admin;
  if not v_is_admin then
    raise exception 'Not authorized';
  end if;

  -- Period boundary for the period-scoped metrics. Total Students
  -- stays all-time; Active Students always uses its own fixed 30-day
  -- window regardless of this filter (both per requirement 11).
  v_period_start := case p_period
    when 'today' then date_trunc('day', now())
    when 'last_7' then now() - interval '7 days'
    when 'last_30' then now() - interval '30 days'
    when 'this_month' then date_trunc('month', now())
    when 'this_year' then date_trunc('year', now())
    else null -- 'all'
  end;

  -- 1. TOTAL STUDENTS (all-time, admins excluded via the existing
  -- admins table — profiles has no role column, confirmed directly
  -- against setup-database.sql and the actual profile-insert in
  -- js/auth.js).
  select count(*) into v_total_students
  from profiles p
  where not exists (select 1 from admins a where a.user_id = p.id);

  -- 2. ACTIVE STUDENTS — meaningful activity in the last 30 days,
  -- defined here as: completed a mock test, made a successful
  -- purchase, or had a credit-ledger entry (covers both spending and
  -- receiving credits) in that window. No last_active_at column
  -- exists anywhere in this schema, so this is computed from the
  -- real activity tables directly rather than invented.
  select count(distinct uid) into v_active_students
  from (
    select user_id as uid from mock_test_results where created_at >= now() - interval '30 days'
    union
    select user_id as uid from purchase_transactions where status = 'paid' and paid_at >= now() - interval '30 days'
    union
    select user_id as uid from credit_transactions where created_at >= now() - interval '30 days'
  ) recent_activity
  where uid not in (select user_id from admins);

  -- 3. MOCK TESTS TAKEN — every row in mock_test_results IS a
  -- completed attempt by construction: this table is only ever
  -- inserted into from saveMockResult(), called at the end of
  -- endMockTest() once a test actually finishes (confirmed directly
  -- in js/mock-test-attempt.js) — merely opening a test never
  -- creates a row here, so no extra "completed" filter is needed.
  select count(*) into v_mock_tests_taken
  from mock_test_results
  where (v_period_start is null or created_at >= v_period_start);

  -- 4. CREDITS CONSUMED — credit_transactions is a ledger: positive
  -- rows are grants (transaction_type = 'credit_purchase', confirmed
  -- in fulfill.ts), negative rows are spends (written by the
  -- start_credit_test() RPC — its body isn't visible from the
  -- frontend code I could inspect, but "credits < 0" is the
  -- ledger-sign convention every other insert in this table already
  -- follows, so this is the correct signal for consumption rather
  -- than purchased-minus-remaining, which the brief explicitly warns
  -- against). If start_credit_test ever adds a transaction_type worth
  -- excluding here (e.g. an expiry write-off that also uses a
  -- negative value), add "and transaction_type = 'test_attempt'" (or
  -- whatever it actually is) to this WHERE clause.
  select coalesce(sum(abs(credits)), 0) into v_credits_consumed
  from credit_transactions
  where credits < 0
    and (v_period_start is null or created_at >= v_period_start);

  -- 5. PASS SALES — successful purchases only. status progresses
  -- 'created' -> 'paid' exactly once (confirmed in
  -- create-razorpay-order/index.ts and fulfill.ts's atomic claim
  -- step), so filtering to status = 'paid' already excludes
  -- created/failed/cancelled/pending by construction, and also
  -- excludes any 'refunded' status if one is ever introduced, since
  -- this only ever matches the literal 'paid' value.
  select count(*) into v_pass_sales
  from purchase_transactions
  where status = 'paid'
    and product_type = 'PASS'
    and (v_period_start is null or paid_at >= v_period_start);

  -- 6. REVENUE — the actual recorded `amount` column (the real
  -- database price fulfillment used), never a frontend price.
  select coalesce(sum(amount), 0) into v_revenue
  from purchase_transactions
  where status = 'paid'
    and (v_period_start is null or paid_at >= v_period_start);

  -- 7. MOST ATTEMPTED PASSAGES — passage_id/passage_title/category
  -- are denormalized directly onto mock_test_results at insert time
  -- (see js/mock-test-attempt.js), so this needs no join back to the
  -- passages table at all.
  select coalesce(json_agg(t), '[]'::json) into v_top_passages
  from (
    select passage_id, passage_title, category, count(*) as attempts
    from mock_test_results
    where (v_period_start is null or created_at >= v_period_start)
    group by passage_id, passage_title, category
    order by count(*) desc
    limit 10
  ) t;

  return json_build_object(
    'total_students', v_total_students,
    'active_students', v_active_students,
    'mock_tests_taken', v_mock_tests_taken,
    'credits_consumed', v_credits_consumed,
    'pass_sales', v_pass_sales,
    'revenue', v_revenue,
    'top_passages', v_top_passages
  );
end;
$$;

-- Callable by any authenticated user — safe because the function
-- checks admin status internally and raises an exception otherwise,
-- the exact same pattern the existing can_access_mock /
-- start_mock_test RPCs already use in this project. A non-admin
-- calling this gets an error, never real numbers.
grant execute on function admin_get_analytics_overview(text) to authenticated;
