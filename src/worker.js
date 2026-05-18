// ============================================================
//  AFFB Boutique — Cloudflare Worker
//  Base D1 : boutique-americanfullfightingbons
// ============================================================

import HTML from './index.html';

// ── Router léger ─────────────────────────────────────────────────
function route(method, pathname, handler) {
  return { method, pathname, handler };
}

const routes = [
  route('GET',  '/',                   serveHTML),
  route('GET',  '/api/products',       getProducts),
  route('GET',  '/api/products/:id',   getProduct),
  route('POST', '/api/orders',         createOrder),
  route('GET',  '/api/orders/:id',     getOrder),
  route('PATCH','/api/orders/:id',     updateOrderStatus),
  route('GET',  '/api/admin/orders',   getAdminOrders),
  route('GET',  '/api/admin/stats',    getStats),
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    // CORS pre-flight
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));

    // Trouver la route correspondante
    for (const r of routes) {
      const params = matchRoute(r.pathname, pathname);
      if (params !== null && r.method === request.method) {
        try {
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

// ── Helpers ──────────────────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
  });
}

function cors(response) {
  const r = new Response(response.body, response);
  r.headers.set('Access-Control-Allow-Origin', '*');
  r.headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return r;
}

function matchRoute(pattern, pathname) {
  const patternParts = pattern.split('/');
  const pathParts    = pathname.split('/');
  if (patternParts.length !== pathParts.length) return null;
  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

// ── Handlers ─────────────────────────────────────────────────────

// GET /
async function serveHTML() {
  return new Response(HTML, {
    headers: { 'Content-Type': 'text/html; charset=UTF-8' },
  });
}

// GET /api/products?category=gants
async function getProducts(request, env, _params, url) {
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
  return json(results);
}

// GET /api/products/:id
async function getProduct(_req, env, params) {
  const product = await env.DB.prepare('SELECT * FROM products WHERE id = ?')
    .bind(params.id).first();
  if (!product) return json({ error: 'Produit introuvable' }, 404);
  return json(product);
}

// POST /api/orders
// Body: { customer_name, customer_email, customer_phone?, notes?, items: [{product_id, quantity}] }
async function createOrder(request, env) {
  const body = await request.json();
  const { customer_name, customer_email, customer_phone, notes, items } = body;

  if (!customer_name || !customer_email || !items?.length) {
    return json({ error: 'Champs obligatoires manquants : customer_name, customer_email, items' }, 400);
  }

  // Valider les produits et calculer le total
  let total = 0;
  const enrichedItems = [];

  for (const item of items) {
    if (!item.product_id || !item.quantity || item.quantity < 1) {
      return json({ error: `Item invalide : ${JSON.stringify(item)}` }, 400);
    }
    const product = await env.DB.prepare('SELECT * FROM products WHERE id = ?')
      .bind(item.product_id).first();
    if (!product) return json({ error: `Produit #${item.product_id} introuvable` }, 404);
    if (product.stock < item.quantity) {
      return json({ error: `Stock insuffisant pour "${product.name}" (stock: ${product.stock})` }, 409);
    }
    total += product.price * item.quantity;
    enrichedItems.push({ ...item, product_name: product.name, unit_price: product.price });
  }

  // Insérer la commande
  const orderResult = await env.DB.prepare(
    'INSERT INTO orders (customer_name, customer_email, customer_phone, total, notes) VALUES (?, ?, ?, ?, ?)'
  ).bind(customer_name, customer_email, customer_phone ?? null, total, notes ?? null).run();

  const orderId = orderResult.meta.last_row_id;

  // Insérer les lignes + décrémenter le stock
  for (const item of enrichedItems) {
    await env.DB.prepare(
      'INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price) VALUES (?, ?, ?, ?, ?)'
    ).bind(orderId, item.product_id, item.product_name, item.quantity, item.unit_price).run();

    await env.DB.prepare('UPDATE products SET stock = stock - ? WHERE id = ?')
      .bind(item.quantity, item.product_id).run();
  }

  return json({ success: true, order_id: orderId, total }, 201);
}

// GET /api/orders/:id
async function getOrder(_req, env, params) {
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?')
    .bind(params.id).first();
  if (!order) return json({ error: 'Commande introuvable' }, 404);

  const { results: items } = await env.DB.prepare(
    'SELECT * FROM order_items WHERE order_id = ?'
  ).bind(params.id).all();

  return json({ ...order, items });
}

// PATCH /api/orders/:id  — body: { status: "confirmed" | "shipped" | "delivered" }
async function updateOrderStatus(request, env, params) {
  const { status } = await request.json();
  const allowed = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
  if (!allowed.includes(status)) {
    return json({ error: `Statut invalide. Valeurs acceptées : ${allowed.join(', ')}` }, 400);
  }
  await env.DB.prepare('UPDATE orders SET status = ? WHERE id = ?')
    .bind(status, params.id).run();
  return json({ success: true, order_id: Number(params.id), status });
}

// GET /api/admin/orders
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

// GET /api/admin/stats
async function getStats(_req, env) {
  const [products, orders, revenue, lowStock] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) as count FROM products').first(),
    env.DB.prepare('SELECT COUNT(*) as count FROM orders').first(),
    env.DB.prepare("SELECT COALESCE(SUM(total),0) as total FROM orders WHERE status != 'cancelled'").first(),
    env.DB.prepare('SELECT * FROM products WHERE stock <= 3 ORDER BY stock').all(),
  ]);

  return json({
    total_products : products.count,
    total_orders   : orders.count,
    total_revenue  : revenue.total,
    low_stock      : lowStock.results,
  });
}
