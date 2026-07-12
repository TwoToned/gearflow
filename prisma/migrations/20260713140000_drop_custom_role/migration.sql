-- Drop the custom_role table. The custom-role feature was removed entirely (built-in
-- roles only); all code paths that read/wrote it are gone (PR feat/drop-customrole),
-- and the table was 0 rows on prod. The Convex `customRoles` mirror table is removed
-- in the same change (schema deploy). No data migration — the table is empty.
DROP TABLE IF EXISTS "custom_role";
