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
import { buildHelloAssoPaymentState } from './helloasso-helpers.mjs';

const CLUB_CONTACT_EMAIL = 'fullfightingbons@gmail.com';
const MAIL_SENDER_EMAIL = 'contact@americanfullfightingbons.fr';

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

  // ── Synchronisation interne de stock ──────────────────────────
  route('POST',  '/api/internal/stock/apply',  applyExternalStockSync),

  // ── Annonces d'occasion ────────────────────────────────────────
  route('GET',   '/api/listings',              getListings),
  route('GET',   '/api/listings/:id',          getListing),
  route('POST',  '/api/listings',              createListing),       // soumission publique
  route('POST',  '/api/listings/:id/image',    uploadListingImage),  // upload image annonce
  route('GET',   '/api/admin/listings',        getAdminListings,     true),
  route('PATCH', '/api/admin/listings/:id',    updateListingStatus,  true),
  route('DELETE','/api/admin/listings/:id',    deleteListing,        true),
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), request, env);

    if ((request.method === 'GET' || request.method === 'HEAD') && pathname === '/api/health') {
      const res = json({ ok: true, data: { service: 'boutique-americanfullfightingbons', date: new Date().toISOString() } });
      return cors(request.method === 'HEAD' ? new Response(null, res) : res, request, env);
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && pathname === '/api/version') {
      const res = json({ ok: true, data: { service: 'boutique-americanfullfightingbons', version: '1.0.0' } });
      return cors(request.method === 'HEAD' ? new Response(null, res) : res, request, env);
    }

    if (request.method === 'GET' && pathname === '/robots.txt') {
      return cors(new Response('User-agent: *\nAllow: /\n\nSitemap: https://boutique.americanfullfightingbons.fr/sitemap.xml\n', {
        headers: securityHeaders({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }),
      }), request, env);
    }

    if (request.method === 'GET' && pathname === '/sitemap.xml') {
      return cors(new Response('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>https://boutique.americanfullfightingbons.fr/</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n</urlset>\n', {
        headers: securityHeaders({ 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }),
      }), request, env);
    }

    // Route spéciale : images R2 (clé avec sous-chemin ex: products/1-xxx.jpg)
    if (request.method === 'GET' && pathname.startsWith('/images/')) {
      try {
        const res = await serveImage(request, env, {}, url);
        return cors(res, request, env);
      } catch (err) {
        return cors(new Response('Erreur image', { status: 500 }), request, env);
      }
    }

    const routeMethod = request.method === 'HEAD' ? 'GET' : request.method;
    for (const r of routes) {
      const params = matchRoute(r.pathname, pathname);
      if (params !== null && r.method === routeMethod) {
        try {
          // Vérification token admin si route protégée
          if (r.adminOnly) {
            const authResult = await checkAdminAuth(request, env);
            if (!authResult.ok) return cors(json({ error: 'Non autorisé' }, 401), request, env);
          }
          const res = await r.handler(request, env, params, url);
          if (request.method === 'HEAD') return cors(new Response(null, res), request, env);
          return cors(res, request, env);
        } catch (err) {
          console.error(err);
          const payload = { error: 'Erreur serveur' };
          if (env.ENVIRONMENT !== 'production') payload.detail = err?.message || String(err);
          return cors(json(payload, 500), request, env);
        }
      }
    }

    return cors(json({ error: 'Route introuvable' }, 404), request, env);
  },
};

// ── Helpers généraux ─────────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: securityHeaders({
      'Content-Type': 'application/json; charset=UTF-8',
    }),
  });
}

function securityHeaders(base = {}) {
  return {
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self' https://api.helloasso.com https://api.brevo.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    ...base,
  };
}

function getAllowedOrigins(env, requestUrl) {
  const configured = String(env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return new Set([
    requestUrl.origin,
    'https://americanfullfightingbons.fr',
    'https://www.americanfullfightingbons.fr',
    'https://inscription.americanfullfightingbons.fr',
    'https://calendrier.americanfullfightingbons.fr',
    'https://boutique.americanfullfightingbons.fr',
    'https://gestion.americanfullfightingbons.fr',
    ...configured,
  ]);
}

function cors(response, request, env) {
  const r = new Response(response.body, response);
  const requestUrl = new URL(request.url);
  const origin = String(request.headers.get('Origin') || '').trim();
  const allowedOrigins = getAllowedOrigins(env, requestUrl);
  const allowOrigin = origin && allowedOrigins.has(origin) ? origin : requestUrl.origin;
  r.headers.set('Access-Control-Allow-Origin', allowOrigin);
  r.headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  r.headers.set('Vary', 'Origin');
  for (const [key, value] of Object.entries(securityHeaders())) {
    if (!r.headers.has(key)) r.headers.set(key, value);
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

function getClientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
}

function normalizeText(value, maxLen = 255) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function normalizeMultilineText(value, maxLen = 2000) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .trim()
    .slice(0, maxLen);
}

function normalizeEmail(value) {
  return normalizeText(value, 320).toLowerCase();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isValidImageUrl(value) {
  if (value == null) return true;
  if (typeof value !== 'string') return false;
  if (value.startsWith('/images/')) return true;
  if (value.startsWith('data:image/')) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
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

async function ensureSupportTables(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS order_access_tokens (
      order_id INTEGER PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
      token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS admin_login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL,
      attempted_at TEXT DEFAULT (datetime('now')),
      success INTEGER NOT NULL DEFAULT 0
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS inventory_sync_events (
      reference TEXT PRIMARY KEY,
      source TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`),
  ]);
}

async function checkInternalSyncAuth(request, env) {
  if (!env.BOUTIQUE_SYNC_TOKEN) return { ok: false, reason: 'sync token missing' };
  const token = request.headers.get('X-Inventory-Token') || '';
  return { ok: await secureCompare(token, env.BOUTIQUE_SYNC_TOKEN) };
}

async function sha256Hex(value) {
  const data = new TextEncoder().encode(String(value || ''));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function secureCompare(a, b) {
  const [ah, bh] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  if (ah.length !== bh.length) return false;
  let diff = 0;
  for (let i = 0; i < ah.length; i++) diff |= ah.charCodeAt(i) ^ bh.charCodeAt(i);
  return diff === 0;
}

// ── Hachage PBKDF2 (même pattern que gestion) ────────────────────

async function derivePasswordHash(password, saltBytes, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

function bytesToHex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return arr;
}

const PBKDF2_PREFIX    = 'pbkdf2_sha256';
const PBKDF2_ITERS     = 100_000;

/**
 * Hache un mot de passe en PBKDF2-SHA256 (100 000 itérations, sel aléatoire).
 * Format stocké : "pbkdf2_sha256$<iters>$<salt_hex>$<hash_hex>"
 */
async function hashAdminPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePasswordHash(password, salt, PBKDF2_ITERS);
  return `${PBKDF2_PREFIX}$${PBKDF2_ITERS}$${bytesToHex(salt)}$${bytesToHex(hash)}`;
}

/**
 * Vérifie un mot de passe contre un hash PBKDF2 stocké en D1.
 * Accepte uniquement le format pbkdf2_sha256$… — aucun fallback en clair.
 */
async function verifyAdminPassword(password, env) {
  // Charger le hash depuis D1 (table admin_config, clé 'admin_password_hash')
  const row = await env.DB.prepare(
    "SELECT value FROM admin_config WHERE key = 'admin_password_hash' LIMIT 1"
  ).first();

  if (!row?.value) {
    // Aucun hash en base → fallback d'initialisation sécurisé : accepter uniquement
    // si ADMIN_PASSWORD_HASH_INIT est défini (variable d'environnement temporaire).
    // En production, cette branche ne doit jamais être atteinte.
    if (!env.ADMIN_PASSWORD_HASH_INIT) {
      console.error('[auth] Aucun hash admin en base et ADMIN_PASSWORD_HASH_INIT absent — connexion refusée.');
      return false;
    }
    // ADMIN_PASSWORD_HASH_INIT doit être un hash PBKDF2 valide (généré une seule fois)
    const stored = String(env.ADMIN_PASSWORD_HASH_INIT);
    return verifyPbkdf2(password, stored);
  }

  return verifyPbkdf2(password, String(row.value));
}

async function verifyPbkdf2(password, stored) {
  if (!stored.startsWith(`${PBKDF2_PREFIX}$`)) {
    console.error('[auth] Format de hash non reconnu — connexion refusée.');
    return false;
  }
  const parts = stored.split('$');
  if (parts.length !== 4) return false;
  const iters   = Number(parts[1]);
  const saltHex = parts[2];
  const hashHex = parts[3];
  if (!iters || iters > PBKDF2_ITERS * 2 || !saltHex || !hashHex) return false;
  const derived = await derivePasswordHash(password, hexToBytes(saltHex), iters);
  // Comparaison en temps constant via sha256Hex (double hash évite le timing leak sur longueur)
  const [dh, sh] = await Promise.all([sha256Hex(bytesToHex(derived)), sha256Hex(hashHex)]);
  return secureCompare(dh, sh);
}

async function isAdminRateLimited(env, ip) {
  await ensureSupportTables(env);
  const row = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM admin_login_attempts WHERE ip = ? AND success = 0 AND attempted_at > datetime('now', '-15 minutes')"
  ).bind(ip).first();
  return Number(row?.count || 0) >= 5;
}

async function recordAdminLoginAttempt(env, ip, success) {
  await ensureSupportTables(env);
  await env.DB.prepare(
    'INSERT INTO admin_login_attempts (ip, success) VALUES (?, ?)'
  ).bind(ip, success ? 1 : 0).run();
  if (success) {
    await env.DB.prepare(
      "DELETE FROM admin_login_attempts WHERE ip = ? OR attempted_at < datetime('now', '-2 days')"
    ).bind(ip).run();
  }
}

// POST /api/admin/login  — body: { password }
async function adminLogin(request, env) {
  const { password } = await request.json();
  const ip = getClientIp(request);
  if (await isAdminRateLimited(env, ip)) {
    return json({ error: 'Trop de tentatives. Réessayez plus tard.' }, 429);
  }
  if (!password || !(await verifyAdminPassword(password, env))) {
    await recordAdminLoginAttempt(env, ip, false);
    return json({ error: 'Mot de passe incorrect' }, 401);
  }
  await recordAdminLoginAttempt(env, ip, true);
  const token = randomToken();
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
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
  return new Response(HTML, { headers: securityHeaders({ 'Content-Type': 'text/html; charset=UTF-8' }) });
}

async function serveAdminHTML() {
  return new Response(ADMIN_HTML, { headers: securityHeaders({ 'Content-Type': 'text/html; charset=UTF-8' }) });
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
  const name = normalizeText(body.name, 160);
  const category = normalizeText(body.category, 40);
  const description = normalizeMultilineText(body.description, 1000) || null;
  const price = Number(body.price);
  const priceOld = body.price_old == null ? null : Number(body.price_old);
  const stock = body.stock == null ? 0 : Number(body.stock);
  const emoji = normalizeText(body.emoji || '📦', 8) || '📦';
  const badge = body.badge ? normalizeText(body.badge, 40) : null;
  const sizes = Array.isArray(body.sizes) ? body.sizes.map(size => normalizeText(size, 12)).filter(Boolean) : [];
  const size_stocks = body.size_stocks && typeof body.size_stocks === 'object'
    ? Object.fromEntries(Object.entries(body.size_stocks).map(([size, qty]) => [normalizeText(size, 12), Math.max(0, Number(qty) || 0)]).filter(([size]) => size))
    : null;
  if (!name || !category || Number.isNaN(price) || price < 0) {
    return json({ error: 'Champs obligatoires : name, category, price' }, 400);
  }
  if (priceOld != null && (Number.isNaN(priceOld) || priceOld < 0)) {
    return json({ error: 'Ancien prix invalide' }, 400);
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
  ).bind(name, category, price, priceOld, emoji, badge, computedStock, description, sizesJson, sizeStocksJson).run();

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
        const normalized = body[f] && typeof body[f] === 'object'
          ? Object.fromEntries(Object.entries(body[f]).map(([size, qty]) => [normalizeText(size, 12), Math.max(0, Number(qty) || 0)]).filter(([size]) => size))
          : null;
        const ss = normalized && Object.keys(normalized).length ? JSON.stringify(normalized) : null;
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
        values.push(Array.isArray(body[f]) && body[f].length ? JSON.stringify(body[f].map(size => normalizeText(size, 12)).filter(Boolean)) : null);
      } else {
        sets.push(`${f} = ?`);
        if (f === 'name') values.push(normalizeText(body[f], 160));
        else if (f === 'category') values.push(normalizeText(body[f], 40));
        else if (f === 'description') values.push(normalizeMultilineText(body[f], 1000) || null);
        else if (f === 'badge') values.push(body[f] ? normalizeText(body[f], 40) : null);
        else if (f === 'emoji') values.push(normalizeText(body[f], 8) || '📦');
        else if (f === 'price' || f === 'price_old') values.push(body[f] == null ? null : Number(body[f]));
        else if (f === 'stock') values.push(Math.max(0, Number(body[f]) || 0));
        else values.push(body[f]);
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
  if (!isValidImageUrl(image_url)) {
    return json({ error: 'URL image invalide' }, 400);
  }
  await env.DB.prepare("UPDATE products SET image_url = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(image_url, params.id).run();
  return json({ success: true, image_url });
}

// ── Commandes ────────────────────────────────────────────────────

function orderTokenExpiresAt() {
  return new Date(Date.now() + 30 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

async function storeOrderAccessToken(env, orderId, token) {
  await ensureSupportTables(env);
  await env.DB.prepare(
    'INSERT OR REPLACE INTO order_access_tokens (order_id, token, expires_at) VALUES (?, ?, ?)'
  ).bind(orderId, token, orderTokenExpiresAt()).run();
}

async function verifyOrderAccess(request, env, orderId) {
  const admin = await checkAdminAuth(request, env);
  if (admin.ok) return { ok: true, isAdmin: true };
  await ensureSupportTables(env);
  let token = request.headers.get('X-Order-Token') || null;
  if (!token && request.method !== 'GET') {
    try {
      const body = await request.clone().json();
      token = body.order_token || null;
    } catch {
      token = null;
    }
  }
  if (!token) return { ok: false };
  const row = await env.DB.prepare(
    "SELECT token FROM order_access_tokens WHERE order_id = ? AND expires_at > datetime('now')"
  ).bind(orderId).first();
  if (!row?.token) return { ok: false };
  return { ok: await secureCompare(token, row.token), isAdmin: false };
}

async function reserveStockForItem(env, item) {
  const product = await env.DB.prepare('SELECT id, stock, size_stocks FROM products WHERE id = ?').bind(item.product_id).first();
  if (!product) throw new Error(`Produit #${item.product_id} introuvable`);
  const quantity = Math.max(1, Number(item.quantity) || 0);
  if (item.size) {
    const currentSizeStocks = product.size_stocks ? JSON.parse(product.size_stocks) : {};
    const availableForSize = Number(currentSizeStocks[item.size] ?? 0);
    if (availableForSize < quantity || Number(product.stock || 0) < quantity) {
      throw new Error(`Stock insuffisant pour "${item.product_name}"`);
    }
    const nextSizeStocks = { ...currentSizeStocks, [item.size]: availableForSize - quantity };
    const result = await env.DB.prepare(
      "UPDATE products SET stock = stock - ?, size_stocks = ?, updated_at = datetime('now') WHERE id = ? AND stock >= ? AND size_stocks = ?"
    ).bind(quantity, JSON.stringify(nextSizeStocks), item.product_id, quantity, product.size_stocks ?? null).run();
    if (!result.meta?.changes) throw new Error(`Réservation concurrente détectée pour "${item.product_name}"`);
    return;
  }
  const result = await env.DB.prepare(
    "UPDATE products SET stock = stock - ?, updated_at = datetime('now') WHERE id = ? AND stock >= ?"
  ).bind(quantity, item.product_id, quantity).run();
  if (!result.meta?.changes) throw new Error(`Stock insuffisant pour "${item.product_name}"`);
}

async function releaseReservedStockForItems(env, items) {
  for (const item of items) {
    const quantity = Math.max(1, Number(item.quantity) || 0);
    const sizeMatch = /\(([^()]+)\)\s*$/.exec(item.product_name || '');
    const size = item.size || (sizeMatch ? sizeMatch[1] : null);
    if (size) {
      const current = await env.DB.prepare('SELECT size_stocks FROM products WHERE id = ?').bind(item.product_id).first();
      const sizeStocks = current?.size_stocks ? JSON.parse(current.size_stocks) : {};
      sizeStocks[size] = (Number(sizeStocks[size]) || 0) + quantity;
      await env.DB.prepare(
        "UPDATE products SET stock = stock + ?, size_stocks = ?, updated_at = datetime('now') WHERE id = ?"
      ).bind(quantity, JSON.stringify(sizeStocks), item.product_id).run();
    } else {
      await env.DB.prepare(
        "UPDATE products SET stock = stock + ?, updated_at = datetime('now') WHERE id = ?"
      ).bind(quantity, item.product_id).run();
    }
  }
}

async function getOrderItems(env, orderId) {
  const { results } = await env.DB.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(orderId).all();
  return results || [];
}

async function releaseReservedStockForOrder(env, orderId) {
  const order = await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(orderId).first();
  if (!order || order.status !== 'pending_payment') return { released: false };
  const items = await getOrderItems(env, orderId);
  await releaseReservedStockForItems(env, items);
  await env.DB.prepare(
    "UPDATE orders SET status = 'payment_failed' WHERE id = ? AND status = 'pending_payment'"
  ).bind(orderId).run();
  await ensureSupportTables(env);
  await env.DB.prepare('DELETE FROM order_access_tokens WHERE order_id = ?').bind(orderId).run();
  return { released: true };
}

async function applyExternalStockSync(request, env) {
  const auth = await checkInternalSyncAuth(request, env);
  if (!auth.ok) return json({ error: 'Non autorisé' }, 401);
  await ensureSupportTables(env);

  const body = await request.json();
  const reference = normalizeText(body.reference, 120);
  const source = normalizeText(body.source || 'inscription', 40) || 'inscription';
  const items = Array.isArray(body.items) ? body.items : [];

  if (!reference || !items.length) {
    return json({ error: 'reference et items sont obligatoires' }, 400);
  }

  const existing = await env.DB.prepare(
    'SELECT reference FROM inventory_sync_events WHERE reference = ? LIMIT 1'
  ).bind(reference).first();
  if (existing?.reference) {
    return json({ success: true, already_applied: true, reference });
  }

  const appliedItems = [];
  try {
    for (const rawItem of items) {
      const productId = Number(rawItem.product_id);
      const quantity = Math.max(1, Number(rawItem.quantity) || 0);
      const size = rawItem.size ? normalizeText(rawItem.size, 12) : null;
      if (!productId || !quantity) {
        throw new Error('Item de synchronisation invalide');
      }
      const product = await env.DB.prepare('SELECT name FROM products WHERE id = ?').bind(productId).first();
      if (!product) throw new Error(`Produit introuvable pour sync: ${productId}`);
      const item = {
        product_id: productId,
        quantity,
        size,
        product_name: size ? `${product.name} (${size})` : product.name,
      };
      await reserveStockForItem(env, item);
      appliedItems.push(item);
    }

    await env.DB.prepare(
      'INSERT INTO inventory_sync_events (reference, source) VALUES (?, ?)'
    ).bind(reference, source).run();

    return json({ success: true, reference, applied: appliedItems.length });
  } catch (err) {
    if (appliedItems.length) {
      await releaseReservedStockForItems(env, appliedItems);
    }
    return json({ error: err.message || 'Synchronisation impossible' }, 409);
  }
}

async function createOrder(request, env) {
  const body = await request.json();
  const customer_name = normalizeText(body.customer_name, 160);
  const customer_email = normalizeEmail(body.customer_email);
  const customer_phone = normalizeText(body.customer_phone, 40) || null;
  const notes = normalizeMultilineText(body.notes, 1200) || null;
  const items = Array.isArray(body.items) ? body.items : null;

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
      product_id: Number(item.product_id),
      quantity: Number(item.quantity),
      size: requestedSize,
      product_name: requestedSize ? `${product.name} (${requestedSize})` : product.name,
      unit_price: product.price,
    });
  }

  const reservedItems = [];
  try {
    for (const item of enrichedItems) {
      await reserveStockForItem(env, item);
      reservedItems.push(item);
    }

    const orderResult = await env.DB.prepare(
      "INSERT INTO orders (customer_name, customer_email, customer_phone, total, notes, status) VALUES (?, ?, ?, ?, ?, 'pending_payment')"
    ).bind(customer_name, customer_email, customer_phone, total, notes).run();

    const orderId = orderResult.meta.last_row_id;

    for (const item of enrichedItems) {
      await env.DB.prepare(
        'INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price) VALUES (?, ?, ?, ?, ?)'
      ).bind(orderId, item.product_id, item.product_name, item.quantity, item.unit_price).run();
    }

    const orderToken = randomToken(24);
    await storeOrderAccessToken(env, orderId, orderToken);

    return json({ success: true, order_id: orderId, total, status: 'pending_payment', order_token: orderToken }, 201);
  } catch (err) {
    if (reservedItems.length) {
      await releaseReservedStockForItems(env, reservedItems);
    }
    return json({ error: err.message || 'Impossible de créer la commande' }, 409);
  }
}

async function getOrder(request, env, params) {
  const access = await verifyOrderAccess(request, env, params.id);
  if (!access.ok) return json({ error: 'Accès commande refusé' }, 403);
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(params.id).first();
  if (!order) return json({ error: 'Commande introuvable' }, 404);
  const { results: items } = await env.DB.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(params.id).all();
  return json({ ...order, items });
}

async function updateOrderStatus(request, env, params) {
  const current = await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(params.id).first();
  if (!current) return json({ error: 'Commande introuvable' }, 404);
  const { status } = await request.json();
  const allowed = ['pending_payment', 'payment_failed', 'confirmed', 'shipped', 'delivered', 'cancelled'];
  if (!allowed.includes(status)) {
    return json({ error: `Statut invalide. Valeurs acceptées : ${allowed.join(', ')}` }, 400);
  }
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  if (current.status === 'pending_payment' && (status === 'cancelled' || status === 'payment_failed')) {
    await releaseReservedStockForOrder(env, params.id);
    if (status === 'cancelled') {
      await env.DB.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").bind(params.id).run();
      await env.DB.prepare(
        'INSERT INTO order_status_history (order_id, old_status, new_status, changed_at, changed_by) VALUES (?, ?, ?, ?, ?)'
      ).bind(params.id, current.status, 'cancelled', now, 'admin').run();
    }
    return json({ success: true, order_id: Number(params.id), status });
  }
  await env.DB.prepare('UPDATE orders SET status = ? WHERE id = ?').bind(status, params.id).run();
  await env.DB.prepare(
    'INSERT INTO order_status_history (order_id, old_status, new_status, changed_at, changed_by) VALUES (?, ?, ?, ?, ?)'
  ).bind(params.id, current.status, status, now, 'admin').run();
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
    env.DB.prepare("SELECT COALESCE(SUM(total),0) as total FROM orders WHERE status IN ('confirmed', 'shipped', 'delivered')").first(),
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

async function getHelloAssoCheckoutIntent(env, checkoutIntentId) {
  if (!checkoutIntentId) throw new Error('Checkout intent HelloAsso manquant');
  const token = await getHelloAssoToken(env);
  const response = await fetch(
    `https://api.helloasso.com/v5/organizations/${env.HELLOASSO_ORG_SLUG}/checkout-intents/${encodeURIComponent(String(checkoutIntentId))}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    }
  );
  const text = await response.text().catch(() => '');
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(
      payload?.message ||
      payload?.error ||
      `HelloAsso checkout intent error ${response.status}`
    );
  }
  return payload;
}

// POST /api/checkout/:orderId
// Crée un checkout HelloAsso et retourne l'URL de paiement
async function createCheckout(request, env, params) {
  const access = await verifyOrderAccess(request, env, params.orderId);
  if (!access.ok) return json({ error: 'Accès checkout refusé' }, 403);
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(params.orderId).first();
  if (!order) return json({ error: 'Commande introuvable' }, 404);
  if (order.status === 'confirmed') {
    return json({ error: 'Commande déjà payée' }, 409);
  }
  if (!['pending_payment', 'pending'].includes(order.status)) {
    return json({ error: 'Commande non payable dans son état actuel' }, 409);
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
    errorUrl:  buildCheckoutReturnUrl(env.HELLOASSO_ERROR_URL || env.HELLOASSO_RETURN_URL || 'https://boutique.americanfullfightingbons.fr/', order.id, 'failed'),
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

  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(callbackInfo.orderId).first();
  if (!order) {
    return json({ error: 'Commande introuvable' }, 404);
  }

  const checkoutIntentId =
    order.helloasso_id ||
    url.searchParams.get('checkoutIntentId') ||
    url.searchParams.get('checkoutIntent') ||
    url.searchParams.get('id') ||
    url.searchParams.get('helloasso_id');

  if (!checkoutIntentId) {
    await releaseReservedStockForOrder(env, callbackInfo.orderId);
    return Response.redirect(
      buildCheckoutReturnUrl(env.HELLOASSO_ERROR_URL || '/', callbackInfo.orderId, 'failed'),
      302
    );
  }

  try {
    const intent = await getHelloAssoCheckoutIntent(env, checkoutIntentId);
    const paymentState = buildHelloAssoPaymentState(intent, order.total);
    if (paymentState.paid) {
      await finalizePaidOrder(env, callbackInfo.orderId, intent);
      return Response.redirect(
        buildCheckoutReturnUrl(env.HELLOASSO_RETURN_URL || '/', callbackInfo.orderId, 'success'),
        302
      );
    }
  } catch (err) {
    console.error('Checkout verification failed', err);
    return Response.redirect(
      buildCheckoutReturnUrl(env.HELLOASSO_ERROR_URL || env.HELLOASSO_RETURN_URL || '/', callbackInfo.orderId, 'verification_error'),
      302
    );
  }

  await releaseReservedStockForOrder(env, callbackInfo.orderId);
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
    env.BREVO_CLUB_EMAIL || CLUB_CONTACT_EMAIL,
  ].filter(Boolean);

  const invoicePdfBase64 = buildInvoicePdfBase64(order, items);
  const emailPayload = {
    sender: {
      name:  env.BREVO_FROM_NAME  || 'AFFB Boutique',
      email: env.BREVO_FROM_EMAIL || MAIL_SENDER_EMAIL,
    },
    to: recipients.map(email => ({
      email,
      name: email === order.customer_email ? order.customer_name : 'Club AFFB',
    })),
    subject: `Commande AFFB #${order.id} — Facture PDF`,
    htmlContent: buildEmailHtml(order, items),
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

  const invoiceSentAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await env.DB.prepare(
    'UPDATE orders SET invoice_sent = 1, invoice_sent_at = ? WHERE id = ?'
  ).bind(invoiceSentAt, orderId).run();
  return { attempted: true, sent: true, recipients };
}

async function finalizePaidOrder(env, orderId, helloAssoIntent) {
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
  if (!order) throw new Error('Commande introuvable');
  if (order.status === 'confirmed' && order.invoice_sent) {
    return { confirmed: true, invoice_sent: true, skipped: true };
  }

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  // Mettre à jour le statut + paid_at
  await env.DB.prepare(
    "UPDATE orders SET status = 'confirmed', paid_at = ? WHERE id = ?"
  ).bind(now, orderId).run();

  // Historique de transition
  await env.DB.prepare(
    'INSERT INTO order_status_history (order_id, old_status, new_status, changed_at, changed_by) VALUES (?, ?, ?, ?, ?)'
  ).bind(orderId, order.status, 'confirmed', now, 'helloasso').run();

  // Sauvegarder les données de paiement HelloAsso si disponibles
  if (helloAssoIntent) {
    const order2 = await env.DB.prepare('SELECT order_id FROM payments WHERE order_id = ?').bind(orderId).first();
    if (!order2) {
      const payment = extractHelloAssoPayment(helloAssoIntent);
      await env.DB.prepare(
        'INSERT INTO payments (order_id, helloasso_payment_id, amount, payer_name, payer_email, paid_at, raw_payload) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        orderId,
        payment.id || null,
        payment.amount || null,
        payment.payerName || null,
        payment.payerEmail || null,
        now,
        JSON.stringify(helloAssoIntent)
      ).run();
    }
  }

  await ensureSupportTables(env);
  await env.DB.prepare('DELETE FROM order_access_tokens WHERE order_id = ?').bind(orderId).run();
  const invoice = await sendInvoiceForOrder(env, orderId);
  return { confirmed: true, invoice_sent: invoice.sent };
}

// Extrait les infos de paiement du payload HelloAsso (checkout intent)
function extractHelloAssoPayment(intent) {
  const order = intent?.order;
  const payer = order?.payer || intent?.payer || {};
  const payments = order?.payments || intent?.payments || [];
  const firstPayment = Array.isArray(payments) ? payments[0] : null;
  return {
    id:         firstPayment?.id || intent?.id || null,
    amount:     firstPayment?.amount != null ? firstPayment.amount / 100 : (order?.amount != null ? order.amount / 100 : null),
    payerName:  [payer.firstName, payer.lastName].filter(Boolean).join(' ') || null,
    payerEmail: payer.email || order?.payer?.email || null,
  };
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

function decodeHelloAssoState(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed.orderId || parsed.order || null;
  } catch {}
  try {
    const url = new URLSearchParams(String(value));
    return url.get('orderId') || url.get('order') || null;
  } catch {}
  return null;
}

// ── Générateur HTML facture ───────────────────────────────────────
function buildInvoiceHtml(order, items) {
  const date = new Date(order.created_at).toLocaleDateString('fr-FR', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const rows = items.map(i => `
    <tr>
      <td style="padding:10px 16px;border-bottom:1px solid #eee">${escapeHtml(i.product_name)}</td>
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
        <p style="margin:4px 0;color:#666;font-size:13px">AMERICAN FULL FIGHTING BONS EN CHABLAIS<br/>
        146 Rue du Châtelard, 74890 Bons-en-Chablais<br/>
        ${CLUB_CONTACT_EMAIL}</p>
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
    <p style="margin:0;font-size:15px"><strong>${escapeHtml(order.customer_name)}</strong><br/>
    ${escapeHtml(order.customer_email)}${order.customer_phone ? `<br/>${escapeHtml(order.customer_phone)}` : ''}
    ${order.notes ? `<br/><em>Note : ${escapeHtml(order.notes)}</em>` : ''}</p>
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
    Merci pour votre commande et votre soutien au club AMERICAN FULL FIGHTING BONS EN CHABLAIS !
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
      <td style="padding:10px 16px;border-bottom:1px solid #333">${escapeHtml(i.product_name)}</td>
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
      <p style="margin:8px 0 0;color:rgba(255,255,255,0.8);font-size:14px">AMERICAN FULL FIGHTING BONS EN CHABLAIS</p>
    </div>
    <div style="background:#111114;padding:40px">
      <h2 style="margin:0 0 8px;color:#fff;font-size:22px">Merci pour votre commande, ${escapeHtml(order.customer_name.split(' ')[0])} !</h2>
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
        Pour toute question : <a href="mailto:${CLUB_CONTACT_EMAIL}" style="color:#C8181A">${CLUB_CONTACT_EMAIL}</a>
      </p>
    </div>
    <div style="background:#0A0A0B;padding:20px 40px;text-align:center;border-top:1px solid #1A1A1F">
      <p style="color:#555;font-size:12px;margin:0">© ${new Date().getFullYear()} AMERICAN FULL FIGHTING BONS EN CHABLAIS<br/>
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
    pending: 'En attente',
    pending_payment: 'Paiement en attente',
    payment_failed: 'Paiement échoué',
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

    objects[contentObjectIds[index]] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
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

function buildInvoicePdfBase64(order, items) {
  const date = new Date(order.created_at).toLocaleDateString('fr-FR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  });

  const customerName = normalizePdfText(order.customer_name);
  const customerEmail = normalizePdfText(order.customer_email);
  const customerPhone = normalizePdfText(order.customer_phone || '');
  const orderNote = normalizePdfText(order.notes || '');
  const status = normalizePdfText(statusLabel(order.status));
  const totalText = `${Number(order.total).toFixed(2)} EUR`;
  const clubEmail = normalizePdfText(envSafeValue(CLUB_CONTACT_EMAIL));
  const boutiqueEmail = normalizePdfText(envSafeValue(CLUB_CONTACT_EMAIL));
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
  image('Im1', left + 12, 756, 44, 48);
  text(left + 64, 792, 'BOUTIQUE DU CLUB', 'F2', 24);
  text(left + 64, 776, 'AMERICAN FULL FIGHTING BONS EN CHABLAIS', 'F1', 10);
  text(left + 64, 762, 'Boutique officielle du club', 'F1', 10);

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
  text(left + 12, 146, 'AMERICAN FULL FIGHTING BONS EN CHABLAIS', 'F1', 9);
  text(left + 12, 132, '146 Rue du Chatelard, 74890 Bons-en-Chablais', 'F1', 9);

  rect(308, 124, 241, 54, [0.97, 0.97, 0.97], [0.88, 0.88, 0.88], 1);
  text(320, 162, 'CONTACT', 'F2', 11);
  text(320, 146, `Email : ${boutiqueEmail}`, 'F1', 9);
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
  objects[imageId] = `<< /Type /XObject /Subtype /Image /Width 165 /Height 180 /ColorSpace /DeviceCMYK /BitsPerComponent 8 /Filter /DCTDecode /Length ${logoBinary.length} >>\nstream\n${logoBinary}\nendstream`;
  objects[pageId] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> /XObject << /Im1 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`;

  const stream = contentLines.join('\n');
  objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;

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

function envSafeValue(fallback) {
  return fallback;
}

// ── Annonces d'occasion ─────────────────────────────────────────

const LISTING_CONDITIONS = ['neuf', 'tres_bon', 'bon', 'correct'];
const LISTING_CATEGORIES = ['gants', 'protections', 'tenues', 'accessoires', 'divers'];
const LISTING_STATUSES   = ['pending', 'active', 'sold', 'rejected'];

// GET /api/listings — annonces actives uniquement
async function getListings(request, env, _p, url) {
  const category = url.searchParams.get('category');
  let query, args;
  if (category && category !== 'tous') {
    query = "SELECT id, title, description, price, category, condition, contact_name, image_url, created_at FROM listings WHERE status = 'active' AND category = ? ORDER BY created_at DESC";
    args  = [category];
  } else {
    query = "SELECT id, title, description, price, category, condition, contact_name, image_url, created_at FROM listings WHERE status = 'active' ORDER BY created_at DESC";
    args  = [];
  }
  const { results } = await env.DB.prepare(query).bind(...args).all();
  return json(results);
}

// GET /api/listings/:id — détail annonce (publique, sans email ni téléphone si pending/rejected)
async function getListing(_req, env, params) {
  const listing = await env.DB.prepare('SELECT * FROM listings WHERE id = ?').bind(params.id).first();
  if (!listing) return json({ error: 'Annonce introuvable' }, 404);
  if (listing.status !== 'active') return json({ error: 'Annonce non disponible' }, 404);
  // Ne pas exposer contact_email et contact_phone dans la réponse publique détaillée
  const { contact_email: _e, contact_phone: _p, ...safe } = listing;
  return json(safe);
}

// POST /api/listings — soumission publique d'une annonce (en attente de validation)
async function createListing(request, env) {
  const body = await request.json();
  const title        = normalizeText(body.title, 160);
  const description  = normalizeMultilineText(body.description, 1000) || null;
  const price        = Number(body.price);
  const category     = normalizeText(body.category, 40);
  const condition    = normalizeText(body.condition, 20);
  const contact_name = normalizeText(body.contact_name, 100);
  const contact_email= normalizeEmail(body.contact_email);
  const contact_phone= body.contact_phone ? normalizeText(body.contact_phone, 20) : null;

  if (!title)          return json({ error: 'Titre obligatoire'         }, 400);
  if (Number.isNaN(price) || price <= 0) return json({ error: 'Prix invalide (> 0)'      }, 400);
  if (!LISTING_CATEGORIES.includes(category)) return json({ error: 'Catégorie invalide'      }, 400);
  if (!LISTING_CONDITIONS.includes(condition)) return json({ error: 'État invalide'           }, 400);
  if (!contact_name)   return json({ error: 'Nom du vendeur obligatoire'}, 400);
  if (!contact_email)  return json({ error: 'Email invalide'            }, 400);

  const result = await env.DB.prepare(
    `INSERT INTO listings (title, description, price, category, condition, contact_name, contact_email, contact_phone, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
  ).bind(title, description, price, category, condition, contact_name, contact_email, contact_phone).run();

  return json({ success: true, id: result.meta.last_row_id, status: 'pending' }, 201);
}

// POST /api/listings/:id/image — upload image d'annonce (public, avant validation admin)
async function uploadListingImage(request, env, params) {
  const listing = await env.DB.prepare('SELECT id, status FROM listings WHERE id = ?').bind(params.id).first();
  if (!listing) return json({ error: 'Annonce introuvable' }, 404);

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return json({ error: 'Envoi multipart/form-data requis' }, 400);
  }

  const formData = await request.formData();
  const file = formData.get('image');
  if (!file) return json({ error: 'Champ "image" manquant' }, 400);

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    return json({ error: 'Format non supporté (jpg, png, webp)' }, 400);
  }

  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > 5 * 1024 * 1024) {
    return json({ error: 'Image trop lourde (max 5 Mo)' }, 400);
  }

  const ext    = file.type.split('/')[1].replace('jpeg', 'jpg');
  const key    = `listings/${params.id}-${Date.now()}.${ext}`;

  if (env.R2_BUCKET) {
    await env.R2_BUCKET.put(key, buffer, { httpMetadata: { contentType: file.type } });
    const imageUrl = `/images/${key}`;
    await env.DB.prepare("UPDATE listings SET image_url = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(imageUrl, params.id).run();
    return json({ success: true, image_url: imageUrl });
  }

  // Fallback base64
  const uint8 = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < uint8.length; i += chunkSize) {
    binary += String.fromCharCode(...uint8.subarray(i, i + chunkSize));
  }
  const dataUrl = `data:${file.type};base64,${btoa(binary)}`;
  await env.DB.prepare("UPDATE listings SET image_url = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(dataUrl, params.id).run();
  return json({ success: true, image_url: dataUrl });
}

// GET /api/admin/listings — toutes les annonces (admin)
async function getAdminListings(request, env, _p, url) {
  const status = url.searchParams.get('status');
  let query, args;
  if (status && LISTING_STATUSES.includes(status)) {
    query = 'SELECT * FROM listings WHERE status = ? ORDER BY created_at DESC';
    args  = [status];
  } else {
    query = 'SELECT * FROM listings ORDER BY created_at DESC';
    args  = [];
  }
  const { results } = await env.DB.prepare(query).bind(...args).all();
  return json(results);
}

// PATCH /api/admin/listings/:id — changer statut ou modifier une annonce (admin)
async function updateListingStatus(request, env, params) {
  const body = await request.json();
  const sets   = [];
  const values = [];

  if (body.status !== undefined) {
    if (!LISTING_STATUSES.includes(body.status)) return json({ error: 'Statut invalide' }, 400);
    sets.push('status = ?');
    values.push(body.status);
  }
  if (body.title !== undefined) {
    sets.push('title = ?'); values.push(normalizeText(body.title, 160));
  }
  if (body.description !== undefined) {
    sets.push('description = ?'); values.push(normalizeMultilineText(body.description, 1000) || null);
  }
  if (body.price !== undefined) {
    const p = Number(body.price);
    if (Number.isNaN(p) || p < 0) return json({ error: 'Prix invalide' }, 400);
    sets.push('price = ?'); values.push(p);
  }

  if (!sets.length) return json({ error: 'Aucun champ à modifier' }, 400);

  sets.push("updated_at = datetime('now')");
  values.push(params.id);
  await env.DB.prepare(`UPDATE listings SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
  return json({ success: true });
}

// DELETE /api/admin/listings/:id — supprimer une annonce (admin)
async function deleteListing(_req, env, params) {
  const listing = await env.DB.prepare('SELECT id, image_url FROM listings WHERE id = ?').bind(params.id).first();
  if (!listing) return json({ error: 'Annonce introuvable' }, 404);
  // Supprimer image R2 si existante
  if (env.R2_BUCKET && listing.image_url && listing.image_url.startsWith('/images/')) {
    const key = listing.image_url.replace('/images/', '');
    try { await env.R2_BUCKET.delete(key); } catch (_) { /* non bloquant */ }
  }
  await env.DB.prepare('DELETE FROM listings WHERE id = ?').bind(params.id).run();
  return json({ success: true });
}

function buildCheckoutReturnUrl(baseUrl, orderId, status) {
  const url = new URL(baseUrl, 'https://boutique.americanfullfightingbons.fr/');
  url.searchParams.set('order', String(orderId));
  url.searchParams.set('status', status);
  return url.toString();
}

const PDF_LOGO_JPEG_BASE64 = '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';

// NOTE pour la migration : ajouter dans schema.sql ou une nouvelle migration :
// CREATE TABLE IF NOT EXISTS admin_config (
//   key   TEXT PRIMARY KEY,
//   value TEXT NOT NULL
// );
// -- Puis générer le hash initial avec : node -e "..."  ou via un script dédié
// -- et insérer : INSERT INTO admin_config (key, value) VALUES ('admin_password_hash', '<hash_pbkdf2>');
