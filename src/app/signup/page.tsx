import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SignupForm } from "./SignupForm";

export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  if (await getCurrentUser()) redirect("/");
  const { invite: token } = await searchParams;

  const invite = token
    ? await prisma.invite.findUnique({ where: { token }, include: { company: true } })
    : null;
  const usable =
    invite && !invite.acceptedAt && !invite.revokedAt && invite.expiresAt > new Date()
      ? invite
      : null;

  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <span className="brand">Email Previews</span>
        <p className="tagline">
          {usable
            ? `You have been invited to collaborate on ${usable.company.name}.`
            : "Create your account and your first company."}
        </p>
        {token && !usable && (
          <div className="alert alert-warn">
            That invitation has expired or was already used. You can still create your own company
            below, then ask for a fresh invite.
          </div>
        )}
        <div className="card card-pad">
          <SignupForm
            inviteToken={usable?.token}
            inviteCompany={usable?.company.name}
            inviteEmail={usable?.email}
          />
        </div>
        <p className="hint" style={{ textAlign: "center", marginTop: 14 }}>
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </div>
    </main>
  );
}
