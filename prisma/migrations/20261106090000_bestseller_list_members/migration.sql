-- CreateTable
CREATE TABLE "BestsellerListMember" (
    "shop" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "legacyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "since" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sinceRunId" TEXT,
    "lastSeenRunId" TEXT,

    PRIMARY KEY ("shop", "tag", "productId")
);

