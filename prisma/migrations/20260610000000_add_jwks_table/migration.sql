-- Better Auth jwt() plugin key storage (Convex Phase 5 auth bridge).
-- Holds the ES256 signing keypair for Convex-compatible JWTs.
CREATE TABLE "jwks" (
    "id" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "jwks_pkey" PRIMARY KEY ("id")
);
