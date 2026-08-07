-- Rate limiting générique pour les routes publiques non protégées par
-- Turnstile (notify-me, wishlist). Ces deux endpoints acceptent l'email de
-- n'importe qui sans vérification anti-bot ; cette table borne le nombre
-- d'appels par IP et par action sur une fenêtre glissante (cf.
-- isPublicActionRateLimited / recordPublicAction dans worker.js).
CREATE TABLE IF NOT EXISTS public_action_attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ip           TEXT    NOT NULL,
  action       TEXT    NOT NULL,             -- ex: 'stock_alert', 'wishlist_add'
  attempted_at TEXT    DEFAULT (datetime('now'))
);
