-- CategorySlot: owns cross-type sort order for ProjectGroup + SubHireGroup
-- inside a ProjectCategory. Each slot points at exactly one group (XOR
-- enforced by CHECK constraint below — Prisma cannot express CHECK in
-- schema.prisma, so we add it here).
--
-- Backfill at the bottom seeds slot rows for every already-categorised
-- ProjectGroup and SubHireGroup. SubHireGroups with NULL targetCategoryId
-- get backfilled from their synthetic parent ProjectLineItem.categoryId
-- (the same category their parent line item already lives in), so the UI
-- shows the same grouping pre- and post-deploy.

-- CreateTable
CREATE TABLE "category_slot" (
    "id" TEXT NOT NULL,
    "projectCategoryId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "projectGroupId" TEXT,
    "subHireGroupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "category_slot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "category_slot_one_target_xor" CHECK (
        ("projectGroupId" IS NOT NULL AND "subHireGroupId" IS NULL)
        OR ("projectGroupId" IS NULL AND "subHireGroupId" IS NOT NULL)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "category_slot_projectGroupId_key" ON "category_slot"("projectGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "category_slot_subHireGroupId_key" ON "category_slot"("subHireGroupId");

-- CreateIndex
CREATE INDEX "category_slot_projectCategoryId_idx" ON "category_slot"("projectCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "category_slot_projectCategoryId_sortOrder_key" ON "category_slot"("projectCategoryId", "sortOrder");

-- AddForeignKey
ALTER TABLE "category_slot" ADD CONSTRAINT "category_slot_projectCategoryId_fkey" FOREIGN KEY ("projectCategoryId") REFERENCES "project_category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_slot" ADD CONSTRAINT "category_slot_projectGroupId_fkey" FOREIGN KEY ("projectGroupId") REFERENCES "project_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_slot" ADD CONSTRAINT "category_slot_subHireGroupId_fkey" FOREIGN KEY ("subHireGroupId") REFERENCES "sub_hire_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Backfill ────────────────────────────────────────────────────────────
-- Step 1: SubHireGroups with NULL targetCategoryId inherit category from
-- their synthetic parent ProjectLineItem (idempotent — no-op if already set).

UPDATE "sub_hire_group" sg
SET "targetCategoryId" = pli."categoryId"
FROM "project_line_item" pli
WHERE pli."subHireGroupId" = sg.id
  AND pli."isKitChild" = false
  AND sg."targetCategoryId" IS NULL
  AND pli."categoryId" IS NOT NULL;

-- Step 2: Create CategorySlot rows for every ProjectGroup. ProjectGroups
-- always have a category (NOT NULL FK), so all of them get a slot. sortOrder
-- comes from the existing per-table sortOrder column, namespaced to the
-- category. We multiply by 2 to leave gaps so the subsequent SubHireGroup
-- backfill can interleave without collisions.

INSERT INTO "category_slot" ("id", "projectCategoryId", "sortOrder", "projectGroupId", "createdAt", "updatedAt")
SELECT
  'cs_pg_' || pg.id,
  pg."categoryId",
  pg."sortOrder" * 2,
  pg.id,
  NOW(),
  NOW()
FROM "project_group" pg
WHERE NOT EXISTS (
  SELECT 1 FROM "category_slot" cs WHERE cs."projectGroupId" = pg.id
);

-- Step 3: Create CategorySlot rows for every categorised SubHireGroup.
-- Skip if already exists (idempotent). Slot sortOrder is (sg.sortOrder * 2 + 1)
-- so sub-hire groups interleave AFTER project groups with the same base
-- sort index, deterministic and collision-free on first backfill.

INSERT INTO "category_slot" ("id", "projectCategoryId", "sortOrder", "subHireGroupId", "createdAt", "updatedAt")
SELECT
  'cs_shg_' || sg.id,
  sg."targetCategoryId",
  sg."sortOrder" * 2 + 1,
  sg.id,
  NOW(),
  NOW()
FROM "sub_hire_group" sg
WHERE sg."targetCategoryId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "category_slot" cs WHERE cs."subHireGroupId" = sg.id
  );

-- Step 4: Compact sortOrder per category so values are contiguous 0,1,2,...
-- This makes subsequent reorder UPDATEs simpler and produces a clean
-- starting state. Uses a CTE with row_number() partitioned by category.

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "projectCategoryId"
      ORDER BY "sortOrder", "createdAt", id
    ) - 1 AS new_sort_order
  FROM "category_slot"
)
UPDATE "category_slot" cs
SET "sortOrder" = ranked.new_sort_order
FROM ranked
WHERE cs.id = ranked.id
  AND cs."sortOrder" <> ranked.new_sort_order;
