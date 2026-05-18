# AFFB Boutique v2 — Guide d'installation complet

## Structure des fichiers

```
affb-boutique/
├── src/
│   ├── worker.js     ← Worker principal (API + auth + HelloAsso + Brevo)
│   ├── index.html    ← Boutique publique
│   └── admin.html    ← Panel administrateur (accès /admin)
├── schema.sql        ← Schéma D1 v2 (avec sessions admin + image_url)
├── wrangler.toml     ← Config Worker, D1, R2
├── package.json
└── README.md
```

---

## 1. Prérequis

```bash
npm install -g wrangler
wrangler login
```

---

## 2. Initialiser la base D1

```bash
# En local
npm run db:init

# En production
npm run db:init:remote
```

> **Important** : si vous aviez déjà une base v1, lancez en plus :
> ```bash
> wrangler d1 execute boutique-americanfullfightingbons --remote --command \
>   "ALTER TABLE products ADD COLUMN image_url TEXT; \
>    ALTER TABLE products ADD COLUMN updated_at TEXT DEFAULT (datetime('now')); \
>    CREATE TABLE IF NOT EXISTS admin_sessions (token TEXT PRIMARY KEY, created_at TEXT DEFAULT (datetime('now')), expires_at TEXT NOT NULL);"
> ```

---

## 3. Créer le bucket R2 (images produits)

```bash
wrangler r2 bucket create affb-images
```

Pour accès public (optionnel, recommandé) :
- Dashboard Cloudflare → R2 → affb-images → Settings → Public Access → Enable
- Notez le domaine public (ex: `pub-xxx.r2.dev`) et mettez-le à jour dans `worker.js` :
  ```js
  const imageUrl = `https://pub-xxx.r2.dev/${key}`;
  ```

---

## 4. Configurer les secrets (via Wrangler CLI)

```bash
# Mot de passe du panel admin
wrangler secret put ADMIN_PASSWORD
# → Entrez votre mot de passe (ex: MonMotDePasse2025!)

# HelloAsso OAuth2
wrangler secret put HELLOASSO_CLIENT_ID
wrangler secret put HELLOASSO_CLIENT_SECRET

# Brevo (ex-Sendinblue)
wrangler secret put BREVO_API_KEY
```

---

## 5. Configurer HelloAsso

1. Créez un compte sur [helloasso.com](https://www.helloasso.com)
2. Créez une organisation (le slug est dans l'URL : `helloasso.com/associations/votre-slug`)
3. Allez dans **Paramètres → API** et créez une application OAuth2
4. Récupérez le `client_id` et `client_secret`
5. Dans `wrangler.toml`, renseignez `HELLOASSO_ORG_SLUG` et les URLs de retour
6. Ajoutez `HELLOASSO_CLIENT_ID` en variable (non secrète) dans `wrangler.toml` ou en secret

> **Note** : HelloAsso est une plateforme française de paiement en ligne pour les associations. Les paiements sont gratuits pour les associations, HelloAsso propose un pourboire optionnel aux payeurs.

---

## 6. Configurer Brevo (emails de facture)

1. Créez un compte sur [brevo.com](https://www.brevo.com/fr/)
2. Vérifiez votre domaine expéditeur (Settings → Senders & IP → Domains)
3. Générez une clé API (Settings → API Keys)
4. Mettez à jour `BREVO_FROM_EMAIL` dans `wrangler.toml` avec votre email vérifié

---

## 7. Déployer

```bash
npm install
npm run deploy
```

---

## 8. Accéder au panel admin

```
https://boutique-americanfullfightingbons.<sous-domaine>.workers.dev/admin
```

Entrez le mot de passe défini à l'étape 4. Le token de session est mémorisé dans le navigateur (24h).

---

## Routes API complètes

### Publiques

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET`   | `/`   | Boutique frontend |
| `GET`   | `/admin` | Panel admin |
| `GET`   | `/api/products` | Produits (stock > 0) |
| `GET`   | `/api/products?category=gants` | Filtrer par catégorie |
| `GET`   | `/api/products/:id` | Détail produit |
| `POST`  | `/api/orders` | Créer une commande |
| `GET`   | `/api/orders/:id` | Détail commande |
| `POST`  | `/api/checkout/:orderId` | Créer checkout HelloAsso |
| `GET`   | `/api/checkout/callback` | Callback retour HelloAsso |

### Admin (Bearer token requis)

| Méthode   | Route | Description |
|-----------|-------|-------------|
| `POST`    | `/api/admin/login` | Se connecter (retourne token) |
| `POST`    | `/api/admin/logout` | Déconnexion |
| `POST`    | `/api/admin/products` | Créer un produit |
| `PATCH`   | `/api/admin/products/:id` | Modifier prix/stock/etc. |
| `DELETE`  | `/api/admin/products/:id` | Supprimer un produit |
| `POST`    | `/api/admin/products/:id/image` | Uploader une image (multipart ou JSON url) |
| `PATCH`   | `/api/orders/:id` | Changer statut commande |
| `GET`     | `/api/admin/orders` | Toutes les commandes |
| `GET`     | `/api/admin/orders?status=pending` | Filtrer par statut |
| `GET`     | `/api/admin/stats` | Statistiques globales |
| `POST`    | `/api/admin/invoice/:orderId` | Envoyer facture par email (Brevo) |

---

## Exemples cURL

### Login admin
```bash
curl -X POST https://<worker-url>/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"password": "VotreMotDePasse"}'
# → { "token": "abc123...", "expires_at": "..." }

TOKEN="abc123..."
```

### Créer un produit
```bash
curl -X POST https://<worker-url>/api/admin/products \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Nouveau Produit",
    "category": "gants",
    "price": 49.99,
    "stock": 20,
    "emoji": "🥊",
    "badge": "Nouveau",
    "description": "Description du produit"
  }'
```

### Modifier le prix d'un produit
```bash
curl -X PATCH https://<worker-url>/api/admin/products/1 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"price": 54.99, "stock": 25}'
```

### Uploader une image
```bash
curl -X POST https://<worker-url>/api/admin/products/1/image \
  -H "Authorization: Bearer $TOKEN" \
  -F "image=@/chemin/vers/photo.jpg"
```

### Créer un checkout HelloAsso
```bash
curl -X POST https://<worker-url>/api/checkout/5 \
  -H "Content-Type: application/json"
# → { "checkout_url": "https://www.helloasso.com/..." }
```

### Envoyer une facture par email
```bash
curl -X POST https://<worker-url>/api/admin/invoice/5 \
  -H "Authorization: Bearer $TOKEN"
# → { "success": true, "message": "Facture envoyée à jean@example.com" }
```

---

## Développement local

```bash
npm run dev
# → http://localhost:8787
# → http://localhost:8787/admin
```

> En local, R2 et certains secrets peuvent ne pas être disponibles.
> Utilisez `.dev.vars` pour les secrets locaux :
> ```
> ADMIN_PASSWORD=test123
> BREVO_API_KEY=xkeysib-...
> HELLOASSO_CLIENT_ID=...
> HELLOASSO_CLIENT_SECRET=...
> ```

---

## GitHub Actions (déploiement continu)

```yaml
# .github/workflows/deploy.yml
name: Deploy Worker
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```
