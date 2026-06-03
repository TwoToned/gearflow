-- CreateEnum
CREATE TYPE "CrewMemberType" AS ENUM ('EMPLOYEE', 'FREELANCER', 'CONTRACTOR', 'VOLUNTEER');

-- CreateEnum
CREATE TYPE "CrewMemberStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ON_LEAVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CrewRateType" AS ENUM ('HOURLY', 'DAILY', 'FLAT');

-- CreateEnum
CREATE TYPE "CrewCertStatus" AS ENUM ('CURRENT', 'EXPIRING_SOON', 'EXPIRED', 'NOT_VERIFIED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('PENDING', 'OFFERED', 'ACCEPTED', 'DECLINED', 'CONFIRMED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ProjectPhase" AS ENUM ('BUMP_IN', 'EVENT', 'BUMP_OUT', 'DELIVERY', 'PICKUP', 'SETUP', 'REHEARSAL', 'FULL_DURATION');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "AvailabilityType" AS ENUM ('UNAVAILABLE', 'TENTATIVE', 'PREFERRED');

-- CreateEnum
CREATE TYPE "TimeEntryStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'DISPUTED', 'EXPORTED');

-- CreateTable
CREATE TABLE "crew_role" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "department" TEXT,
    "color" TEXT,
    "defaultRate" DECIMAL(10,2),
    "rateType" "CrewRateType",
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "crew_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crew_member" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "image" TEXT,
    "userId" TEXT,
    "type" "CrewMemberType" NOT NULL DEFAULT 'FREELANCER',
    "status" "CrewMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "department" TEXT,
    "defaultDayRate" DECIMAL(10,2),
    "defaultHourlyRate" DECIMAL(10,2),
    "overtimeMultiplier" DECIMAL(3,2),
    "currency" TEXT,
    "address" TEXT,
    "addressLatitude" DOUBLE PRECISION,
    "addressLongitude" DOUBLE PRECISION,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "abnOrGst" TEXT,
    "notes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "icalEnabled" BOOLEAN NOT NULL DEFAULT false,
    "icalToken" TEXT,
    "crewRoleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "crew_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crew_skill" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,

    CONSTRAINT "crew_skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crew_certification" (
    "id" TEXT NOT NULL,
    "crewMemberId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuedBy" TEXT,
    "certificateNumber" TEXT,
    "issuedDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "status" "CrewCertStatus" NOT NULL DEFAULT 'NOT_VERIFIED',

    CONSTRAINT "crew_certification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crew_assignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "crewMemberId" TEXT NOT NULL,
    "crewRoleId" TEXT,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "phase" "ProjectPhase",
    "isProjectManager" BOOLEAN NOT NULL DEFAULT false,
    "startDate" TIMESTAMP(3),
    "startTime" TEXT,
    "endDate" TIMESTAMP(3),
    "endTime" TEXT,
    "rateOverride" DECIMAL(10,2),
    "rateType" "CrewRateType",
    "estimatedHours" DECIMAL(6,2),
    "estimatedCost" DECIMAL(10,2),
    "notes" TEXT,
    "internalNotes" TEXT,
    "responseToken" TEXT,
    "offeredAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "responseNote" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crew_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crew_shift" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "callTime" TEXT,
    "endTime" TEXT,
    "breakMinutes" INTEGER,
    "location" TEXT,
    "notes" TEXT,
    "status" "ShiftStatus" NOT NULL DEFAULT 'SCHEDULED',

    CONSTRAINT "crew_shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crew_availability" (
    "id" TEXT NOT NULL,
    "crewMemberId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "type" "AvailabilityType" NOT NULL DEFAULT 'UNAVAILABLE',
    "reason" TEXT,
    "isAllDay" BOOLEAN NOT NULL DEFAULT true,
    "startTime" TEXT,
    "endTime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crew_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crew_time_entry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "crewMemberId" TEXT NOT NULL,
    "description" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "totalHours" DECIMAL(6,2),
    "status" "TimeEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crew_time_entry_pkey" PRIMARY KEY ("id")
);

-- Implicit many-to-many: CrewMember <-> CrewSkill
CREATE TABLE "_CrewMemberToCrewSkill" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_CrewMemberToCrewSkill_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "crew_role_organizationId_name_key" ON "crew_role"("organizationId", "name");
CREATE INDEX "crew_role_organizationId_idx" ON "crew_role"("organizationId");

CREATE UNIQUE INDEX "crew_member_icalToken_key" ON "crew_member"("icalToken");
CREATE UNIQUE INDEX "crew_member_organizationId_email_key" ON "crew_member"("organizationId", "email");
CREATE INDEX "crew_member_organizationId_idx" ON "crew_member"("organizationId");
CREATE INDEX "crew_member_organizationId_status_idx" ON "crew_member"("organizationId", "status");
CREATE INDEX "crew_member_userId_idx" ON "crew_member"("userId");

CREATE UNIQUE INDEX "crew_skill_organizationId_name_key" ON "crew_skill"("organizationId", "name");
CREATE INDEX "crew_skill_organizationId_idx" ON "crew_skill"("organizationId");

CREATE INDEX "crew_certification_crewMemberId_idx" ON "crew_certification"("crewMemberId");

CREATE UNIQUE INDEX "crew_assignment_responseToken_key" ON "crew_assignment"("responseToken");
CREATE UNIQUE INDEX "crew_assignment_projectId_crewMemberId_phase_key" ON "crew_assignment"("projectId", "crewMemberId", "phase");
CREATE INDEX "crew_assignment_organizationId_idx" ON "crew_assignment"("organizationId");
CREATE INDEX "crew_assignment_projectId_idx" ON "crew_assignment"("projectId");
CREATE INDEX "crew_assignment_crewMemberId_idx" ON "crew_assignment"("crewMemberId");
CREATE INDEX "crew_assignment_crewMemberId_startDate_idx" ON "crew_assignment"("crewMemberId", "startDate");

CREATE INDEX "crew_shift_assignmentId_idx" ON "crew_shift"("assignmentId");
CREATE INDEX "crew_shift_assignmentId_date_idx" ON "crew_shift"("assignmentId", "date");

CREATE INDEX "crew_availability_crewMemberId_idx" ON "crew_availability"("crewMemberId");
CREATE INDEX "crew_availability_crewMemberId_startDate_endDate_idx" ON "crew_availability"("crewMemberId", "startDate", "endDate");

CREATE INDEX "crew_time_entry_organizationId_idx" ON "crew_time_entry"("organizationId");
CREATE INDEX "crew_time_entry_assignmentId_idx" ON "crew_time_entry"("assignmentId");
CREATE INDEX "crew_time_entry_crewMemberId_date_idx" ON "crew_time_entry"("crewMemberId", "date");

CREATE INDEX "_CrewMemberToCrewSkill_B_index" ON "_CrewMemberToCrewSkill"("B");

-- AddForeignKey
ALTER TABLE "crew_role" ADD CONSTRAINT "crew_role_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "crew_member" ADD CONSTRAINT "crew_member_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crew_member" ADD CONSTRAINT "crew_member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crew_member" ADD CONSTRAINT "crew_member_crewRoleId_fkey" FOREIGN KEY ("crewRoleId") REFERENCES "crew_role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "crew_skill" ADD CONSTRAINT "crew_skill_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "crew_certification" ADD CONSTRAINT "crew_certification_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "crew_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "crew_assignment" ADD CONSTRAINT "crew_assignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crew_assignment" ADD CONSTRAINT "crew_assignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crew_assignment" ADD CONSTRAINT "crew_assignment_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "crew_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crew_assignment" ADD CONSTRAINT "crew_assignment_crewRoleId_fkey" FOREIGN KEY ("crewRoleId") REFERENCES "crew_role"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crew_assignment" ADD CONSTRAINT "crew_assignment_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "crew_shift" ADD CONSTRAINT "crew_shift_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "crew_assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "crew_availability" ADD CONSTRAINT "crew_availability_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "crew_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "crew_time_entry" ADD CONSTRAINT "crew_time_entry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crew_time_entry" ADD CONSTRAINT "crew_time_entry_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "crew_assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crew_time_entry" ADD CONSTRAINT "crew_time_entry_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "crew_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crew_time_entry" ADD CONSTRAINT "crew_time_entry_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "_CrewMemberToCrewSkill" ADD CONSTRAINT "_CrewMemberToCrewSkill_A_fkey" FOREIGN KEY ("A") REFERENCES "crew_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_CrewMemberToCrewSkill" ADD CONSTRAINT "_CrewMemberToCrewSkill_B_fkey" FOREIGN KEY ("B") REFERENCES "crew_skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
