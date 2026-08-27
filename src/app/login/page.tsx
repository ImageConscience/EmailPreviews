import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <span className="brand">Email Previews</span>
        <p className="tagline">Sign in to preview your templates against real content.</p>
        <div className="card card-pad">
          <LoginForm />
        </div>
        <p className="hint" style={{ textAlign: "center", marginTop: 14 }}>
          No account yet? <Link href="/signup">Create one</Link>
        </p>
      </div>
    </main>
  );
}
