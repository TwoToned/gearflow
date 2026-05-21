-- Wave 3: operator-defined custom fields.
--
-- CustomFieldDefinition adds a form input to an entity; the value lands in
-- that entity's existing customFieldValues JSON column keyed by fieldKey.
-- v1 wires ASSET; the entityType enum is forward-compat for KIT / PROJECT /
-- BULK_ASSET.

CREATE TYPE "CustomFieldEntity" AS ENUM ('ASSET', 'BULK_ASSET', 'KIT', 'PROJECT');

CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'SELECT', 'BOOLEAN');

CREATE TABLE "custom_field_definition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType" "CustomFieldEntity" NOT NULL DEFAULT 'ASSET',
    "label" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "fieldType" "CustomFieldType" NOT NULL DEFAULT 'TEXT',
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT false,
    "helpText" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_field_definition_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "custom_field_definition_organizationId_entityType_idx"
    ON "custom_field_definition"("organizationId", "entityType");

CREATE UNIQUE INDEX "custom_field_definition_organizationId_entityType_fieldKey_key"
    ON "custom_field_definition"("organizationId", "entityType", "fieldKey");

ALTER TABLE "custom_field_definition"
    ADD CONSTRAINT "custom_field_definition_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
