import { prisma } from "@/lib/db";
import { headers } from "next/headers";
import { guardCompany } from "@/lib/guard";
import { ConnectorPanel } from "./ConnectorPanel";

export const dynamic = "force-dynamic";

/**
 * The connector, on a page of its own.
 *
 * It used to sit under Integrations, beside the Shopify and Klaviyo panels,
 * and read as belonging to whichever company's settings you happened to be
 * looking at -- which is the first thing anyone asked about it. A token is
 * personal and reaches every company its owner belongs to, so it lives under
 * your own name instead, and the page says which companies those are rather
 * than leaving you to take its word for it.
 */
export default async function ConnectorPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const access = await guardCompany(companyId);

  const [tokens, memberships] = await Promise.all([
    prisma.apiToken.findMany({
      where: { userId: access.user.id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.membership.findMany({
      where: { userId: access.user.id },
      include: { company: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Claude connector</h1>
          <p>Write campaign content in Claude and have it land here.</p>
        </div>
      </div>

      <ConnectorPanel
        companyId={companyId}
        origin={await selfOrigin()}
        reaches={memberships.map((m) => ({ name: m.company.name, role: m.role }))}
        tokens={tokens.map((t) => ({
          id: t.id,
          label: t.label,
          prefix: t.prefix,
          createdAt: t.createdAt.toISOString(),
          lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
          revokedAt: t.revokedAt?.toISOString() ?? null,
        }))}
      />
    </main>
  );
}

/**
 * Where this app is being served from, so the panel shows a URL that actually
 * works rather than one typed into an environment variable and forgotten.
 * Behind Railway's proxy the forwarded headers are the only honest answer.
 */
async function selfOrigin(): Promise<string> {
  const head = await headers();
  const host = head.get("x-forwarded-host") ?? head.get("host") ?? "localhost:3000";
  const proto = head.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
