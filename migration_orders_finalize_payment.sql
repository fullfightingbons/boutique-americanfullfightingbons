-- ============================================================
--  AFFB Boutique — Migration CRITIQUE : finalisation de commande
--
--  finalizePaidOrder() (appelée juste après un paiement HelloAsso réussi)
--  utilise une colonne `paid_at` sur `orders` et deux tables
--  `order_status_history` / `payments` qui n'ont jamais existé en base
--  (ni dans schema.sql, ni dans une migration, ni créées à la volée par
--  ensureSupportTables()). Conséquence concrète : la finalisation d'une
--  commande après paiement réussi échoue systématiquement avec
--  "D1_ERROR: no such column: paid_at" — AVANT même l'envoi de la facture
--  au client. Cette migration corrige ça.
--
--  Exécuter en local :   npx wrangler d1 execute boutique-americanfullfightingbons --file=migration_orders_finalize_payment.sql
--  Exécuter en prod  :   npx wrangler d1 execute boutique-americanfullfightingbons --remote --file=migration_orders_finalize_payment.sql
-- ============================================================

ALTER TABLE orders ADD COLUMN paid_at TEXT;
ALTER TABLE orders ADD COLUMN gestion_synced_at TEXT;

CREATE TABLE IF NOT EXISTS order_status_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  old_status  TEXT,
  new_status  TEXT NOT NULL,
  changed_at  TEXT DEFAULT (datetime('now')),
  changed_by  TEXT
);

CREATE TABLE IF NOT EXISTS payments (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id             INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  helloasso_payment_id TEXT,
  amount               REAL,
  payer_name           TEXT,
  payer_email          TEXT,
  paid_at              TEXT,
  raw_payload          TEXT,
  created_at           TEXT DEFAULT (datetime('now'))
);
