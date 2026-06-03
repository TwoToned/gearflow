-- CreateIndex
CREATE INDEX "crew_assignment_crewMemberId_startDate_endDate_idx" ON "crew_assignment"("crewMemberId", "startDate", "endDate");
