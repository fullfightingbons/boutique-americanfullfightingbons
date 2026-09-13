-- ============================================================
--  AFFB Boutique — Migration : actions vendeur en libre-service
--  sur les annonces d'occasion
--
--  Ajoute à la table `listings` :
--    • manage_token    : jeton secret propre à chaque annonce, permettant
--                        au vendeur de la marquer "vendue" lui-même via un
--                        lien reçu par email (sans compte, sans repasser
--                        par le club). Généré à la création de l'annonce
--                        (createListing) ou à la volée si absent
--                        (ensureListingManageToken).
--    • last_reminder_at : date du dernier rappel mensuel envoyé au vendeur
--                        tant que son annonce reste "active" (cron
--                        sendListingActiveReminders, cf. worker.js).
--
--  ⚠️ À exécuter AVANT de déployer le nouveau code (le worker suppose ces
--  colonnes présentes dès qu'une annonce est créée, mise à jour ou listée
--  côté admin) — même piège que orders_customer_phone.sql /
--  migration_orders_helloasso.sql : CREATE TABLE IF NOT EXISTS ne rajoute
--  jamais de colonne à une table déjà existante.
--
--  Exécuter en local :   npm run db:migrate:listing-actions
--  Exécuter en prod  :   npm run db:migrate:listing-actions:remote
-- ============================================================

ALTER TABLE listings ADD COLUMN manage_token TEXT;
ALTER TABLE listings ADD COLUMN last_reminder_at TEXT;

-- Un index UNIQUE tolère plusieurs NULL en SQLite (annonces existantes sans
-- token pas encore généré) ; il garantit en revanche l'unicité dès qu'un
-- token est renseigné.
CREATE UNIQUE INDEX IF NOT EXISTS idx_listings_manage_token ON listings(manage_token);
