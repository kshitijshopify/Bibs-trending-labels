-- In-app "Store updates" switch. OFF for every shop: after installing or
-- deploying, the app changes no product until someone switches it on.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BestsellerSetting" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "labelTag" TEXT NOT NULL,
    "approvalMode" TEXT NOT NULL DEFAULT 'automatic',
    "emailFormat" TEXT NOT NULL DEFAULT 'separate',
    "salesWindowDays" INTEGER NOT NULL DEFAULT 30,
    "storeUpdates" BOOLEAN NOT NULL DEFAULT false,
    "updatedBy" TEXT,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_BestsellerSetting" ("approvalMode", "emailFormat", "labelTag", "salesWindowDays", "shop", "updatedAt", "updatedBy") SELECT "approvalMode", "emailFormat", "labelTag", "salesWindowDays", "shop", "updatedAt", "updatedBy" FROM "BestsellerSetting";
DROP TABLE "BestsellerSetting";
ALTER TABLE "new_BestsellerSetting" RENAME TO "BestsellerSetting";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
