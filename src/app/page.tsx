import { redirect } from "next/navigation";
import { getCurrentUser, listCompaniesForUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const companies = await listCompaniesForUser(user.id);
  if (companies.length === 1) redirect(`/c/${companies[0].id}`);
  redirect("/companies");
}
