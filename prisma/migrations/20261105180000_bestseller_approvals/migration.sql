-- AlterTable
ALTER TABLE "BestsellerRun" ADD COLUMN "appliedAt" DATETIME;
ALTER TABLE "BestsellerRun" ADD COLUMN "applyStatus" TEXT;

-- CreateTable
CREATE TABLE "BestsellerApproval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "via" TEXT NOT NULL,
    "by" TEXT,
    "note" TEXT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BestsellerSetting" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "labelTag" TEXT NOT NULL,
    "approvalMode" TEXT NOT NULL DEFAULT 'manual',
    "updatedBy" TEXT,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_BestsellerSetting" ("labelTag", "shop", "updatedAt", "updatedBy") SELECT "labelTag", "shop", "updatedAt", "updatedBy" FROM "BestsellerSetting";
DROP TABLE "BestsellerSetting";
ALTER TABLE "new_BestsellerSetting" RENAME TO "BestsellerSetting";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "BestsellerApproval_shop_runId_idx" ON "BestsellerApproval"("shop", "runId");

