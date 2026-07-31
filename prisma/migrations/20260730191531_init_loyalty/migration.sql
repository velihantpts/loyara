-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" DATETIME,
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" DATETIME
);

-- CreateTable
CREATE TABLE "ShopConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "onboardedAt" DATETIME,
    "programActive" BOOLEAN NOT NULL DEFAULT true,
    "pointsPerDollar" INTEGER NOT NULL DEFAULT 1,
    "signupBonus" INTEGER NOT NULL DEFAULT 0,
    "birthdayBonus" INTEGER NOT NULL DEFAULT 0,
    "pointsExpiryDays" INTEGER NOT NULL DEFAULT 0,
    "redeemTiers" TEXT NOT NULL DEFAULT '[]',
    "vipTiers" TEXT NOT NULL DEFAULT '[]',
    "referralReward" INTEGER NOT NULL DEFAULT 0,
    "brandingRemoved" BOOLEAN NOT NULL DEFAULT false,
    "isPro" BOOLEAN NOT NULL DEFAULT false,
    "email" TEXT,
    "reviewRequestedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shopifyGid" TEXT NOT NULL,
    "email" TEXT,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "lifetimeEarned" INTEGER NOT NULL DEFAULT 0,
    "vipTier" TEXT,
    "birthday" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PointsLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "webhookEventId" TEXT,
    "orderGid" TEXT,
    "meta" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PointsLedger_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Redemption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "cost" INTEGER NOT NULL,
    "discountCode" TEXT,
    "discountNodeGid" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Redemption_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "referrerGid" TEXT NOT NULL,
    "refereeGid" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopConfig_shop_key" ON "ShopConfig"("shop");

-- CreateIndex
CREATE INDEX "Customer_shop_balance_idx" ON "Customer"("shop", "balance");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_shop_shopifyGid_key" ON "Customer"("shop", "shopifyGid");

-- CreateIndex
CREATE INDEX "PointsLedger_shop_customerId_createdAt_idx" ON "PointsLedger"("shop", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "PointsLedger_shop_orderGid_idx" ON "PointsLedger"("shop", "orderGid");

-- CreateIndex
CREATE UNIQUE INDEX "PointsLedger_shop_sourceType_sourceId_key" ON "PointsLedger"("shop", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "Redemption_shop_customerId_createdAt_idx" ON "Redemption"("shop", "customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Redemption_shop_idempotencyKey_key" ON "Redemption"("shop", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Referral_shop_referrerGid_idx" ON "Referral"("shop", "referrerGid");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_shop_code_key" ON "Referral"("shop", "code");
