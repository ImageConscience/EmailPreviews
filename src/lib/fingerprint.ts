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

/**
 * The same promise for a text: what was approved is exactly these values.
 *
 * No template half, because a text has none -- the row is the whole message.
 * Prefixed so a text's hash can never equal an email's for the same row data,
 * should the two ever be compared by mistake.
 */
export function smsFingerprint(rowData: string): string {
  return createHash("sha256").update("sms ").update(rowData).digest("hex");
}
