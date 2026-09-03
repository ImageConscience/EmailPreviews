import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/secret";

/**
 * A company's Klaviyo key, decrypted.
 *
 * One place that knows a company might not be connected, and one place that
 * turns a stored cipher back into a credential. No access check of its own --
 * every caller has already made one, and putting a second here would only
 * make it look as though callers without one were safe.
 */
export async function klaviyoKeyForCompany(companyId: string): Promise<string | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { klaviyoKeyCipher: true },
  });
  if (!company?.klaviyoKeyCipher) return null;
  return decryptSecret(company.klaviyoKeyCipher);
}
