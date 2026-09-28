-- A credit unlock is a permanent record that the user has already paid/used
-- a credit for this mock. Enforce one unlock per user/mock even under races.
CREATE UNIQUE INDEX IF NOT EXISTS mock_unlocks_user_mock_uidx
ON public.mock_unlocks(user_id, mock_test_id);