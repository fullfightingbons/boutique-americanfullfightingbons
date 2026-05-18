-- ============================================================
--  AFFB Boutique — Schéma D1
-- ============================================================

-- Produits
CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  category    TEXT    NOT NULL,           -- gants | protections | tenues | accessoires
  price       REAL    NOT NULL,
  price_old   REAL,
  emoji       TEXT    NOT NULL DEFAULT '📦',
  badge       TEXT,                        -- 'Nouveau' | 'Exclusif' | NULL
  stock       INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  created_at  TEXT    DEFAULT (datetime('now'))
);

-- Commandes
CREATE TABLE IF NOT EXISTS orders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name  TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  total       REAL    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'pending',  -- pending | confirmed | shipped | delivered
  notes       TEXT,
  created_at  TEXT    DEFAULT (datetime('now'))
);

-- Lignes de commande
CREATE TABLE IF NOT EXISTS order_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT   NOT NULL,
  quantity    INTEGER NOT NULL DEFAULT 1,
  unit_price  REAL    NOT NULL
);

-- ── Données initiales ───────────────────────────────────────────
INSERT OR IGNORE INTO products (id, name, category, price, price_old, emoji, badge, stock, description) VALUES
  (1,  'Gants Pro AFFB 10oz',     'gants',       59,   74,  '🥊', 'Exclusif', 15, 'Cuir synthèse haute densité, entraînement & compétition.'),
  (2,  'Gants Sparring 12oz',     'gants',       65,   NULL,'🥊', NULL,       10, 'Idéaux pour le sparring quotidien.'),
  (3,  'Gants Compétition 16oz',  'gants',       79,   NULL,'🥊', 'Nouveau',   8, 'Homologués compétition FFKMDA.'),
  (4,  'Protège-dents Pro',       'protections', 18,   NULL,'🦷', NULL,       30, 'Thermoformable, certification CE.'),
  (5,  'Coquille homme',          'protections', 22,   NULL,'🛡️', NULL,       20, 'Protection intégrale homologuée.'),
  (6,  'Casque Entraînement',     'protections', 89,   110, '🪖', NULL,       12, 'Cuir synthèse rembourré, vision dégagée.'),
  (7,  'T-shirt Club 2025',       'tenues',      28,   NULL,'👕', 'Nouveau',  25, 'Coton bio, logo brodé AFFB.'),
  (8,  'Short Compétition',       'tenues',      42,   NULL,'🩱', 'Nouveau',  18, 'Polyester recyclé, coupe ajustée.'),
  (9,  'Bandages Pro 4m',         'accessoires', 12,   NULL,'🎽', NULL,       50, 'Semi-élastiques, lavage machine.'),
  (10, 'Sac de sport AFFB',       'accessoires', 55,   NULL,'🏅', 'Exclusif', 10, 'Grande contenance, compartiment chaussures.'),
  (11, 'Mitaines Sparring',       'gants',       45,   NULL,'🤛', NULL,       14, 'Ouvertes, idéales pour les combinaisons.'),
  (12, 'Protège-tibias',          'protections', 35,   NULL,'🦵', NULL,       16, 'Mousse EVA haute densité, maintien velcro.');
