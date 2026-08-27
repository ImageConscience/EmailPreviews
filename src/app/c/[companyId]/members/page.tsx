import { prisma } from "@/lib/db";
import { guardCompany } from "@/lib/guard";
import { MembersPanel } from "./MembersPanel";

export const dynamic = "force-dynamic";

export default async function MembersPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const access = await guardCompany(companyId);

  const [memberships, invites] = await Promise.all([
    prisma.membership.findMany({
      where: { companyId },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.invite.findMany({
      where: { companyId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Team</h1>
          <p>Everyone here shares {access.companyName}&rsquo;s templates and content.</p>
        </div>
      </div>

      <MembersPanel
        companyId={companyId}
        currentUserId={access.user.id}
        currentRole={access.role}
        members={memberships.map((m) => ({
          id: m.id,
          userId: m.userId,
          name: m.user.name ?? m.user.email,
          email: m.user.email,
          role: m.role,
          joinedAt: m.createdAt.toISOString().slice(0, 10),
        }))}
        invites={invites.map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role,
          token: i.token,
          expiresAt: i.expiresAt.toISOString().slice(0, 10),
        }))}
      />
    </main>
  );
}
