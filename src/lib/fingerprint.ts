import { createHash } from "node:crypto";

/**
 * Fingerprint of exactly what a person saw when they approved.
 *
 * Both halves matter: editing the row's copy and editing the template each
 * change the email that would go out, so both must invalidate the sign-off.
 * Comparing this against a stored value is what makes an approval mean "this
 * version was approved" rather than just "someone once clicked approve".
 *
 * Kept apart from the rest of the approval helpers because it is the only one
 * that needs node's crypto, and the others are wanted in the browser.
 */
export function approvalFingerprint(
  rowData: string,
  templateId: string,
  templateUpdatedAt: Date,
): string {
  return createHash("sha256")
    .update(rowData)
    .update(" ")
    .update(templateId)
    .update(" ")
    .update(templateUpdatedAt.toISOString())
    .digest("hex");
}
