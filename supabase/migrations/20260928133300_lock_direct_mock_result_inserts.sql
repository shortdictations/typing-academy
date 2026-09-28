-- Mock results must be created by complete_mock_session(), which validates
-- ownership/status of the in-progress session and writes the result atomically.
DROP POLICY IF EXISTS "Users can insert mock_test_results if allowed"
ON public.mock_test_results;
