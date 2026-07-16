-- Migration : table admin_config pour stocker le hash PBKDF2 de l'administrateur
-- Remplace ADMIN_PASSWORD et ADMIN_PASSWORD_HASH (variables d'env en clair/SHA-256)
--
-- Après avoir appliqué cette migration, générer le hash initial :
--
--   node -e "
--     const pw = 'VotreMotDePasseAdmin';
--     const salt = crypto.getRandomValues(new Uint8Array(16));
--     const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
--     const bits = await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:100000}, key, 256);
--     const hex = s => [...new Uint8Array(s)].map(b=>b.toString(16).padStart(2,'0')).join('');
--     console.log('pbkdf2_sha256\$100000\$' + hex(salt) + '\$' + hex(bits));
--   "
--
-- Puis insérer via wrangler :
--   wrangler d1 execute affbc-boutique --command="INSERT INTO admin_config (key,value) VALUES ('admin_password_hash','<hash>');"
--
-- Enfin, supprimer ADMIN_PASSWORD et ADMIN_PASSWORD_HASH des secrets Cloudflare.

CREATE TABLE IF NOT EXISTS admin_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
