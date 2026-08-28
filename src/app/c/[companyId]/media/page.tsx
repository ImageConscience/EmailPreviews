import { guardCompany } from "@/lib/guard";
import { listMediaAction } from "@/actions/media";
import { MediaLibrary } from "./MediaLibrary";

export const dynamic = "force-dynamic";

export default async function MediaPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const access = await guardCompany(companyId);
  const items = await listMediaAction(companyId);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Images</h1>
          <p>
            Anyone on {access.companyName} can upload here, and each image gets a permanent
            public link to use in a campaign.
          </p>
        </div>
      </div>
      <MediaLibrary companyId={companyId} items={items} canDelete={access.role !== "member"} />
    </main>
  );
}
