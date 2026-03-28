-- CreateTable
CREATE TABLE "project_category" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_group" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "categoryId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "price" DOUBLE PRECISION,
    "suggestedPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rentalPeriod" TEXT,
    "rentalQuantity" INTEGER,
    "billingWeeks" INTEGER,
    "billingDays" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_manager" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'manager',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_manager_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_template" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_template_item" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "group_template_item_pkey" PRIMARY KEY ("id")
);

-- AlterTable: add billing weeks/days to project
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "billingWeeks" INTEGER,
ADD COLUMN IF NOT EXISTS "billingDays" INTEGER;

-- AlterTable: add categoryId and groupId to line items
ALTER TABLE "project_line_item" ADD COLUMN IF NOT EXISTS "categoryId" TEXT,
ADD COLUMN IF NOT EXISTS "groupId" TEXT;

-- CreateIndex
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

-- AddForeignKey
ALTER TABLE "project_category" ADD CONSTRAINT "project_category_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_category" ADD CONSTRAINT "project_category_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_group" ADD CONSTRAINT "project_group_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_group" ADD CONSTRAINT "project_group_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_group" ADD CONSTRAINT "project_group_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "project_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "project_manager" ADD CONSTRAINT "project_manager_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_manager" ADD CONSTRAINT "project_manager_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_manager" ADD CONSTRAINT "project_manager_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "group_template" ADD CONSTRAINT "group_template_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "group_template_item" ADD CONSTRAINT "group_template_item_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "group_template"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_template_item" ADD CONSTRAINT "group_template_item_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "model"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_template_item" ADD CONSTRAINT "group_template_item_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_line_item" ADD CONSTRAINT "project_line_item_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "project_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_line_item" ADD CONSTRAINT "project_line_item_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "project_group"("id") ON DELETE SET NULL ON UPDATE CASCADE;
