-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "catalogSyncedAt" TIMESTAMP(3),
ADD COLUMN     "shopDomain" TEXT;

-- CreateTable
CREATE TABLE "CatalogProduct" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "vendor" TEXT,
    "productType" TEXT,
    "url" TEXT NOT NULL,
    "imageUrl" TEXT,
    "price" TEXT,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "tags" TEXT NOT NULL DEFAULT '',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogProduct_companyId_title_idx" ON "CatalogProduct"("companyId", "title");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogProduct_companyId_externalId_key" ON "CatalogProduct"("companyId", "externalId");

-- AddForeignKey
ALTER TABLE "CatalogProduct" ADD CONSTRAINT "CatalogProduct_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
