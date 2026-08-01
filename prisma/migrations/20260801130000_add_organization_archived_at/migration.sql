-- Orgs are archived, never deleted (D12, #1075/A5) — reversible.
ALTER TABLE "organization" ADD COLUMN "archivedAt" TIMESTAMP(3);
