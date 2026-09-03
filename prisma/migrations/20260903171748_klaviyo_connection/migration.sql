-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "klaviyoAccountId" TEXT,
ADD COLUMN     "klaviyoAccountName" TEXT,
ADD COLUMN     "klaviyoFromEmail" TEXT,
ADD COLUMN     "klaviyoFromLabel" TEXT,
ADD COLUMN     "klaviyoKeyCipher" TEXT,
ADD COLUMN     "klaviyoKeyHint" TEXT,
ADD COLUMN     "klaviyoLinkedAt" TIMESTAMP(3),
ADD COLUMN     "klaviyoReplyTo" TEXT,
ADD COLUMN     "klaviyoTimezone" TEXT;
