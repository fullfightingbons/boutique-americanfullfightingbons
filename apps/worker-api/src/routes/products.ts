import { Hono } from 'hono'

const app = new Hono()

app.get('/products', async (c: any) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM products WHERE active = 1'
  ).all()

  return c.json(results)
})

app.get('/products/:slug', async (c: any) => {
  const slug = c.req.param('slug')

  const product = await c.env.DB.prepare(
    'SELECT * FROM products WHERE slug = ?'
  )
    .bind(slug)
    .first()

  return c.json(product)
})

export default app
