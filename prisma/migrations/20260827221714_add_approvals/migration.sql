-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Approval_rowId_idx" ON "Approval"("rowId");

-- CreateIndex
CREATE INDEX "Approval_templateId_idx" ON "Approval"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "Approval_rowId_templateId_userId_key" ON "Approval"("rowId", "templateId", "userId");

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "SheetRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
