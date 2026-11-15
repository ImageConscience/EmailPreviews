-- Email provider becomes a choice, and the connection columns stop being
-- named after one of the two.
--
-- Written by hand. The generated migration dropped every klaviyo* column and
-- added an esp* one beside it, which is correct about the end state and
-- catastrophic about getting there: it would have thrown away a live API key
-- and every record of what has already been pushed, including campaigns
-- sitting in a send queue. RENAME keeps the data in place.

-- --- Company: the shared connection, renamed -------------------------------
ALTER TABLE "Company" RENAME COLUMN "klaviyoKeyCipher"       TO "espKeyCipher";
ALTER TABLE "Company" RENAME COLUMN "klaviyoKeyHint"         TO "espKeyHint";
ALTER TABLE "Company" RENAME COLUMN "klaviyoAccountName"     TO "espAccountName";
ALTER TABLE "Company" RENAME COLUMN "klaviyoAccountId"       TO "espAccountId";
ALTER TABLE "Company" RENAME COLUMN "klaviyoFromEmail"       TO "espFromEmail";
ALTER TABLE "Company" RENAME COLUMN "klaviyoFromLabel"       TO "espFromLabel";
ALTER TABLE "Company" RENAME COLUMN "klaviyoReplyTo"         TO "espReplyTo";
ALTER TABLE "Company" RENAME COLUMN "klaviyoTimezone"        TO "espTimezone";
ALTER TABLE "Company" RENAME COLUMN "klaviyoLinkedAt"        TO "espLinkedAt";
ALTER TABLE "Company" RENAME COLUMN "klaviyoAudience"        TO "espAudience";
ALTER TABLE "Company" RENAME COLUMN "klaviyoAudienceExclude" TO "espAudienceExclude";

-- klaviyoBaseTemplateId/Name keep their names: only Klaviyo has a base
-- template, so a neutral name would be a promise the other provider cannot keep.

-- Every company that exists today reached its platform through Klaviyo, which
-- is also the column default, so this is true of the rows already here.
ALTER TABLE "Company" ADD COLUMN "emailProvider" TEXT NOT NULL DEFAULT 'klaviyo';

-- --- The push record, renamed with its rows, constraints and indexes -------
ALTER TABLE "KlaviyoPush" RENAME TO "EspPush";

ALTER TABLE "EspPush" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'klaviyo';
ALTER TABLE "EspPush" ADD COLUMN "refs" TEXT NOT NULL DEFAULT '{}';

-- The one Klaviyo-specific handle moves into the JSON that every provider now
-- uses for its own, so the column can go and nothing is lost with it.
UPDATE "EspPush"
   SET "refs" = json_build_object('templateId', "klaviyoTemplateId")::text
 WHERE "klaviyoTemplateId" IS NOT NULL AND "klaviyoTemplateId" <> '';

ALTER TABLE "EspPush" DROP COLUMN "klaviyoTemplateId";

-- Postgres carries indexes and foreign keys through a table rename but keeps
-- their old names, which leaves the schema readable only to someone who knows
-- this migration happened.
ALTER INDEX "KlaviyoPush_pkey"                  RENAME TO "EspPush_pkey";
ALTER INDEX "KlaviyoPush_rowId_templateId_key"  RENAME TO "EspPush_rowId_templateId_key";
ALTER INDEX "KlaviyoPush_rowId_idx"             RENAME TO "EspPush_rowId_idx";

ALTER TABLE "EspPush" RENAME CONSTRAINT "KlaviyoPush_rowId_fkey"      TO "EspPush_rowId_fkey";
ALTER TABLE "EspPush" RENAME CONSTRAINT "KlaviyoPush_templateId_fkey" TO "EspPush_templateId_fkey";
ALTER TABLE "EspPush" RENAME CONSTRAINT "KlaviyoPush_pushedById_fkey" TO "EspPush_pushedById_fkey";
