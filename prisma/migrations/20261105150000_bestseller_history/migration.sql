-- AlterTable
ALTER TABLE "BestsellerRun" ADD COLUMN "labelTag" TEXT;
ALTER TABLE "BestsellerRun" ADD COLUMN "selection" TEXT;

-- CreateTable
CREATE TABLE "BestsellerSetting" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "labelTag" TEXT NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BestsellerEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "runId" TEXT,
    "localDate" TEXT,
    "productId" TEXT,
    "legacyId" TEXT,
    "title" TEXT,
    "category" TEXT,
    "netUnits" INTEGER,
    "detail" TEXT
);

-- CreateIndex
CREATE INDEX "BestsellerEvent_shop_at_idx" ON "BestsellerEvent"("shop", "at");

