-- CreateTable
CREATE TABLE "CronLock" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL
);
