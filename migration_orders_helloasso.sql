-- ============================================================
--  AFFB Boutique — Migration : ajout helloasso_id / helloasso_url
--  sur orders (colonnes présentes dans schema.sql mais absentes des
--  bases créées avant leur ajout — CREATE TABLE IF NOT EXISTS ne les
--  rajoute pas rétroactivement, cf. même piège que
--  orders_customer_phone.sql pour customer_phone)
--
--  Exécuter en local :   npx wrangler d1 execute boutique-americanfullfightingbons --file=migration_orders_helloasso.sql
--  Exécuter en prod  :   npx wrangler d1 execute boutique-americanfullfightingbons --remote --file=migration_orders_helloasso.sql
-- ============================================================

ALTER TABLE orders ADD COLUMN helloasso_id TEXT;
ALTER TABLE orders ADD COLUMN helloasso_url TEXT;
