# AFFB Boutique — Cloudflare Worker + D1

## Structure
```
affb-boutique/
├── src/
│   ├── worker.js     ← Worker principal (router + API)
│   └── index.html    ← Frontend (servi par le Worker)
├── schema.sql        ← Schéma + données initiales D1
├── wrangler.toml     ← Config Worker & binding D1
├── package.json
└── .gitignore
```

---

## 1. Prérequis

```bash
npm install -g wrangler
wrangler login          # ouvre le navigateur pour s'authentifier
```

---

## 2. Cloner / pousser sur GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/TON_USERNAME/affb-boutique.git
git push -u origin main
```

---

## 3. Initialiser la base D1

### En local (pour tester)
```bash
npm run db:init
```

### En production (Cloudflare)
```bash
npm run db:init:remote
```

---

## 4. Déployer le Worker

```bash
npm install
npm run deploy
```

L'URL du Worker apparaît dans la sortie :
`https://boutique-americanfullfightingbons.<ton-sous-domaine>.workers.dev`

---

## 5. Développement local

```bash
npm run dev
# → http://localhost:8787
```

---

## Routes API

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/` | Sert le frontend HTML |
| `GET` | `/api/products` | Tous les produits |
| `GET` | `/api/products?category=gants` | Filtrer par catégorie |
| `GET` | `/api/products/:id` | Détail d'un produit |
| `POST` | `/api/orders` | Créer une commande |
| `GET` | `/api/orders/:id` | Détail d'une commande |
| `PATCH` | `/api/orders/:id` | Changer le statut |
| `GET` | `/api/admin/orders` | Toutes les commandes |
| `GET` | `/api/admin/stats` | Stats globales |

### Exemple — créer une commande
```bash
curl -X POST https://<worker-url>/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customer_name": "Jean Dupont",
    "customer_email": "jean@example.com",
    "customer_phone": "06 12 34 56 78",
    "items": [
      { "product_id": 1, "quantity": 1 },
      { "product_id": 9, "quantity": 2 }
    ]
  }'
```

### Exemple — stats admin
```bash
curl https://<worker-url>/api/admin/stats
```

---

## Déploiement continu avec GitHub Actions (optionnel)

Crée `.github/workflows/deploy.yml` :

```yaml
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

Ajoute `CLOUDFLARE_API_TOKEN` dans les secrets GitHub
(Settings → Secrets → Actions).
