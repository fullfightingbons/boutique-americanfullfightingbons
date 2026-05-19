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

  // ── Images produits (servies depuis R2) ───────────────────────
  route('GET',   '/images/:key',               serveImage),
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));

    // Route spéciale : images R2 (clé avec sous-chemin ex: products/1-xxx.jpg)
    if (request.method === 'GET' && pathname.startsWith('/images/')) {
      try {
        const res = await serveImage(request, env, {}, url);
        return cors(res);
      } catch (err) {
        return cors(new Response('Erreur image', { status: 500 }));
      }
    }

    for (const r of routes) {
      const params = matchRoute(r.pathname, pathname);
      if (params !== null && r.method === request.method) {
        try {
          // Vérification token admin si route protégée
          if (r.adminOnly) {
            const authResult = await checkAdminAuth(request, env);
            if (!authResult.ok) return cors(json({ error: 'Non autorisé' }, 401));
          }
          const res = await r.handler(request, env, params, url);
          return cors(res);
        } catch (err) {
          console.error(err);
          return cors(json({ error: 'Erreur serveur', detail: err.message }, 500));
        }
      }
    }

    return cors(json({ error: 'Route introuvable' }, 404));
  },
};

// ── Helpers généraux ─────────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
  });
}

function cors(response) {
  const r = new Response(response.body, response);
  r.headers.set('Access-Control-Allow-Origin', '*');
  r.headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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
// Body: { name?, category?, price?, price_old?, emoji?, badge?, stock?, description?, sizes? }
async function updateProduct(request, env, params) {
  const body = await request.json();
  const fields = ['name', 'category', 'price', 'price_old', 'emoji', 'badge', 'stock', 'description', 'sizes', 'size_stocks'];
  const sets = [];
  const values = [];
  for (const f of fields) {
    if (f in body) {
      sets.push(`${f} = ?`);
      const val = f === 'sizes' ? (body[f] && body[f].length ? JSON.stringify(body[f]) : null) : body[f];
      values.push(val);
    }
  }
  if (!sets.length) return json({ error: 'Aucun champ à mettre à jour' }, 400);
  sets.push("updated_at = datetime('now')");
  values.push(params.id);
  await env.DB.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
  return json({ success: true });
}
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

  let total = 0;
  const enrichedItems = [];

  for (const item of items) {
    if (!item.product_id || !item.quantity || item.quantity < 1) {
      return json({ error: `Item invalide : ${JSON.stringify(item)}` }, 400);
    }
    const product = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(item.product_id).first();
    if (!product) return json({ error: `Produit #${item.product_id} introuvable` }, 404);
    if (product.stock < item.quantity) {
      return json({ error: `Stock insuffisant pour "${product.name}" (stock: ${product.stock})` }, 409);
    }
    total += product.price * item.quantity;
    enrichedItems.push({ ...item, product_name: product.name, unit_price: product.price });
  }

  const orderResult = await env.DB.prepare(
    'INSERT INTO orders (customer_name, customer_email, customer_phone, total, notes) VALUES (?, ?, ?, ?, ?)'
  ).bind(customer_name, customer_email, customer_phone ?? null, total, notes ?? null).run();

  const orderId = orderResult.meta.last_row_id;

  for (const item of enrichedItems) {
    await env.DB.prepare(
      'INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price) VALUES (?, ?, ?, ?, ?)'
    ).bind(orderId, item.product_id, item.product_name, item.quantity, item.unit_price).run();
    await env.DB.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').bind(item.quantity, item.product_id).run();
  }

  return json({ success: true, order_id: orderId, total }, 201);
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
  const [products, orders, revenue, lowStock] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) as count FROM products').first(),
    env.DB.prepare('SELECT COUNT(*) as count FROM orders').first(),
    env.DB.prepare("SELECT COALESCE(SUM(total),0) as total FROM orders WHERE status != 'cancelled'").first(),
    env.DB.prepare('SELECT * FROM products WHERE stock <= 3 ORDER BY stock').all(),
  ]);
  return json({
    total_products: products.count,
    total_orders:   orders.count,
    total_revenue:  revenue.total,
    low_stock:      lowStock.results,
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

  const { results: items } = await env.DB.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(params.orderId).all();

  // Obtenir le token HelloAsso
  const token = await getHelloAssoToken(env);

  // Construire le payload HelloAsso
  // Les montants sont en centimes
  const totalCents = Math.round(order.total * 100);

  const checkoutPayload = {
    totalAmount:  totalCents,
    initialAmount: totalCents,
    itemName: `Commande AFFB #${order.id}`,
    backUrl:   env.HELLOASSO_RETURN_URL || 'https://boutique-americanfullfightingbons.workers.dev/',
    errorUrl:  env.HELLOASSO_ERROR_URL  || 'https://boutique-americanfullfightingbons.workers.dev/',
    returnUrl: env.HELLOASSO_RETURN_URL || 'https://boutique-americanfullfightingbons.workers.dev/',
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
  const orderId = url.searchParams.get('orderId');
  const code    = url.searchParams.get('code'); // 'succeeded' | 'failed' | etc.

  if (!orderId) return json({ error: 'orderId manquant' }, 400);

  if (code === 'succeeded' || code === 'payment_success') {
    await env.DB.prepare("UPDATE orders SET status = 'confirmed' WHERE id = ?").bind(orderId).run();
    // Rediriger vers la boutique
    return Response.redirect(
      `${env.HELLOASSO_RETURN_URL || '/'}?order=${orderId}&status=success`,
      302
    );
  }

  return Response.redirect(
    `${env.HELLOASSO_ERROR_URL || '/'}?order=${orderId}&status=failed`,
    302
  );
}

// ── Brevo — Envoi email avec facture HTML inline ─────────────────
// Doc : https://developers.brevo.com/reference/sendtransacemail

// POST /api/admin/invoice/:orderId
async function sendInvoice(request, env, params) {
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(params.orderId).first();
  if (!order) return json({ error: 'Commande introuvable' }, 404);

  const { results: items } = await env.DB.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(params.orderId).all();

  // Générer le HTML de la facture
  const invoiceHtml = buildInvoiceHtml(order, items);

  // Encoder la facture HTML en base64 (pièce jointe PDF simulée en HTML)
  // Note : Pour un vrai PDF, il faudrait un service de rendu PDF (ex: Puppeteer via API externe)
  const attachmentB64 = btoa(unescape(encodeURIComponent(invoiceHtml)));

  const emailPayload = {
    sender: {
      name:  env.BREVO_FROM_NAME  || 'AFFB Boutique',
      email: env.BREVO_FROM_EMAIL || 'boutique@americanfullfightingbons.fr',
    },
    to: [{ name: order.customer_name, email: order.customer_email }],
    subject: `Votre commande AFFB #${order.id} — Facture`,
    htmlContent: buildEmailHtml(order, items),
    attachment: [
      {
        name:    `facture-affb-${order.id}.html`,
        content: attachmentB64,
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

  await env.DB.prepare('UPDATE orders SET invoice_sent = 1 WHERE id = ?').bind(params.orderId).run();
  return json({ success: true, message: `Facture envoyée à ${order.customer_email}` });
}

// ── Générateur HTML facture ───────────────────────────────────────
function buildInvoiceHtml(order, items) {
  const date = new Date(order.created_at).toLocaleDateString('fr-FR', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const rows = items.map(i => `
    <tr>
      <td style="padding:10px 16px;border-bottom:1px solid #eee">${i.product_name}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #eee;text-align:center">${i.quantity}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #eee;text-align:right">${i.unit_price.toFixed(2)} €</td>
      <td style="padding:10px 16px;border-bottom:1px solid #eee;text-align:right;font-weight:600">${(i.unit_price * i.quantity).toFixed(2)} €</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"/>
  <title>Facture AFFB #${order.id}</title>
</head>
<body style="font-family:Arial,sans-serif;max-width:800px;margin:40px auto;color:#111">
  <table style="width:100%;margin-bottom:40px">
    <tr>
      <td>
        <h1 style="margin:0;font-size:28px;color:#C8181A">AFFB BOUTIQUE</h1>
        <p style="margin:4px 0;color:#666;font-size:13px">American Full Fighting Bons-en-Chablais<br/>
        146 Rue du Châtelard, 74890 Bons-en-Chablais<br/>
        boutique@americanfullfightingbons.fr</p>
      </td>
      <td style="text-align:right">
        <h2 style="margin:0;font-size:22px">FACTURE</h2>
        <p style="margin:4px 0;color:#666;font-size:13px">N° ${String(order.id).padStart(6, '0')}<br/>
        Date : ${date}<br/>
        Statut : <strong>${statusLabel(order.status)}</strong></p>
      </td>
    </tr>
  </table>

  <div style="background:#f9f9f9;padding:20px;margin-bottom:30px;border-left:4px solid #C8181A">
    <h3 style="margin:0 0 8px;font-size:14px;text-transform:uppercase;color:#C8181A">Client</h3>
    <p style="margin:0;font-size:15px"><strong>${order.customer_name}</strong><br/>
    ${order.customer_email}${order.customer_phone ? `<br/>${order.customer_phone}` : ''}
    ${order.notes ? `<br/><em>Note : ${order.notes}</em>` : ''}</p>
  </div>

  <table style="width:100%;border-collapse:collapse;margin-bottom:30px">
    <thead>
      <tr style="background:#C8181A;color:#fff">
        <th style="padding:12px 16px;text-align:left">Produit</th>
        <th style="padding:12px 16px;text-align:center">Qté</th>
        <th style="padding:12px 16px;text-align:right">Prix unit.</th>
        <th style="padding:12px 16px;text-align:right">Total</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr style="background:#111;color:#fff">
        <td colspan="3" style="padding:14px 16px;text-align:right;font-weight:700;font-size:16px">TOTAL</td>
        <td style="padding:14px 16px;text-align:right;font-weight:700;font-size:18px">${order.total.toFixed(2)} €</td>
      </tr>
    </tfoot>
  </table>

  <p style="font-size:12px;color:#999;text-align:center;margin-top:40px;border-top:1px solid #eee;padding-top:20px">
    Association loi 1901 — TVA non applicable, art. 293 B du CGI<br/>
    Merci pour votre commande et votre soutien au club AFFB !
  </p>
</body>
</html>`;
}

function buildEmailHtml(order, items) {
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
      <h1 style="margin:0;font-size:32px;font-weight:900;letter-spacing:2px;color:#fff">AFFB BOUTIQUE</h1>
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
        Vous trouverez la facture détaillée en pièce jointe.<br/><br/>
        Pour toute question : <a href="mailto:boutique@americanfullfightingbons.fr" style="color:#C8181A">boutique@americanfullfightingbons.fr</a>
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
