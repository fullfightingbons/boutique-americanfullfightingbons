-- Liste de souhaits (espace membre boutique) : mise de côté avant achat,
-- identifiée par email (même mécanisme requireMember que /api/member/orders).
CREATE TABLE IF NOT EXISTS wishlist_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  member_email TEXT    NOT NULL,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at   TEXT    DEFAULT (datetime('now')),
  UNIQUE(member_email, product_id)
);

CREATE INDEX IF NOT EXISTS idx_wishlist_member ON wishlist_items(member_email);
