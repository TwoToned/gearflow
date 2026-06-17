-- Phase B: drop FK constraints for project_category, project_group, category_slot.
-- These tables are being moved to Convex-only storage. All columns stay as plain
-- strings; referential integrity is enforced by application code.

-- category_slot FK constraints (Cascade → now plain strings)
ALTER TABLE "category_slot" DROP CONSTRAINT IF EXISTS "category_slot_projectCategoryId_fkey";
ALTER TABLE "category_slot" DROP CONSTRAINT IF EXISTS "category_slot_projectGroupId_fkey";
ALTER TABLE "category_slot" DROP CONSTRAINT IF EXISTS "category_slot_subHireGroupId_fkey";

-- project_category FK constraints
ALTER TABLE "project_category" DROP CONSTRAINT IF EXISTS "project_category_organizationId_fkey";
ALTER TABLE "project_category" DROP CONSTRAINT IF EXISTS "project_category_projectId_fkey";

-- project_group FK constraints
ALTER TABLE "project_group" DROP CONSTRAINT IF EXISTS "project_group_categoryId_fkey";
ALTER TABLE "project_group" DROP CONSTRAINT IF EXISTS "project_group_organizationId_fkey";
ALTER TABLE "project_group" DROP CONSTRAINT IF EXISTS "project_group_projectId_fkey";

-- project_line_item FK constraints referencing category/group
ALTER TABLE "project_line_item" DROP CONSTRAINT IF EXISTS "project_line_item_categoryId_fkey";
ALTER TABLE "project_line_item" DROP CONSTRAINT IF EXISTS "project_line_item_groupId_fkey";

-- sub_hire FK constraints referencing category/group
ALTER TABLE "sub_hire" DROP CONSTRAINT IF EXISTS "sub_hire_defaultTargetCategoryId_fkey";
ALTER TABLE "sub_hire" DROP CONSTRAINT IF EXISTS "sub_hire_defaultTargetGroupId_fkey";

-- sub_hire_group FK constraints referencing category/group
ALTER TABLE "sub_hire_group" DROP CONSTRAINT IF EXISTS "sub_hire_group_targetCategoryId_fkey";
ALTER TABLE "sub_hire_group" DROP CONSTRAINT IF EXISTS "sub_hire_group_targetGroupId_fkey";

-- sub_hire_item FK constraints referencing category/group
ALTER TABLE "sub_hire_item" DROP CONSTRAINT IF EXISTS "sub_hire_item_targetCategoryId_fkey";
ALTER TABLE "sub_hire_item" DROP CONSTRAINT IF EXISTS "sub_hire_item_targetGroupId_fkey";
