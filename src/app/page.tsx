import { redirect } from "next/navigation";

export default function Home() {
  // Dashboard is the landing page again (Today hidden, D10C).
  redirect("/dashboard");
}
