import { headers } from "next/headers";
import { auth } from "./auth";
import { getTheOrg } from "./single-org";

export async function getSession() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  return session;
}

export async function requireSession() {
  const session = await getSession();
  if (!session) {
    throw new Error("Unauthorized");
  }
  return session;
}

export async function getActiveOrganizationId() {
  const org = await getTheOrg();
  return org?.id ?? null;
}

export async function requireOrganization() {
  const session = await requireSession();
  const org = await getTheOrg();
  if (!org) {
    throw new Error("No organization configured. Please complete setup.");
  }
  return { session, organizationId: org.id };
}
