import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/auth";
import { storeUpload } from "@/lib/media-store";
import { apiError } from "@/lib/api";

export const dynamic = "force-dynamic";
/** Reading a multi-megabyte upload takes longer than the default allowance. */
export const maxDuration = 60;

/**
 * Image upload.
 *
 * A route handler rather than a server action because those cap their request
 * body at 1 MB by default -- small enough that an ordinary photo fails, and it
 * fails as a framework-level crash page rather than a message anyone can act
 * on. A route handler takes the body as it comes and can answer per file.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ companyId: string }> },
) {
  const { companyId } = await params;
  try {
    const access = await requireCompanyAccess(companyId, "member");

    const form = await request.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) {
      return NextResponse.json({ error: "No image was sent." }, { status: 400 });
    }

    const results = [];
    for (const file of files) {
      results.push(await storeUpload(companyId, access.user.id, file));
    }
    return NextResponse.json({ results });
  } catch (error) {
    return apiError(error);
  }
}
