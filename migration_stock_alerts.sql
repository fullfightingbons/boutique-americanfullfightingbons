-- Alertes de disponibilité : un visiteur laisse son email pour être prévenu
-- quand une taille (ou un produit sans tailles) revient en stock.
CREATE TABLE IF NOT EXISTS stock_alerts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size       TEXT,                          -- NULL = produit sans déclinaison de taille
  email      TEXT    NOT NULL,
  created_at TEXT    DEFAULT (datetime('now')),
  UNIQUE(product_id, size, email)
);

CREATE INDEX IF NOT EXISTS idx_stock_alerts_product ON stock_alerts(product_id);
