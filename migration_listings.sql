-- ============================================================
--  AFFB Boutique — Migration : Annonces d'occasion
--  Exécuter en local :   npm run db:migrate
--  Exécuter en prod  :   npm run db:migrate:remote
-- ============================================================

CREATE TABLE IF NOT EXISTS listings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT    NOT NULL,                        -- ex: "Gants Venum 10oz - très bon état"
  description   TEXT,                                    -- description libre
  price         REAL    NOT NULL,                        -- prix demandé
  category      TEXT    NOT NULL DEFAULT 'divers',       -- gants, protections, tenues, accessoires, divers
  condition     TEXT    NOT NULL DEFAULT 'bon',          -- neuf, tres_bon, bon, correct
  contact_name  TEXT    NOT NULL,                        -- prénom + nom du vendeur
  contact_email TEXT    NOT NULL,                        -- email du vendeur
  contact_phone TEXT,                                    -- téléphone optionnel
  image_url     TEXT,                                    -- URL R2 ou data-URL
  status        TEXT    NOT NULL DEFAULT 'pending',      -- pending | active | sold | rejected
  created_at    TEXT    DEFAULT (datetime('now')),
  updated_at    TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_listings_status   ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_category ON listings(category);
