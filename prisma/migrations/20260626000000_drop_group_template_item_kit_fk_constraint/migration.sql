-- Drop the missed group_template_item.kitId -> kit FK constraint.
--
-- Kit was inverted to Convex-only (Phase C keystone). The other group_template_item
-- FKs were dropped earlier (templateId in 20260617131400, modelId in 20260617131200),
-- but kitId was missed — its constraint is still live from 20260415070000. Left in
-- place, `DROP TABLE "kit" CASCADE` (Stage 4 teardown) would silently drop it and
-- orphan group_template_item.kitId values. kitId now becomes a plain external id
-- holding the Convex cuid (matching templateId/modelId). Column + index stay.
ALTER TABLE "group_template_item" DROP CONSTRAINT IF EXISTS "group_template_item_kitId_fkey";
