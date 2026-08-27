import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, listCompaniesForUser } from "@/lib/auth";
import { logoutAction } from "@/actions/auth";
import { NewCompanyForm } from "./NewCompanyForm";

export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const companies = await listCompaniesForUser(user.id);

  return (
    <main className="auth-wrap">
      <div className="auth-card" style={{ maxWidth: 520 }}>
        <span className="brand">Your companies</span>
        <p className="tagline">Signed in as {user.email}.</p>

        <div className="card">
          {companies.length === 0 ? (
            <div className="empty">
              <h3>No companies yet</h3>
              <p>Create one below to start adding templates and content.</p>
            </div>
          ) : (
            <table>
              <tbody>
                {companies.map((company) => (
                  <tr key={company.id}>
                    <td>
                      <Link href={`/c/${company.id}`} style={{ fontWeight: 600 }}>
                        {company.name}
                      </Link>
                    </td>
                    <td className="tight">
                      <span className="badge">{company.role}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card card-pad" style={{ marginTop: 14 }}>
          <h2 style={{ marginBottom: 12 }}>Create a company</h2>
          <NewCompanyForm />
        </div>

        <form action={logoutAction} style={{ textAlign: "center", marginTop: 14 }}>
          <button type="submit" className="btn btn-ghost btn-sm">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
