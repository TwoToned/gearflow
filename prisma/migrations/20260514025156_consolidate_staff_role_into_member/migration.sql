-- Wave 2: consolidate the `staff` role into `member`.
--
-- The audit found that `staff` and `member` had IDENTICAL permissions across
-- all 16 resources. `staff` has been removed from the rolePermissions map,
-- VALID_BUILT_IN_ROLES, memberRoleHierarchy, sso-provisioning ROLE_HIERARCHY,
-- and every UI dropdown. This migration converts any remaining staff members
-- to member so they continue to function with no behavior change (they had the
-- same permissions all along).
--
-- Custom roles named "staff:*" are unaffected — only the built-in `staff`
-- role is consolidated.

UPDATE "member"
SET "role" = 'member'
WHERE "role" = 'staff';
