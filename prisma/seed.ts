/**
 * Dev seed — minimal.
 *
 * Domain data (projects, models, assets, kits, sub-hires, …) is Convex-native
 * now, so this seed only bootstraps the KEPT auth/org tables: one Organization
 * plus one admin User + Member so the app has something to log in against.
 * Seed domain data via the app.
 *
 * Idempotent: keyed off the org slug and the user email. Running twice is a no-op.
 *
 * Run with: `npm run seed`.
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { createId } from "@paralleldrive/cuid2";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const ORG_SLUG = "seed-org";
const ORG_NAME = "Seed Org";
const ADMIN_EMAIL = "admin@seed.local";

async function main() {
  console.log("[seed] starting");

  // ── Organization (find or create) ─────────────────────────────────────
  let org = await prisma.organization.findFirst({ where: { slug: ORG_SLUG } });
  if (!org) {
    org = await prisma.organization.create({
      data: {
        id: createId(),
        name: ORG_NAME,
        slug: ORG_SLUG,
        createdAt: new Date(),
      },
    });
    console.log(`[seed] created organization ${org.name} (${org.id})`);
  } else {
    console.log(`[seed] organization ${org.name} already exists (${org.id})`);
  }

  // ── Admin User (find or create) ───────────────────────────────────────
  let user = await prisma.user.findFirst({ where: { email: ADMIN_EMAIL } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        id: createId(),
        email: ADMIN_EMAIL,
        name: "Seed Admin",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    console.log(`[seed] created user ${user.email} (${user.id})`);
  } else {
    console.log(`[seed] user ${user.email} already exists (${user.id})`);
  }

  // ── Membership (find or create) ───────────────────────────────────────
  const member = await prisma.member.findFirst({
    where: { organizationId: org.id, userId: user.id },
  });
  if (!member) {
    await prisma.member.create({
      data: {
        id: createId(),
        userId: user.id,
        organizationId: org.id,
        role: "owner",
        createdAt: new Date(),
      },
    });
    console.log(`[seed] linked ${user.email} as owner of ${org.name}`);
  }

  console.log("[seed] done — Domain data is Convex-native; seed domain data via the app.");
}

main()
  .catch((e) => {
    console.error("[seed] failed", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
