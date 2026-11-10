-- CreateTable
CREATE TABLE "BestsellerRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "phase" TEXT,
    "requestedBy" TEXT,
    "options" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "windowStart" TEXT,
    "windowEnd" TEXT,
    "inputHash" TEXT,
    "resultHash" TEXT,
    "result" TEXT,
    "error" TEXT,
    "logs" TEXT,
    "applySummary" TEXT
);

-- CreateTable
CREATE TABLE "BestsellerFlowEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "error" TEXT,
    "sentAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BestsellerFlowEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BestsellerRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BestsellerTagChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "tagsBefore" TEXT,
    "tagsAfter" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BestsellerTagChange_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BestsellerRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BestsellerJobLock" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "holder" TEXT NOT NULL,
    "acquiredAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "BestsellerRun_shop_localDate_idx" ON "BestsellerRun"("shop", "localDate");

-- CreateIndex
CREATE INDEX "BestsellerRun_shop_startedAt_idx" ON "BestsellerRun"("shop", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BestsellerFlowEvent_runId_eventKey_key" ON "BestsellerFlowEvent"("runId", "eventKey");

-- CreateIndex
CREATE INDEX "BestsellerTagChange_runId_idx" ON "BestsellerTagChange"("runId");

