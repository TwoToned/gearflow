-- Drop every inbound FK constraint into the frozen Prisma `supplier` table.
--
-- Why: Suppliers were inverted to Convex-only (Phase B of the Convex domain-only
-- decommission). New suppliers are created ONLY in Convex; the Prisma `supplier`
-- table is no longer written. The live inbound FKs
--   asset.supplierId               -> supplier(id)  (nullable, NoAction)
--   project_line_item.supplierId   -> supplier(id)  (nullable, NoAction)  [sub-hire]
--   supplier_order.supplierId      -> supplier(id)  (required, Cascade)
--   sub_hire.supplierId            -> supplier(id)  (required, Cascade)
--   supplier_model_rate.supplierId -> supplier(id)  (required, Cascade)
-- would therefore reject any net-new Convex-only supplier (the dependent row has
-- no Prisma `supplier` to point at). `supplierId` becomes a plain external id
-- holding the Convex cuid — matching how Convex itself stores FKs (v.string()).
-- The columns + indexes stay; only the constraints are dropped. The Cascade
-- behaviour those three carried is moot in practice: deleteSupplier blocks
-- deletion whenever assets/lineItems/orders exist, so the cascade never fired;
-- the one delete-time cleanup that DID rely on a cascade (supplier_model_rate)
-- is re-implemented in app code (deleteSupplier deletes the supplier's rates in
-- both stores). See the decommission runbook + FEATUREDOCS/54.
--
-- IF EXISTS guards keep this idempotent across environments where a constraint
-- may already be absent.

ALTER TABLE "asset" DROP CONSTRAINT IF EXISTS "asset_supplierId_fkey";
ALTER TABLE "project_line_item" DROP CONSTRAINT IF EXISTS "project_line_item_supplierId_fkey";
ALTER TABLE "supplier_order" DROP CONSTRAINT IF EXISTS "supplier_order_supplierId_fkey";
ALTER TABLE "sub_hire" DROP CONSTRAINT IF EXISTS "sub_hire_supplierId_fkey";
ALTER TABLE "supplier_model_rate" DROP CONSTRAINT IF EXISTS "supplier_model_rate_supplierId_fkey";
