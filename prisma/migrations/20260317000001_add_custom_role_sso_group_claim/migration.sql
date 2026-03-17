-- AlterTable: add ssoGroupClaim to custom_role for SSO group matching
ALTER TABLE "custom_role" ADD COLUMN "ssoGroupClaim" TEXT;
