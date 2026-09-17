import { redirect } from "next/navigation";

export default function Home() {
  // Today, not Dashboard, is the landing page (work-layer phase 0.5, #1242, D10A).
  redirect("/today");
}
