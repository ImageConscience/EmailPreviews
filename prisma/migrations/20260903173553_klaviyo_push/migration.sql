-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "klaviyoBaseTemplateId" TEXT,
ADD COLUMN     "klaviyoBaseTemplateName" TEXT;

-- CreateTable
CREATE TABLE "KlaviyoPush" (
    "id" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "klaviyoTemplateId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "scheduledFor" TIMESTAMP(3),
    "campaignName" TEXT NOT NULL,
    "audienceNames" TEXT NOT NULL DEFAULT '',
    "pushedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pushedById" TEXT,

    CONSTRAINT "KlaviyoPush_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KlaviyoPush_rowId_idx" ON "KlaviyoPush"("rowId");

-- CreateIndex
CREATE UNIQUE INDEX "KlaviyoPush_rowId_templateId_key" ON "KlaviyoPush"("rowId", "templateId");

-- AddForeignKey
ALTER TABLE "KlaviyoPush" ADD CONSTRAINT "KlaviyoPush_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "SheetRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KlaviyoPush" ADD CONSTRAINT "KlaviyoPush_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KlaviyoPush" ADD CONSTRAINT "KlaviyoPush_pushedById_fkey" FOREIGN KEY ("pushedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
