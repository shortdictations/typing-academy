# Notifications system — database notes

Applied directly to the live database (project myjljedcniprjgxycdcl)
this session via a proper migration, following the exact patterns
already established by the `announcements`/`admins` tables.

## New tables
- `notifications` — admin-managed content (title, message, type,
  action_text/action_url, target_audience, expires_at, is_active,
  play_sound). RLS: any authenticated user can SELECT active,
  non-expired, audience-matching rows (or everything, if admin);
  only admins can INSERT/UPDATE/DELETE — same `EXISTS (SELECT 1 FROM
  admins WHERE admins.user_id = auth.uid())` pattern already used by
  `announcements`/`mock_tests`/`products`.
- `notification_user_state` — per-user read/cleared state, one row
  per (notification_id, user_id) once a user has actually interacted
  with a notification. RLS: strictly the user's own rows only, no
  admin access — this is genuinely private state, not admin content.

## Reused existing infrastructure
- `user_preferences.notification_sound` — added as a column on the
  *existing* table (already held target_wpm, onboarding_completed)
  rather than creating a new table for one boolean.
- Target audience matching reuses the *existing* `user_passes` table
  and its real SSC/LEGAL/COMBO pass_type values — no new taxonomy.

## Verified directly against the live database this session
- All 7 RLS policies confirmed present via `pg_policies`
- Inserted two real test notifications and confirmed correct return
  data
- Confirmed the admin form's payload inserts successfully against
  the real schema
