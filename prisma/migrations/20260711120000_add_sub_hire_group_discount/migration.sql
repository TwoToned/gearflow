-- Add a percentage discount to sub-hire groups (applied to the group charge,
-- client side — mirrors SubHireItem.discount). NOT NULL DEFAULT 0 is a
-- metadata-only add in Postgres (constant default), so no table rewrite and no
-- ANALYZE needed (row-count statistics are unchanged).
ALTER TABLE "sub_hire_group" ADD COLUMN "discount" DECIMAL(5,2) NOT NULL DEFAULT 0;
