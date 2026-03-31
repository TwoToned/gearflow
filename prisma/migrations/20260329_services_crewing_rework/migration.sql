-- AlterTable: Add suggestedCrewRoles to Category
ALTER TABLE "category" ADD COLUMN IF NOT EXISTS "suggestedCrewRoles" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Drop old unique constraint on CrewAssignment (projectId, crewMemberId, phase)
DROP INDEX IF EXISTS "crew_assignment_projectId_crewMemberId_phase_key";

-- Create partial unique index: one crew member per service per project
CREATE UNIQUE INDEX "crew_assignment_project_member_service_key"
  ON "crew_assignment" ("projectId", "crewMemberId", "serviceId")
  WHERE "serviceId" IS NOT NULL;
