-- ============================================================
--  AFFB Boutique — Migration : ajout customer_phone sur orders
--  (colonne présente dans schema.sql mais absente des bases
--   créées avant son ajout — CREATE TABLE IF NOT EXISTS ne la
--   rajoute pas rétroactivement)
--
--  Exécuter en local :   npx wrangler d1 execute boutique-americanfullfightingbons --file=migration_orders_customer_phone.sql
--  Exécuter en prod  :   npx wrangler d1 execute boutique-americanfullfightingbons --remote --file=migration_orders_customer_phone.sql
-- ============================================================

ALTER TABLE orders ADD COLUMN customer_phone TEXT;
