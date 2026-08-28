import { redirect } from "next/navigation";

/**
 * A company's front door is what is going out, not what it is made of.
 *
 * Overview keeps its own URL so the tab can stay put and be linked to; this
 * only decides where /c/<id> lands.
 */
export default async function CompanyHome({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  redirect(`/c/${companyId}/overview`);
}
