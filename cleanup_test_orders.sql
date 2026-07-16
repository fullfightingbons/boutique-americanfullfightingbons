-- ============================================================
--  Nettoyage de commandes de test (paiement en attente)
--  À adapter : remplacez la liste d'IDs ci-dessous par les
--  numéros de commande à supprimer (vus dans l'admin : n°10 à 16).
--
--  1) Vérifiez d'abord ce que vous allez supprimer :
--     npx wrangler d1 execute boutique-americanfullfightingbons --remote \
--       --command="SELECT id, status, total, created_at FROM orders WHERE id IN (10,11,12,13,14,15,16)"
--
--  2) Si la liste est correcte, exécutez ce fichier :
--     npx wrangler d1 execute boutique-americanfullfightingbons --remote --file=cleanup_test_orders.sql
-- ============================================================

-- Remet en stock les articles des commandes ci-dessous (uniquement pour les
-- produits SANS tailles ; si un article avait une taille, corrigez le stock
-- de cette taille manuellement dans l'admin après coup — le JSON
-- size_stocks n'est pas trivial à restaurer en pur SQL).
UPDATE products
SET stock = stock + (
  SELECT COALESCE(SUM(oi.quantity), 0)
  FROM order_items oi
  WHERE oi.product_id = products.id
    AND oi.order_id IN (10,11,12,13,14,15,16)
)
WHERE id IN (
  SELECT DISTINCT product_id FROM order_items WHERE order_id IN (10,11,12,13,14,15,16)
);

-- Supprime les jetons d'accès liés à ces commandes (invité)
DELETE FROM order_access_tokens WHERE order_id IN (10,11,12,13,14,15,16);

-- Supprime les lignes de commande
DELETE FROM order_items WHERE order_id IN (10,11,12,13,14,15,16);

-- Supprime les commandes elles-mêmes
DELETE FROM orders WHERE id IN (10,11,12,13,14,15,16);
