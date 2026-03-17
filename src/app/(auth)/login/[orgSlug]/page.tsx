import { notFound } from "next/navigation";
import { getOrgLoginInfo } from "@/server/sso";
import { OrgLoginClient } from "./client";

interface Props {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ email?: string }>;
}

export default async function OrgLoginPage({ params, searchParams }: Props) {
  const { orgSlug } = await params;
  const { email } = await searchParams;

  const orgInfo = await getOrgLoginInfo(orgSlug);
  if (!orgInfo) notFound();

  return <OrgLoginClient orgInfo={orgInfo} initialEmail={email} />;
}
