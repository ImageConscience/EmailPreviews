-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "attentiveSegments" TEXT,
ADD COLUMN     "attentiveSegmentsSyncedAt" TIMESTAMP(3),
ADD COLUMN     "smsAccountName" TEXT,
ADD COLUMN     "smsAddOptOut" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "smsAudience" TEXT,
ADD COLUMN     "smsAudienceExclude" TEXT,
ADD COLUMN     "smsKeyCipher" TEXT,
ADD COLUMN     "smsKeyHint" TEXT,
ADD COLUMN     "smsProvider" TEXT;

-- AlterTable
ALTER TABLE "ContentSheet" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'email';

-- CreateTable
CREATE TABLE "SmsApproval" (
    "id" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsPush" (
    "id" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "refs" TEXT NOT NULL DEFAULT '{}',
    "contentHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "scheduledFor" TIMESTAMP(3),
    "campaignName" TEXT NOT NULL,
    "audienceNames" TEXT NOT NULL DEFAULT '',
    "pushedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pushedById" TEXT,

    CONSTRAINT "SmsPush_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmsApproval_rowId_idx" ON "SmsApproval"("rowId");

-- CreateIndex
CREATE UNIQUE INDEX "SmsApproval_rowId_userId_key" ON "SmsApproval"("rowId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SmsPush_rowId_key" ON "SmsPush"("rowId");

-- AddForeignKey
ALTER TABLE "SmsApproval" ADD CONSTRAINT "SmsApproval_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "SheetRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsApproval" ADD CONSTRAINT "SmsApproval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsPush" ADD CONSTRAINT "SmsPush_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "SheetRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsPush" ADD CONSTRAINT "SmsPush_pushedById_fkey" FOREIGN KEY ("pushedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
