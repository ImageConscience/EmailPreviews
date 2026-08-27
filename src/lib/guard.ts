import { notFound, redirect } from "next/navigation";
import { AuthError, requireCompanyAccess, type CompanyAccess, type Role } from "./auth";

/** Page-level wrapper: bounces to login when signed out, 404s on no access. */
export async function guardCompany(companyId: string, minimum: Role = "member"): Promise<CompanyAccess> {
  try {
    return await requireCompanyAccess(companyId, minimum);
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.status === 401) redirect("/login");
      notFound();
    }
    throw error;
  }
}
