import { Hono } from 'hono'

const app = new Hono()

app.post('/admin/products', async (c: any) => {
  const body = await c.req.json()

  const slug = body.title
    .toLowerCase()
    .replace(/ /g, '-')

  await c.env.DB.prepare(
    `INSERT INTO products (
      title,
      slug,
      description,
      price,
      image_url
    ) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(
      body.title,
      slug,
      body.description,
      body.price,
      body.image_url
    )
    .run()

  return c.json({ success: true })
})

export default app
