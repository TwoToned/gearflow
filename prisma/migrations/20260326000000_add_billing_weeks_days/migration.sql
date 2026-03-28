-- ============================================================================
-- Complete migration for project finance rewrite
-- Creates new tables and adds columns to existing tables
-- All statements use IF NOT EXISTS / IF EXISTS for idempotent re-runs
-- ============================================================================

-- ─── New enum type ──────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "RentalPeriod" AS ENUM ('DAILY', 'WEEKLY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── New columns on existing tables ─────────────────────────────────────────

-- Organization: default tax rate
ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "defaultTaxRate" DECIMAL(5,2);

-- Site settings: default tax rate
ALTER TABLE "site_settings" ADD COLUMN IF NOT EXISTS "defaultTaxRate" DOUBLE PRECISION DEFAULT 10;

-- Model: daily/weekly rates
ALTER TABLE "model" ADD COLUMN IF NOT EXISTS "dailyRate" DECIMAL(10,2);
ALTER TABLE "model" ADD COLUMN IF NOT EXISTS "weeklyRate" DECIMAL(10,2);

-- Project: finance fields
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "defaultRentalPeriod" "RentalPeriod";
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "defaultRentalQuantity" INTEGER;
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "billingWeeks" INTEGER;
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "billingDays" INTEGER;
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "taxRate" DECIMAL(5,2);
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "equipmentRevenue" DECIMAL(12,2);
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "serviceCostTotal" DECIMAL(12,2);
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "labourCostTotal" DECIMAL(12,2);
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "margin" DECIMAL(12,2);

-- Project line item: category/group refs
ALTER TABLE "project_line_item" ADD COLUMN IF NOT EXISTS "categoryId" TEXT;
ALTER TABLE "project_line_item" ADD COLUMN IF NOT EXISTS "groupId" TEXT;

-- Project service: finance fields
ALTER TABLE "project_service" ADD COLUMN IF NOT EXISTS "billableToClient" BOOLEAN DEFAULT false;
ALTER TABLE "project_service" ADD COLUMN IF NOT EXISTS "costTotal" DECIMAL(12,2);

-- ─── New tables ─────────────────────────────────────────────────────────────

-- ProjectCategory
CREATE TABLE IF NOT EXISTS "project_category" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_category_pkey" PRIMARY KEY ("id")
);

-- ProjectGroup
CREATE TABLE IF NOT EXISTS "project_group" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "price" DECIMAL(12,2),
    "suggestedPrice" DECIMAL(12,2),
    "rentalPeriod" "RentalPeriod",
    "rentalQuantity" INTEGER,
    "billingWeeks" INTEGER,
    "billingDays" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_group_pkey" PRIMARY KEY ("id")
);

-- ProjectManager
CREATE TABLE IF NOT EXISTS "project_manager" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_manager_pkey" PRIMARY KEY ("id")
);

-- GroupTemplate
CREATE TABLE IF NOT EXISTS "group_template" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "group_template_pkey" PRIMARY KEY ("id")
);

-- GroupTemplateItem
CREATE TABLE IF NOT EXISTS "group_template_item" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "group_template_item_pkey" PRIMARY KEY ("id")
);

-- ─── Fix existing tables if created with wrong column types ─────────────────

-- project_manager: drop wrong "role" column if it exists, add "addedAt" if missing
ALTER TABLE "project_manager" DROP COLUMN IF EXISTS "role";
ALTER TABLE "project_manager" DROP COLUMN IF EXISTS "createdAt";
ALTER TABLE "project_manager" ADD COLUMN IF NOT EXISTS "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- project_category: add updatedAt if missing
ALTER TABLE "project_category" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- project_group: add updatedAt if missing, fix categoryId to NOT NULL if needed
ALTER TABLE "project_group" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- group_template: add updatedAt if missing
ALTER TABLE "group_template" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- project_group: fix column types if created with wrong types (DOUBLE PRECISION → DECIMAL)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_group' AND column_name = 'price' AND data_type = 'double precision'
  ) THEN
    ALTER TABLE "project_group" ALTER COLUMN "price" TYPE DECIMAL(12,2);
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_group' AND column_name = 'suggestedPrice' AND data_type = 'double precision'
  ) THEN
    ALTER TABLE "project_group" ALTER COLUMN "suggestedPrice" TYPE DECIMAL(12,2);
    ALTER TABLE "project_group" ALTER COLUMN "suggestedPrice" DROP NOT NULL;
    ALTER TABLE "project_group" ALTER COLUMN "suggestedPrice" DROP DEFAULT;
  END IF;
END $$;

-- ─── Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "project_category_projectId_idx" ON "project_category"("projectId");
CREATE INDEX IF NOT EXISTS "project_category_organizationId_idx" ON "project_category"("organizationId");

CREATE INDEX IF NOT EXISTS "project_group_projectId_idx" ON "project_group"("projectId");
CREATE INDEX IF NOT EXISTS "project_group_categoryId_idx" ON "project_group"("categoryId");
CREATE INDEX IF NOT EXISTS "project_group_organizationId_idx" ON "project_group"("organizationId");

CREATE INDEX IF NOT EXISTS "project_manager_projectId_idx" ON "project_manager"("projectId");
CREATE INDEX IF NOT EXISTS "project_manager_userId_idx" ON "project_manager"("userId");
CREATE INDEX IF NOT EXISTS "project_manager_organizationId_idx" ON "project_manager"("organizationId");

CREATE INDEX IF NOT EXISTS "group_template_organizationId_idx" ON "group_template"("organizationId");

CREATE INDEX IF NOT EXISTS "group_template_item_templateId_idx" ON "group_template_item"("templateId");
CREATE INDEX IF NOT EXISTS "group_template_item_modelId_idx" ON "group_template_item"("modelId");
CREATE INDEX IF NOT EXISTS "group_template_item_organizationId_idx" ON "group_template_item"("organizationId");

CREATE INDEX IF NOT EXISTS "project_line_item_categoryId_idx" ON "project_line_item"("categoryId");
CREATE INDEX IF NOT EXISTS "project_line_item_groupId_idx" ON "project_line_item"("groupId");

-- Unique constraint on project_manager
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_manager_projectId_userId_key'
  ) THEN
    ALTER TABLE "project_manager" ADD CONSTRAINT "project_manager_projectId_userId_key" UNIQUE ("projectId", "userId");
  END IF;
END $$;

-- ─── Foreign Keys ───────────────────────────────────────────────────────────

DO $$ BEGIN ALTER TABLE "project_category" ADD CONSTRAINT "project_category_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "project_category" ADD CONSTRAINT "project_category_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "project_group" ADD CONSTRAINT "project_group_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "project_group" ADD CONSTRAINT "project_group_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "project_group" ADD CONSTRAINT "project_group_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "project_category"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "project_manager" ADD CONSTRAINT "project_manager_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "project_manager" ADD CONSTRAINT "project_manager_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "project_manager" ADD CONSTRAINT "project_manager_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "group_template" ADD CONSTRAINT "group_template_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "group_template_item" ADD CONSTRAINT "group_template_item_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "group_template"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "group_template_item" ADD CONSTRAINT "group_template_item_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "model"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "group_template_item" ADD CONSTRAINT "group_template_item_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "project_line_item" ADD CONSTRAINT "project_line_item_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "project_category"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "project_line_item" ADD CONSTRAINT "project_line_item_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "project_group"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
