-- CreateTable
CREATE TABLE "RowNote" (
    "id" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "userId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RowNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RowNote_rowId_createdAt_idx" ON "RowNote"("rowId", "createdAt");

-- AddForeignKey
ALTER TABLE "RowNote" ADD CONSTRAINT "RowNote_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "SheetRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RowNote" ADD CONSTRAINT "RowNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
