-- Points for Judge.me reviews: award amount + per-shop webhook auth token.
ALTER TABLE "ShopConfig" ADD COLUMN "reviewBonus" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ShopConfig" ADD COLUMN "judgemeSecret" TEXT;
