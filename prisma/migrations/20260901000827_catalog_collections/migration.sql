-- CreateTable
CREATE TABLE "CatalogCollection" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "productCount" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogCollectionProduct" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "CatalogCollectionProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogCollection_companyId_title_idx" ON "CatalogCollection"("companyId", "title");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogCollection_companyId_handle_key" ON "CatalogCollection"("companyId", "handle");

-- CreateIndex
CREATE INDEX "CatalogCollectionProduct_collectionId_position_idx" ON "CatalogCollectionProduct"("collectionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogCollectionProduct_collectionId_productId_key" ON "CatalogCollectionProduct"("collectionId", "productId");

-- AddForeignKey
ALTER TABLE "CatalogCollection" ADD CONSTRAINT "CatalogCollection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogCollectionProduct" ADD CONSTRAINT "CatalogCollectionProduct_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "CatalogCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogCollectionProduct" ADD CONSTRAINT "CatalogCollectionProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CatalogProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

