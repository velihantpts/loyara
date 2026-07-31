-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ShopConfig" (
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
    "referralFriendDiscount" INTEGER NOT NULL DEFAULT 0,
    "emailNotifications" BOOLEAN NOT NULL DEFAULT false,
    "brandingRemoved" BOOLEAN NOT NULL DEFAULT false,
    "isPro" BOOLEAN NOT NULL DEFAULT false,
    "email" TEXT,
    "reviewRequestedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ShopConfig" ("birthdayBonus", "brandingRemoved", "createdAt", "email", "id", "isPro", "onboardedAt", "pointsExpiryDays", "pointsPerDollar", "programActive", "redeemTiers", "referralReward", "reviewRequestedAt", "shop", "signupBonus", "updatedAt", "vipTiers") SELECT "birthdayBonus", "brandingRemoved", "createdAt", "email", "id", "isPro", "onboardedAt", "pointsExpiryDays", "pointsPerDollar", "programActive", "redeemTiers", "referralReward", "reviewRequestedAt", "shop", "signupBonus", "updatedAt", "vipTiers" FROM "ShopConfig";
DROP TABLE "ShopConfig";
ALTER TABLE "new_ShopConfig" RENAME TO "ShopConfig";
CREATE UNIQUE INDEX "ShopConfig_shop_key" ON "ShopConfig"("shop");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
