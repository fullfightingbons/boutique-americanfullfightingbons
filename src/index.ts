/**
 * Worker AFFB – API + SPA
 *
 * Routes API :
 *   GET  /api/products          → liste tous les produits
 *   GET  /api/products/:slug    → un produit par slug
 *   POST /api/checkout          → crée une session Stripe (à configurer)
 *   POST /api/admin/products    → crée un produit
 *   DELETE /api/admin/products/:id → supprime un produit
 *
 * Tout le reste → sert le frontend (assets Vite via Cloudflare Assets)
 */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const { pathname } = url

    // ── CORS preflight ──────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }))
    }

    // ── Routes API ──────────────────────────────────────────────
    if (pathname.startsWith('/api/')) {
      return cors(await handleApi(pathname, request, env))
    }

    // ── Frontend (servi par Cloudflare Assets) ──────────────────
    // Si la binding ASSETS est présente (wrangler.json → "assets"),
    // on délègue. Sinon on renvoie un 200 simple pour que React Router gère.
    if (env.ASSETS) {
      // Pour le SPA : toute route inconnue renvoie index.html
      const assetReq = new Request(request)
      const resp = await env.ASSETS.fetch(assetReq)
      if (resp.status === 404) {
        const indexReq = new Request(new URL('/', url).toString(), request)
        return env.ASSETS.fetch(indexReq)
      }
      return resp
    }

    return new Response('Worker déployé. Assets non configurés.', { status: 200 })
  },
} satisfies ExportedHandler<Env>

// ── Handler API ─────────────────────────────────────────────────
async function handleApi(pathname: string, request: Request, env: Env): Promise<Response> {
  const method = request.method

  // GET /api/products
  if (pathname === '/api/products' && method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT * FROM products ORDER BY id DESC'
    ).all()
    return json(results)
  }

  // GET /api/products/:slug
  const slugMatch = pathname.match(/^\/api\/products\/([^/]+)$/)
  if (slugMatch && method === 'GET') {
    const slug = slugMatch[1]
    const product = await env.DB.prepare(
      'SELECT * FROM products WHERE slug = ?'
    ).bind(slug).first()
    if (!product) return json({ error: 'Produit introuvable' }, 404)
    return json(product)
  }

  // POST /api/checkout
  if (pathname === '/api/checkout' && method === 'POST') {
    const body = await request.json<{ productId: number }>()
    const product = await env.DB.prepare(
      'SELECT * FROM products WHERE id = ?'
    ).bind(body.productId).first()
    if (!product) return json({ error: 'Produit introuvable' }, 404)

    // TODO : intégrer Stripe avec env.STRIPE_SECRET_KEY
    // Exemple :
    // const stripe = new Stripe(env.STRIPE_SECRET_KEY)
    // const session = await stripe.checkout.sessions.create({ ... })
    // return json({ checkoutUrl: session.url })

    return json({ error: 'Stripe non configuré. Ajoutez STRIPE_SECRET_KEY.' }, 501)
  }

  // POST /api/admin/products
  if (pathname === '/api/admin/products' && method === 'POST') {
    const body = await request.json<{
      title: string; slug: string; description?: string
      price: number; image_url?: string; category?: string; stock?: number
    }>()

    if (!body.title || !body.slug || body.price === undefined) {
      return json({ error: 'title, slug et price sont requis.' }, 400)
    }

    const result = await env.DB.prepare(
      `INSERT INTO products (title, slug, description, price, image_url, category, stock)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    ).bind(
      body.title, body.slug, body.description ?? '',
      body.price, body.image_url ?? '', body.category ?? '', body.stock ?? null
    ).first()

    return json(result, 201)
  }

  // DELETE /api/admin/products/:id
  const delMatch = pathname.match(/^\/api\/admin\/products\/(\d+)$/)
  if (delMatch && method === 'DELETE') {
    const id = parseInt(delMatch[1])
    await env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run()
    return json({ success: true })
  }

  return json({ error: 'Route inconnue' }, 404)
}

// ── Helpers ─────────────────────────────────────────────────────
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function cors(response: Response): Response {
  const r = new Response(response.body, response)
  r.headers.set('Access-Control-Allow-Origin', '*')
  r.headers.set('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type')
  return r
}
