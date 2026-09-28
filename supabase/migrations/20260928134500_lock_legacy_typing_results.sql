-- typing_results is a retired practice table. Current mock results use
-- complete_mock_session() -> mock_test_results instead.
-- Prevent authenticated clients from fabricating legacy result rows.
DROP POLICY IF EXISTS "Users can insert own typing_results"
ON public.typing_results;
