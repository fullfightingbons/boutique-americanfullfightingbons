// ============================================================
//  AFFB Boutique — Cloudflare Worker v2
//  Nouveautés :
//    • Panel admin protégé (login JWT-like, token D1)
//    • CRUD produits (prix, stock, ajout, suppression)
//    • Upload image produit (Cloudflare R2 ou base64 fallback)
//    • Checkout HelloAsso (API v5)
//    • Email facture PDF via Brevo (Sendinblue)
// ============================================================

import HTML       from './index.html';
import ADMIN_HTML from './admin.html';

// ── Variables d'environnement attendues (dashboard Cloudflare) ──
// ADMIN_PASSWORD   : mot de passe brut de l'administrateur
// HELLOASSO_CLIENT_ID     : OAuth2 client_id HelloAsso
// HELLOASSO_CLIENT_SECRET : OAuth2 client_secret HelloAsso
// HELLOASSO_ORG_SLUG      : slug de l'organisation HelloAsso (ex: "affb-bons")
// HELLOASSO_RETURN_URL    : URL de retour après paiement
// HELLOASSO_ERROR_URL     : URL en cas d'erreur de paiement
// BREVO_API_KEY    : clé API Brevo (ex-Sendinblue)
// BREVO_FROM_EMAIL : email expéditeur (doit être vérifié dans Brevo)
// BREVO_FROM_NAME  : nom expéditeur (ex: "AFFB Boutique")
// R2_BUCKET (binding Wrangler) : bucket R2 pour les images

// ── Router léger ─────────────────────────────────────────────────
function route(method, pathname, handler, adminOnly = false) {
  return { method, pathname, handler, adminOnly };
}

const routes = [
  // ── Frontend ──────────────────────────────────────────────────
  route('GET',   '/',                        serveHTML),
  route('GET',   '/admin',                   serveAdminHTML),

  // ── Auth admin ────────────────────────────────────────────────
  route('POST',  '/api/admin/login',         adminLogin),
  route('POST',  '/api/admin/logout',        adminLogout),

  // ── Produits publics ──────────────────────────────────────────
  route('GET',   '/api/products',            getProducts),
  route('GET',   '/api/products/:id',        getProduct),

  // ── Produits admin ────────────────────────────────────────────
  route('GET',   '/api/admin/products',      getAdminProducts, true),
  route('POST',  '/api/admin/products',      createProduct,    true),
  route('PATCH', '/api/admin/products/:id',  updateProduct,    true),
  route('DELETE','/api/admin/products/:id',  deleteProduct,    true),
  route('POST',  '/api/admin/products/:id/image', uploadImage, true),

  // ── Commandes ─────────────────────────────────────────────────
  route('POST',  '/api/orders',              createOrder),
  route('GET',   '/api/orders/:id',          getOrder),
  route('PATCH', '/api/orders/:id',          updateOrderStatus, true),
  route('GET',   '/api/admin/orders',        getAdminOrders,    true),
  route('GET',   '/api/admin/stats',         getStats,          true),

  // ── HelloAsso ─────────────────────────────────────────────────
  route('POST',  '/api/checkout/:orderId',   createCheckout),
  route('GET',   '/api/checkout/callback',   checkoutCallback),

  // ── Brevo invoice ─────────────────────────────────────────────
  route('POST',  '/api/admin/invoice/:orderId', sendInvoice,   true),

  // Note : la route GET /images/:key est gérée directement dans le
  // fetch handler (avant ce tableau) pour supporter les clés avec
  // sous-chemins (ex: products/1-xxx.jpg). Ne pas la redéclarer ici.
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), request);

    // Route spéciale : images R2 (clé avec sous-chemin ex: products/1-xxx.jpg)
    if (request.method === 'GET' && pathname.startsWith('/images/')) {
      try {
        const res = await serveImage(request, env, {}, url);
        return cors(res, request);
      } catch (err) {
        return cors(new Response('Erreur image', { status: 500 }), request);
      }
    }

    for (const r of routes) {
      const params = matchRoute(r.pathname, pathname);
      if (params !== null && r.method === request.method) {
        try {
          // Vérification token admin si route protégée
          if (r.adminOnly) {
            const authResult = await checkAdminAuth(request, env);
            if (!authResult.ok) return cors(json({ error: 'Non autorisé' }, 401), request);
          }
          const res = await r.handler(request, env, params, url);
          return cors(res, request);
        } catch (err) {
          console.error(err);
          return cors(json({ error: 'Erreur serveur', detail: err.message }, 500), request);
        }
      }
    }

    return cors(json({ error: 'Route introuvable' }, 404), request);
  },
};

// ── Helpers généraux ─────────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
  });
}

function cors(response, request) {
  const r = new Response(response.body, response);
  // Origines autorisées : domaine boutique + workers.dev pour le dev local.
  // Ajuster si le domaine custom change.
  const ALLOWED_ORIGINS = [
    'https://boutique.americanfullfightingbons.fr',
    'https://boutique-americanfullfightingbons.workers.dev',
  ];
  const origin = request?.headers?.get('Origin') || '';
  // En dev local (wrangler dev), origin est vide ou localhost — on laisse passer.
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : (origin ? null : '*');
  if (allowedOrigin) {
    r.headers.set('Access-Control-Allow-Origin', allowedOrigin);
  }
  r.headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (allowedOrigin && allowedOrigin !== '*') {
    r.headers.set('Vary', 'Origin');
  }
  return r;
}

function matchRoute(pattern, pathname) {
  const pp = pattern.split('/');
  const ph = pathname.split('/');
  if (pp.length !== ph.length) return null;
  const params = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(':')) {
      params[pp[i].slice(1)] = decodeURIComponent(ph[i]);
    } else if (pp[i] !== ph[i]) return null;
  }
  return params;
}

function randomToken(len = 48) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return [...arr].map(b => b.toString(16).padStart(2, '0')).join('');
}

function getAuthToken(request) {
  const h = request.headers.get('Authorization') || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return null;
}

// ── Admin Auth ───────────────────────────────────────────────────

async function checkAdminAuth(request, env) {
  const token = getAuthToken(request);
  if (!token) return { ok: false };
  const session = await env.DB.prepare(
    "SELECT * FROM admin_sessions WHERE token = ? AND expires_at > datetime('now')"
  ).bind(token).first();
  return { ok: !!session };
}

// POST /api/admin/login  — body: { password }
async function adminLogin(request, env) {
  const { password } = await request.json();
  if (!password || password !== env.ADMIN_PASSWORD) {
    return json({ error: 'Mot de passe incorrect' }, 401);
  }
  const token = randomToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  await env.DB.prepare(
    'INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)'
  ).bind(token, expiresAt).run();
  // Nettoyage des sessions expirées (évite la croissance indéfinie de la table)
  await env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at <= datetime('now')").run();
  return json({ token, expires_at: expiresAt });
}

// POST /api/admin/logout
async function adminLogout(request, env) {
  const token = getAuthToken(request);
  if (token) await env.DB.prepare('DELETE FROM admin_sessions WHERE token = ?').bind(token).run();
  return json({ success: true });
}

// ── Serveur HTML ─────────────────────────────────────────────────

async function serveHTML() {
  return new Response(HTML, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
}

async function serveAdminHTML() {
  return new Response(ADMIN_HTML, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
}

// ── Produits publics ─────────────────────────────────────────────

async function getProducts(request, env, _p, url) {
  const category = url.searchParams.get('category');
  let query, args;
  if (category && category !== 'tous') {
    query = 'SELECT * FROM products WHERE category = ? AND stock > 0 ORDER BY id';
    args  = [category];
  } else {
    query = 'SELECT * FROM products WHERE stock > 0 ORDER BY id';
    args  = [];
  }
  const { results } = await env.DB.prepare(query).bind(...args).all();
  const parsed = results.map(p => ({
    ...p,
    sizes:       p.sizes       ? JSON.parse(p.sizes)       : [],
    size_stocks: p.size_stocks ? JSON.parse(p.size_stocks) : null,
  }));
  return json(parsed);
}

async function getProduct(_req, env, params) {
  const product = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(params.id).first();
  if (!product) return json({ error: 'Produit introuvable' }, 404);
  return json({
    ...product,
    sizes:       product.sizes       ? JSON.parse(product.sizes)       : [],
    size_stocks: product.size_stocks ? JSON.parse(product.size_stocks) : null,
  });
}

// ── Produits admin ───────────────────────────────────────────────

// GET /api/admin/products — tous les produits y compris stock = 0
async function getAdminProducts(_req, env) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM products ORDER BY id'
  ).all();
  return json(Array.isArray(results) ? results : []);
}

// POST /api/admin/products
// Body: { name, category, price, price_old?, emoji, badge?, stock, description?, sizes? }
async function createProduct(request, env) {
  const body = await request.json();
  const { name, category, price, price_old, emoji, badge, stock, description, sizes, size_stocks } = body;
  if (!name || !category || price == null) {
    return json({ error: 'Champs obligatoires : name, category, price' }, 400);
  }

  const sizesJson      = sizes && sizes.length ? JSON.stringify(sizes) : null;
  const sizeStocksJson = size_stocks && Object.keys(size_stocks).length ? JSON.stringify(size_stocks) : null;

  // Stock = somme des tailles si size_stocks fourni, sinon stock brut
  const computedStock = sizeStocksJson
  ? totalStockFromSizes(sizeStocksJson)
  : (stock ?? 0);

  const result = await env.DB.prepare(
    `INSERT INTO products (name, category, price, price_old, emoji, badge, stock, description, sizes, size_stocks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(name, category, price, price_old ?? null, emoji ?? '📦', badge ?? null, computedStock, description ?? null, sizesJson, sizeStocksJson).run();

  return json({ success: true, id: result.meta.last_row_id }, 201);
}

// PATCH /api/admin/products/:id
// Body: { name?, category?, price?, price_old?, emoji?, badge?, stock?, description?, sizes?, size_stocks? }
async function updateProduct(request, env, params) {
  const body = await request.json();
  const fields = ['name', 'category', 'price', 'price_old', 'emoji', 'badge', 'stock', 'description', 'sizes', 'size_stocks'];
  const sets = [];
  const values = [];
  for (const f of fields) {
    if (f in body) {
      if (f === 'size_stocks') {
        const ss = body[f] && Object.keys(body[f]).length ? JSON.stringify(body[f]) : null;
        sets.push('size_stocks = ?');
        values.push(ss);
        // Mettre à jour le stock global automatiquement
        const total = totalStockFromSizes(ss);
        if (total !== null) {
          sets.push('stock = ?');
          values.push(total);
        }
      } else if (f === 'sizes') {
        sets.push('sizes = ?');
        values.push(body[f] && body[f].length ? JSON.stringify(body[f]) : null);
      } else {
        sets.push(`${f} = ?`);
        values.push(body[f]);
      }
    }
  }
  if (!sets.length) return json({ error: 'Aucun champ à mettre à jour' }, 400);
  sets.push("updated_at = datetime('now')");
  values.push(params.id);
  await env.DB.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
  return json({ success: true });
}

// DELETE /api/admin/products/:id
async function deleteProduct(_req, env, params) {
  await env.DB.prepare('DELETE FROM products WHERE id = ?').bind(params.id).run();
  return json({ success: true });
}

// POST /api/admin/products/:id/image
// Body: multipart/form-data avec champ "image" (fichier)
// Stockage : R2 si binding disponible, sinon base64 en BDD (max ~500KB)
async function uploadImage(request, env, params) {
  const contentType = request.headers.get('Content-Type') || '';

  // ── Cas 1 : multipart form-data (fichier)
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const file = formData.get('image');
    if (!file) return json({ error: 'Champ "image" manquant' }, 400);

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      return json({ error: 'Format non supporté (jpg, png, webp, gif)' }, 400);
    }

    const ext  = file.type.split('/')[1].replace('jpeg', 'jpg');
    const key  = `products/${params.id}-${Date.now()}.${ext}`;
    const buffer = await file.arrayBuffer();

    // Si binding R2 disponible
    if (env.R2_BUCKET) {
      await env.R2_BUCKET.put(key, buffer, { httpMetadata: { contentType: file.type } });
      // URL interne servie par la route GET /images/:key
      const imageUrl = `/images/${key}`;
      await env.DB.prepare("UPDATE products SET image_url = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(imageUrl, params.id).run();
      return json({ success: true, image_url: imageUrl });
    }

    // Fallback : base64 (ok pour petites images <500KB)
    const uint8 = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < uint8.length; i += chunkSize) {
      binary += String.fromCharCode(...uint8.subarray(i, i + chunkSize));
    }
    const b64 = btoa(binary);
    const dataUrl = `data:${file.type};base64,${b64}`;
    await env.DB.prepare('UPDATE products SET image_url = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .bind(dataUrl, params.id).run();
    return json({ success: true, image_url: dataUrl });
  }

  // ── Cas 2 : JSON avec URL externe (ou null pour supprimer)
  const body = await request.json();
  const image_url = body.image_url ?? null;
  await env.DB.prepare("UPDATE products SET image_url = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(image_url, params.id).run();
  return json({ success: true, image_url });
}

// ── Commandes ────────────────────────────────────────────────────

async function createOrder(request, env) {
  const body = await request.json();
  const { customer_name, customer_email, customer_phone, notes, items } = body;

  if (!customer_name || !customer_email || !items?.length) {
    return json({ error: 'Champs obligatoires manquants : customer_name, customer_email, items' }, 400);
  }

  // Validation basique de l'email côté serveur
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer_email)) {
    return json({ error: 'Adresse email invalide' }, 400);
  }

  let total = 0;
  const enrichedItems = [];

  for (const item of items) {
    if (!item.product_id || !item.quantity || item.quantity < 1) {
      return json({ error: `Item invalide : ${JSON.stringify(item)}` }, 400);
    }
    const product = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(item.product_id).first();
    if (!product) return json({ error: `Produit #${item.product_id} introuvable` }, 404);
    const sizes = product.sizes ? JSON.parse(product.sizes) : [];
    const sizeStocks = product.size_stocks ? JSON.parse(product.size_stocks) : null;
    const requestedSize = item.size || null;

    if (sizes.length > 0) {
      if (!requestedSize || !sizes.includes(requestedSize)) {
        return json({ error: `Taille invalide pour "${product.name}"` }, 400);
      }
      const availableForSize = Number(sizeStocks?.[requestedSize] ?? 0);
      if (availableForSize < item.quantity) {
        return json({ error: `Stock insuffisant pour "${product.name}" en taille ${requestedSize} (stock: ${availableForSize})` }, 409);
      }
    } else if (requestedSize) {
      return json({ error: `Aucune taille attendue pour "${product.name}"` }, 400);
    }

    if (product.stock < item.quantity) {
      return json({ error: `Stock insuffisant pour "${product.name}" (stock: ${product.stock})` }, 409);
    }
    total += product.price * item.quantity;
    enrichedItems.push({
      ...item,
      size: requestedSize,
      product_name: requestedSize ? `${product.name} (${requestedSize})` : product.name,
      unit_price: product.price,
      _product: product,
    });
  }

  const orderResult = await env.DB.prepare(
    'INSERT INTO orders (customer_name, customer_email, customer_phone, total, notes) VALUES (?, ?, ?, ?, ?)'
  ).bind(customer_name, customer_email, customer_phone ?? null, total, notes ?? null).run();

  const orderId = orderResult.meta.last_row_id;

  for (const item of enrichedItems) {
    await env.DB.prepare(
      'INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price) VALUES (?, ?, ?, ?, ?)'
    ).bind(orderId, item.product_id, item.product_name, item.quantity, item.unit_price).run();

    // ── Décrémenter le stock immédiatement à la création de la commande
    // (réservation optimiste). finalizePaidOrder ne redécrément pas.
    const product = item._product;
    const sizes = product.sizes ? JSON.parse(product.sizes) : [];
    if (item.size && sizes.length > 0) {
      const sizeStocks = product.size_stocks ? JSON.parse(product.size_stocks) : {};
      sizeStocks[item.size] = Math.max(0, (Number(sizeStocks[item.size]) || 0) - item.quantity);
      await env.DB.prepare(
        "UPDATE products SET stock = MAX(0, stock - ?), size_stocks = ?, updated_at = datetime('now') WHERE id = ?"
      ).bind(item.quantity, JSON.stringify(sizeStocks), item.product_id).run();
    } else {
      await env.DB.prepare(
        "UPDATE products SET stock = MAX(0, stock - ?), updated_at = datetime('now') WHERE id = ?"
      ).bind(item.quantity, item.product_id).run();
    }
  }

  return json({ success: true, order_id: orderId, total, status: 'pending_payment' }, 201);
}

async function getOrder(_req, env, params) {
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(params.id).first();
  if (!order) return json({ error: 'Commande introuvable' }, 404);
  const { results: items } = await env.DB.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(params.id).all();
  return json({ ...order, items });
}

async function updateOrderStatus(request, env, params) {
  const { status } = await request.json();
  const allowed = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
  if (!allowed.includes(status)) {
    return json({ error: `Statut invalide. Valeurs acceptées : ${allowed.join(', ')}` }, 400);
  }

  // Si la commande passe en "cancelled", recréditer le stock des articles.
  // Le stock avait été décrémenté lors de createOrder (réservation optimiste).
  if (status === 'cancelled') {
    const order = await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(params.id).first();
    // Ne recréditer que si la commande n'était pas déjà annulée
    if (order && order.status !== 'cancelled') {
      const { results: items } = await env.DB.prepare(
        'SELECT * FROM order_items WHERE order_id = ?'
      ).bind(params.id).all();

      for (const item of items) {
        // Détecter la taille depuis le nom du produit ex: "T-shirt (M)"
        const sizeMatch = /\(([^()]+)\)\s*$/.exec(item.product_name || '');
        const itemSize = sizeMatch ? sizeMatch[1] : null;

        if (itemSize) {
          const current = await env.DB.prepare(
            'SELECT size_stocks FROM products WHERE id = ?'
          ).bind(item.product_id).first();
          const sizeStocks = current?.size_stocks ? JSON.parse(current.size_stocks) : {};
          sizeStocks[itemSize] = (Number(sizeStocks[itemSize]) || 0) + item.quantity;
          await env.DB.prepare(
            "UPDATE products SET stock = stock + ?, size_stocks = ?, updated_at = datetime('now') WHERE id = ?"
          ).bind(item.quantity, JSON.stringify(sizeStocks), item.product_id).run();
        } else {
          await env.DB.prepare(
            "UPDATE products SET stock = stock + ?, updated_at = datetime('now') WHERE id = ?"
          ).bind(item.quantity, item.product_id).run();
        }
      }
    }
  }

  await env.DB.prepare('UPDATE orders SET status = ? WHERE id = ?').bind(status, params.id).run();
  return json({ success: true, order_id: Number(params.id), status });
}

async function getAdminOrders(_req, env, _params, url) {
  const status = url.searchParams.get('status');
  let query, args;
  if (status) {
    query = 'SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC LIMIT 100';
    args  = [status];
  } else {
    query = 'SELECT * FROM orders ORDER BY created_at DESC LIMIT 100';
    args  = [];
  }
  const { results } = await env.DB.prepare(query).bind(...args).all();
  return json(results);
}

async function getStats(_req, env) {
  const [products, orders, revenue, lowStock, allProducts] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) as count FROM products').first(),
    env.DB.prepare('SELECT COUNT(*) as count FROM orders').first(),
    env.DB.prepare("SELECT COALESCE(SUM(total),0) as total FROM orders WHERE status != 'cancelled'").first(),
    env.DB.prepare('SELECT * FROM products WHERE stock <= 3 ORDER BY stock').all(),
    env.DB.prepare('SELECT id, name, category, size_stocks FROM products WHERE size_stocks IS NOT NULL').all(),
  ]);
  const lowSizeStock = [];
  for (const product of allProducts.results) {
    const sizeStocks = product.size_stocks ? JSON.parse(product.size_stocks) : null;
    if (!sizeStocks) continue;
    for (const [size, qty] of Object.entries(sizeStocks)) {
      const quantity = Number(qty) || 0;
      if (quantity <= 3) {
        lowSizeStock.push({
          product_id: product.id,
          product_name: product.name,
          category: product.category,
          size,
          stock: quantity,
        });
      }
    }
  }
  return json({
    total_products: products.count,
    total_orders:   orders.count,
    total_revenue:  revenue.total,
    low_stock:      lowStock.results,
    low_size_stock: lowSizeStock,
  });
}

// ── HelloAsso Checkout ───────────────────────────────────────────
// Doc : https://api.helloasso.com/swagger/index.html (v5)

async function getHelloAssoToken(env) {
  const res = await fetch('https://api.helloasso.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     env.HELLOASSO_CLIENT_ID,
      client_secret: env.HELLOASSO_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`HelloAsso OAuth2 error: ${res.status}`);
  const { access_token } = await res.json();
  return access_token;
}

// POST /api/checkout/:orderId
// Crée un checkout HelloAsso et retourne l'URL de paiement
async function createCheckout(request, env, params) {
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(params.orderId).first();
  if (!order) return json({ error: 'Commande introuvable' }, 404);
  if (order.status === 'confirmed') {
    return json({ error: 'Commande déjà payée' }, 409);
  }

  const { results: items } = await env.DB.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(params.orderId).all();

  // Obtenir le token HelloAsso
  const token = await getHelloAssoToken(env);

  // Construire le payload HelloAsso
  // Les montants sont en centimes
  const totalCents = Math.round(order.total * 100);
  const origin = new URL(request.url).origin;
  const callbackUrl = new URL('/api/checkout/callback', origin);
  callbackUrl.searchParams.set('orderId', String(order.id));
  const checkoutPayload = {
    totalAmount:  totalCents,
    initialAmount: totalCents,
    itemName: `Commande AFFB #${order.id}`,
    backUrl:   buildCheckoutReturnUrl(env.HELLOASSO_RETURN_URL || origin, order.id, 'back'),
    errorUrl:  buildCheckoutReturnUrl(env.HELLOASSO_ERROR_URL || env.HELLOASSO_RETURN_URL || origin, order.id, 'failed'),
    returnUrl: callbackUrl.toString(),
    containsDonation: false,
    payer: {
      firstName: order.customer_name.split(' ')[0] || order.customer_name,
      lastName:  order.customer_name.split(' ').slice(1).join(' ') || '.',
      email:     order.customer_email,
    },
    metadata: {
      orderId: String(order.id),
    },
  };

  const checkoutRes = await fetch(
    `https://api.helloasso.com/v5/organizations/${env.HELLOASSO_ORG_SLUG}/checkout-intents`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(checkoutPayload),
    }
  );

  if (!checkoutRes.ok) {
    const errText = await checkoutRes.text();
    throw new Error(`HelloAsso checkout error ${checkoutRes.status}: ${errText}`);
  }

  const checkoutData = await checkoutRes.json();
  const redirectUrl  = checkoutData.redirectUrl;
  const checkoutId   = checkoutData.id;

  // Sauvegarder l'ID et l'URL HelloAsso dans la commande
  await env.DB.prepare(
    'UPDATE orders SET helloasso_id = ?, helloasso_url = ? WHERE id = ?'
  ).bind(String(checkoutId), redirectUrl, params.orderId).run();

  return json({ success: true, checkout_url: redirectUrl, checkout_id: checkoutId });
}

// GET /api/checkout/callback?orderId=...&code=...
// Appelé après le paiement HelloAsso (webhook ou retour navigateur)
async function checkoutCallback(request, env, _params, url) {
  const callbackInfo = await resolveCheckoutCallbackOrder(env, url);
  if (!callbackInfo.orderId) {
    return json({ error: 'Impossible de retrouver la commande depuis le callback HelloAsso' }, 400);
  }

  if (isHelloAssoSuccess(url)) {
    try {
      await finalizePaidOrder(env, callbackInfo.orderId);
    } catch (err) {
      console.error('Checkout finalize failed', err);
      return Response.redirect(
        buildCheckoutReturnUrl(env.HELLOASSO_ERROR_URL || env.HELLOASSO_RETURN_URL || env.HELLOASSO_RETURN_URL || '/', callbackInfo.orderId, 'invoice_error'),
        302
      );
    }
    // Rediriger vers la boutique
    return Response.redirect(
      buildCheckoutReturnUrl(env.HELLOASSO_RETURN_URL || '/', callbackInfo.orderId, 'success'),
      302
    );
  }

  return Response.redirect(
    buildCheckoutReturnUrl(env.HELLOASSO_ERROR_URL || '/', callbackInfo.orderId, 'failed'),
    302
  );
}

// ── Brevo — Envoi email avec facture HTML inline ─────────────────
// Doc : https://developers.brevo.com/reference/sendtransacemail

// POST /api/admin/invoice/:orderId
async function sendInvoice(request, env, params) {
  const result = await sendInvoiceForOrder(env, params.orderId);
  return json({
    success: result.sent,
    message: result.sent
      ? `Facture PDF envoyée à ${result.recipients.join(', ')}`
      : 'Envoi facture non effectué',
    recipients: result.recipients,
  });
}

async function sendInvoiceForOrder(env, orderId) {
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
  if (!order) throw new Error('Commande introuvable');

  const { results: items } = await env.DB.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(orderId).all();
  const recipients = [
    order.customer_email,
    env.BREVO_CLUB_EMAIL || 'fullfightingbons@gmail.com',
  ].filter(Boolean);

  const invoicePdfBase64 = buildInvoicePdfBase64(order, items, env);
  const emailPayload = {
    sender: {
      name:  env.BREVO_FROM_NAME  || 'AFFB Boutique',
      email: env.BREVO_FROM_EMAIL || 'boutique@americanfullfightingbons.fr',
    },
    to: recipients.map(email => ({
      email,
      name: email === order.customer_email ? order.customer_name : 'Club AFFB',
    })),
    subject: `Commande AFFB #${order.id} — Facture PDF`,
    htmlContent: buildEmailHtml(order, items, env),
    attachment: [
      {
        name:    `facture-affb-${String(order.id).padStart(6, '0')}.pdf`,
        content: invoicePdfBase64,
      },
    ],
  };

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key':      env.BREVO_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(emailPayload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Brevo error ${res.status}: ${err}`);
  }

  await env.DB.prepare('UPDATE orders SET invoice_sent = 1 WHERE id = ?').bind(orderId).run();
  return { attempted: true, sent: true, recipients };
}

async function finalizePaidOrder(env, orderId) {
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
  if (!order) throw new Error('Commande introuvable');
  if (order.status === 'confirmed' && order.invoice_sent) {
    return { confirmed: true, invoice_sent: true, skipped: true };
  }

  // Note : le stock a déjà été décrémenté lors de createOrder (réservation
  // optimiste). On ne le redécrémente pas ici pour éviter une double déduction.

  await env.DB.prepare("UPDATE orders SET status = 'confirmed' WHERE id = ?").bind(orderId).run();
  const invoice = await sendInvoiceForOrder(env, orderId);
  return { confirmed: true, invoice_sent: invoice.sent };
}

// Décode un état HelloAsso encodé en base64+JSON (optionnel dans certains flows).
// Retourne l'orderId si trouvé, sinon null — ne throw jamais.
function decodeHelloAssoState(val) {
  if (!val) return null;
  try {
    const decoded = JSON.parse(atob(val));
    return decoded?.orderId ? String(decoded.orderId) : null;
  } catch {
    return null;
  }
}

async function resolveCheckoutCallbackOrder(env, url) {
  const directOrderId =
    url.searchParams.get('orderId') ||
    url.searchParams.get('order') ||
    decodeHelloAssoState(url.searchParams.get('state')) ||
    decodeHelloAssoState(url.searchParams.get('metadata'));

  if (directOrderId) {
    return { orderId: directOrderId, source: 'query' };
  }

  const checkoutIntentId =
    url.searchParams.get('checkoutIntentId') ||
    url.searchParams.get('checkoutIntent') ||
    url.searchParams.get('id') ||
    url.searchParams.get('helloasso_id');

  if (checkoutIntentId) {
    const order = await env.DB.prepare(
      'SELECT id FROM orders WHERE helloasso_id = ? LIMIT 1'
    ).bind(String(checkoutIntentId)).first();
    if (order?.id) {
      return { orderId: String(order.id), source: 'helloasso_id' };
    }
  }

  return { orderId: null, source: 'unresolved' };
}

// ── Générateur email HTML (corps du message Brevo) ───────────────
function buildEmailHtml(order, items, env) {
  const contactEmail = (env && env.BREVO_CLUB_EMAIL) || 'fullfightingbons@gmail.com';
  const date = new Date(order.created_at).toLocaleDateString('fr-FR', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const rows = items.map(i => `
    <tr>
      <td style="padding:10px 16px;border-bottom:1px solid #333">${i.product_name}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #333;text-align:center">${i.quantity}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #333;text-align:right">${(i.unit_price * i.quantity).toFixed(2)} €</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,sans-serif;background:#0A0A0B;color:#F0EFE8;margin:0;padding:0">
  <div style="max-width:600px;margin:0 auto">
    <div style="background:#C8181A;padding:32px 40px;text-align:center">
      <h1 style="margin:0;font-size:32px;font-weight:900;letter-spacing:2px;color:#fff">AFFBC BOUTIQUE</h1>
      <p style="margin:8px 0 0;color:rgba(255,255,255,0.8);font-size:14px">American Full Fighting Bons-en-Chablais</p>
    </div>
    <div style="background:#111114;padding:40px">
      <h2 style="margin:0 0 8px;color:#fff;font-size:22px">Merci pour votre commande, ${order.customer_name.split(' ')[0]} !</h2>
      <p style="color:#888;margin:0 0 24px;font-size:14px">Commande #${String(order.id).padStart(6,'0')} — ${date}</p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
        <thead>
          <tr style="background:#C8181A">
            <th style="padding:10px 16px;text-align:left;color:#fff;font-size:13px">Produit</th>
            <th style="padding:10px 16px;text-align:center;color:#fff;font-size:13px">Qté</th>
            <th style="padding:10px 16px;text-align:right;color:#fff;font-size:13px">Total</th>
          </tr>
        </thead>
        <tbody style="color:#ddd">${rows}</tbody>
        <tfoot>
          <tr>
            <td colspan="2" style="padding:14px 16px;text-align:right;font-weight:700;color:#fff">TOTAL</td>
            <td style="padding:14px 16px;text-align:right;font-weight:700;font-size:20px;color:#C8181A">${order.total.toFixed(2)} €</td>
          </tr>
        </tfoot>
      </table>

      <p style="color:#888;font-size:14px;line-height:1.7">
        Votre commande est <strong style="color:#fff">${statusLabel(order.status)}</strong>.<br/>
        La facture PDF est jointe à cet email et transmise aussi au club.<br/><br/>
        Pour toute question : <a href="mailto:${contactEmail}" style="color:#C8181A">${contactEmail}</a>
      </p>
    </div>
    <div style="background:#0A0A0B;padding:20px 40px;text-align:center;border-top:1px solid #1A1A1F">
      <p style="color:#555;font-size:12px;margin:0">© ${new Date().getFullYear()} American Full Fighting Bons-en-Chablais<br/>
      146 Rue du Châtelard, 74890 Bons-en-Chablais</p>
    </div>
  </div>
</body>
</html>`;
}

// GET /images/:key — sert une image depuis R2
// La clé peut contenir un slash (ex: products/1-123456.jpg)
// On bypass le router pour cette route dans le fetch handler
async function serveImage(request, env, _params, url) {
  if (!env.R2_BUCKET) return new Response('R2 non configuré', { status: 503 });
  // Extraire la clé complète depuis le pathname (tout après /images/)
  const key = url.pathname.replace(/^\/images\//, '');
  if (!key) return new Response('Clé manquante', { status: 400 });
  const object = await env.R2_BUCKET.get(key);
  if (!object) return new Response('Image introuvable', { status: 404 });
  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'image/jpeg');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  return new Response(object.body, { headers });
}

function statusLabel(status) {
  const map = {
    pending:   'En attente',
    confirmed: 'Confirmée',
    shipped:   'Expédiée',
    delivered: 'Livrée',
    cancelled: 'Annulée',
  };
  return map[status] || status;
}

// Calcule le stock total à partir d'un objet size_stocks JSON
// Si size_stocks est null/vide, retourne le stock brut
function totalStockFromSizes(sizeStocksJson) {
  if (!sizeStocksJson) return null;
  try {
    const obj = typeof sizeStocksJson === 'string' ? JSON.parse(sizeStocksJson) : sizeStocksJson;
    return Object.values(obj).reduce((sum, v) => sum + (Number(v) || 0), 0);
  } catch {
    return null;
  }
}

function normalizePdfText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pdfEscape(text) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildSimplePdfBase64(lines) {
  const pageWidth = 595;
  const pageHeight = 842;
  const marginLeft = 48;
  const marginTop = 64;
  const lineHeight = 16;
  const maxLinesPerPage = 44;
  const pages = [];
  for (let i = 0; i < lines.length; i += maxLinesPerPage) {
    pages.push(lines.slice(i, i + maxLinesPerPage));
  }

  const objects = [];
  let objectId = 1;

  const catalogId = objectId++;
  const pagesId = objectId++;
  const fontId = objectId++;
  const pageObjectIds = [];
  const contentObjectIds = [];

  for (let i = 0; i < pages.length; i++) {
    pageObjectIds.push(objectId++);
    contentObjectIds.push(objectId++);
  }

  objects[catalogId] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[fontId] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

  pages.forEach((pageLines, index) => {
    const content = [
      'BT',
      '/F1 12 Tf',
      `${marginLeft} ${pageHeight - marginTop} Td`,
      ...pageLines.map((line, lineIndex) => {
        const escaped = pdfEscape(line);
        return lineIndex === 0
          ? `(${escaped}) Tj`
          : `0 -${lineHeight} Td (${escaped}) Tj`;
      }),
      'ET',
    ].join('\n');

    const contentBytes = new TextEncoder().encode(content);
    objects[contentObjectIds[index]] = `<< /Length ${contentBytes.length} >>\nstream\n${content}\nendstream`;
    objects[pageObjectIds[index]] =
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentObjectIds[index]} 0 R >>`;
  });

  objects[pagesId] = `<< /Type /Pages /Count ${pageObjectIds.length} /Kids [${pageObjectIds.map(id => `${id} 0 R`).join(' ')}] >>`;

  const entries = [];
  let pdf = '%PDF-1.4\n';
  for (let id = 1; id < objects.length; id++) {
    entries[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += '0000000000 65535 f \n';
  for (let id = 1; id < objects.length; id++) {
    pdf += `${String(entries[id]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return btoa(pdf);
}

function buildInvoicePdfBase64(order, items, env) {
  const date = new Date(order.created_at).toLocaleDateString('fr-FR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  });

  const customerName = normalizePdfText(order.customer_name);
  const customerEmail = normalizePdfText(order.customer_email);
  const customerPhone = normalizePdfText(order.customer_phone || '');
  const orderNote = normalizePdfText(order.notes || '');
  const status = normalizePdfText(statusLabel(order.status));
  const totalText = `${Number(order.total).toFixed(2)} EUR`;
  const clubEmail = normalizePdfText((env && env.BREVO_CLUB_EMAIL) || 'fullfightingbons@gmail.com');
  const boutiqueEmail = normalizePdfText((env && env.BREVO_FROM_EMAIL) || 'fullfightingbons@gmail.com');
  const clubSite = normalizePdfText(envSafeValue('www.americanfullfightingbons.fr'));

  let y = 790;
  const left = 46;
  const right = 549;
  const content = [];

  const push = (line) => content.push(line);
  const text = (x, yPos, value, font = 'F1', size = 12) => {
    push('BT');
    push(`/${font} ${size} Tf`);
    push(`${x} ${yPos} Td`);
    push(`(${pdfEscape(normalizePdfText(value))}) Tj`);
    push('ET');
  };
  const rect = (x, yPos, w, h, fillRgb = null, strokeRgb = null, lineWidth = 1) => {
    if (fillRgb) push(`${fillRgb.join(' ')} rg`);
    if (strokeRgb) {
      push(`${strokeRgb.join(' ')} RG`);
      push(`${lineWidth} w`);
    }
    push(`${x} ${yPos} ${w} ${h} re`);
    push(fillRgb && strokeRgb ? 'B' : fillRgb ? 'f' : 'S');
  };
  const hr = (yPos, x1 = left, x2 = right, rgb = [0.82, 0.82, 0.82]) => {
    push(`${rgb.join(' ')} RG`);
    push('1 w');
    push(`${x1} ${yPos} m`);
    push(`${x2} ${yPos} l`);
    push('S');
  };
  const image = (name, x, yPos, w, h) => {
    push('q');
    push(`${w} 0 0 ${h} ${x} ${yPos} cm`);
    push(`/${name} Do`);
    push('Q');
  };

  push('0.78 0.09 0.10 rg');
  push(`${left} 748 ${right - left} 66 re`);
  push('f');
  // Cercle blanc autour du logo
  const cx = left + 12 + 22; // 80
  const cy = 781;
  const r = 27;
  const k = parseFloat((0.5523 * r).toFixed(3));
  push('1.0 1.0 1.0 rg');
  push(`${cx - r} ${cy} m`);
  push(`${cx - r} ${cy + k} ${cx - k} ${cy + r} ${cx} ${cy + r} c`);
  push(`${cx + k} ${cy + r} ${cx + r} ${cy + k} ${cx + r} ${cy} c`);
  push(`${cx + r} ${cy - k} ${cx + k} ${cy - r} ${cx} ${cy - r} c`);
  push(`${cx - k} ${cy - r} ${cx - r} ${cy - k} ${cx - r} ${cy} c`);
  push('h f');
  // Logo centré dans le cercle
  image('Im1', left + 12 + 2, 756 + 2, 40, 44);
  text(left + 70, 792, 'AFFBC BOUTIQUE', 'F2', 24);
  text(left + 70, 776, 'American Full Fighting Bons-en-Chablais', 'F1', 11);
  text(left + 70, 762, 'Boutique officielle du club', 'F1', 10);

  text(386, 792, 'FACTURE', 'F2', 22);
  text(386, 776, `N° ${String(order.id).padStart(6, '0')}`, 'F1', 11);
  text(386, 762, `Date : ${date}`, 'F1', 10);

  rect(left, 676, 242, 62, [0.97, 0.97, 0.97], [0.88, 0.88, 0.88], 1);
  text(left + 14, 722, 'CLIENT', 'F2', 12);
  text(left + 14, 704, customerName, 'F1', 11);
  text(left + 14, 688, customerEmail, 'F1', 10);
  if (customerPhone) text(left + 14, 674, customerPhone, 'F1', 10);

  rect(308, 676, 241, 62, [0.97, 0.97, 0.97], [0.88, 0.88, 0.88], 1);
  text(322, 722, 'DETAILS DE COMMANDE', 'F2', 12);
  text(322, 704, `Statut : ${status}`, 'F1', 11);
  text(322, 688, `Total : ${totalText}`, 'F1', 10);
  if (orderNote) {
    text(322, 674, `Note : ${orderNote.slice(0, 34)}`, 'F1', 9);
  }

  rect(left, 620, right - left, 26, [0.78, 0.09, 0.10], null, 0);
  text(left + 12, 628, 'Produit', 'F2', 11);
  text(360, 628, 'Qte', 'F2', 11);
  text(418, 628, 'Prix unit.', 'F2', 11);
  text(486, 628, 'Total', 'F2', 11);

  y = 610;
  items.forEach((item, index) => {
    const lineTotal = `${(item.unit_price * item.quantity).toFixed(2)} EUR`;
    const unitPrice = `${Number(item.unit_price).toFixed(2)} EUR`;
    const label = normalizePdfText(item.product_name).slice(0, 52);
    if (index % 2 === 0) rect(left, y - 14, right - left, 20, [0.985, 0.985, 0.985], null, 0);
    text(left + 12, y, label, 'F1', 10);
    text(364, y, String(item.quantity), 'F1', 10);
    text(418, y, unitPrice, 'F1', 10);
    text(486, y, lineTotal, 'F1', 10);
    y -= 20;
  });

  hr(y - 4);
  rect(372, y - 34, 177, 28, [0.07, 0.07, 0.08], null, 0);
  text(386, y - 17, 'TOTAL', 'F2', 12);
  text(472, y - 17, totalText, 'F2', 12);

  rect(left, 124, 242, 54, [0.97, 0.97, 0.97], [0.88, 0.88, 0.88], 1);
  text(left + 12, 162, 'COORDONNEES CLUB', 'F2', 11);
  text(left + 12, 146, 'American Full Fighting Bons-en-Chablais', 'F1', 10);
  text(left + 12, 132, '146 Rue du Chatelard, 74890 Bons-en-Chablais', 'F1', 9);

  rect(308, 124, 241, 54, [0.97, 0.97, 0.97], [0.88, 0.88, 0.88], 1);
  text(320, 162, 'CONTACT', 'F2', 11);
  text(320, 146, `Boutique : ${boutiqueEmail}`, 'F1', 9);
  text(320, 132, `Club : ${clubEmail} | ${clubSite}`, 'F1', 9);

  text(left, 96, 'Association loi 1901 - TVA non applicable, art. 293 B du CGI', 'F1', 9);
  text(left, 80, 'Facture generee automatiquement lors de la validation de la commande.', 'F1', 9);
  text(left, 64, 'Copie envoyee au client et au club via Brevo.', 'F1', 9);

  const pdf = buildRichPdfBase64(content);
  return pdf;
}

function buildRichPdfBase64(contentLines) {
  const pageWidth = 595;
  const pageHeight = 842;
  const objects = [];
  let objectId = 1;
  const catalogId = objectId++;
  const pagesId = objectId++;
  const fontRegularId = objectId++;
  const fontBoldId = objectId++;
  const imageId = objectId++;
  const pageId = objectId++;
  const contentId = objectId++;
  const logoBinary = atob(PDF_LOGO_JPEG_BASE64);

  objects[catalogId] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId] = `<< /Type /Pages /Count 1 /Kids [${pageId} 0 R] >>`;
  objects[fontRegularId] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;
  objects[fontBoldId] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`;
  objects[imageId] = `<< /Type /XObject /Subtype /Image /Width 165 /Height 180 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /DCTDecode /Length ${logoBinary.length} >>\nstream\n${logoBinary}\nendstream`;
  objects[pageId] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> /XObject << /Im1 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`;

  const stream = contentLines.join('\n');
  // IMPORTANT : /Length doit indiquer le nombre d'octets du stream,
  // pas le nombre de caractères JS (qui peut différer sur du non-ASCII).
  const streamBytes = new TextEncoder().encode(stream);
  objects[contentId] = `<< /Length ${streamBytes.length} >>\nstream\n${stream}\nendstream`;

  const entries = [];
  let pdf = '%PDF-1.4\n';
  for (let id = 1; id < objects.length; id++) {
    entries[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += '0000000000 65535 f \n';
  for (let id = 1; id < objects.length; id++) {
    pdf += `${String(entries[id]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  // Le stream contient des octets binaires (JPEG du logo).
  // btoa() rejette les caractères > 0xFF ; on masque chaque code point.
  let binary = '';
  for (let i = 0; i < pdf.length; i++) {
    binary += String.fromCharCode(pdf.charCodeAt(i) & 0xff);
  }
  return btoa(binary);
}

function envSafeValue(fallback) {
  return fallback;
}

// Détecte si le callback HelloAsso indique un paiement réussi.
// HelloAsso v5 peut renvoyer ?status=success, ?status=paid, ou ?status=1
// selon la version du checkout et la configuration.
function isHelloAssoSuccess(url) {
  const status = (url.searchParams.get('status') || '').toLowerCase();
  // Valeurs connues de succès HelloAsso
  if (['success', 'paid', '1', 'completed'].includes(status)) return true;
  // Parfois HelloAsso passe un code numérique
  const code = url.searchParams.get('code');
  if (code === '1' || code === '200') return true;
  return false;
}

function buildCheckoutReturnUrl(baseUrl, orderId, status) {
  // baseUrl peut être une URL absolue (HELLOASSO_RETURN_URL) ou relative.
  // On utilise une base neutre pour la résolution relative, puis on
  // reconstruit proprement avec les bons paramètres.
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    // baseUrl est relatif ou invalide — on le complète avec une base fictive
    // qui sera de toute façon écrasée par les valeurs réelles de l'env.
    url = new URL(baseUrl, 'https://boutique.americanfullfightingbons.fr/');
  }
  url.searchParams.set('order', String(orderId));
  url.searchParams.set('status', status);
  return url.toString();
}

const PDF_LOGO_JPEG_BASE64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/wAALCAC0AKUBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/AP1TooooooqlqF/badbSXN5cR21vGPnllk8tB+Jrxvxh+2d8DvAkkkWtfFPwykyD97Fa3wupB/2zi3mvNtR/4Kofs5WUrxR+NLq+b/p20a9x+ZirLT/grT+zyXx/bOuR/XRpa6LRf+Cnn7N+tSGMfEE2Mg/5/dKvI/8A2lXr3gr9oz4YfEiSOPwv8Q/Det3Egx9ktdUi84/9s8+Z+lel0+iiiiiiiiiivAvj/wDtrfCr9m63kXxX4hWTW/LEkeg6b/pF9Jx08vpH9ZDGK/OH4y/8Fffib44nl034b6RZ+DLGUeXHdSIL3UnI44z+7T/v2frXm9j+y5+1j+1fepqviDTfE1/ZufNW98YagbaGP/rnHKc44/5Zx1qzf8E59B8FSCL4l/tDfDnwbef8tbK1vfttxH/2yJiNdNp37NP7PUhYtql6247EzcPyfzqnPMbqdpXALvtPRQMKkaKqqsaKqoiIiKqIiIiIkaJHHHH5rRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRX//Z';
