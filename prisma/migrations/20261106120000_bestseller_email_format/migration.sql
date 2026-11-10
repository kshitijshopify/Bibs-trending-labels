-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BestsellerSetting" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "labelTag" TEXT NOT NULL,
    "approvalMode" TEXT NOT NULL DEFAULT 'manual',
    "emailFormat" TEXT NOT NULL DEFAULT 'separate',
    "updatedBy" TEXT,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_BestsellerSetting" ("approvalMode", "labelTag", "shop", "updatedAt", "updatedBy") SELECT "approvalMode", "labelTag", "shop", "updatedAt", "updatedBy" FROM "BestsellerSetting";
DROP TABLE "BestsellerSetting";
ALTER TABLE "new_BestsellerSetting" RENAME TO "BestsellerSetting";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

