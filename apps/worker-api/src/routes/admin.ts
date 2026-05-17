import { Hono } from 'hono'

  const slug = body.title
    .toLowerCase()
    .replace(/ /g, '-')

  await c.env.DB.prepare(
    `INSERT INTO products (
      title,
      slug,
      description,
      price,
      image_url,
      stock,
      category
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      body.title,
      slug,
      body.description,
      body.price,
      body.image_url,
      body.stock,
      body.category
    )
    .run()

  return c.json({ success: true })
})

app.put('/admin/products/:id', async (c: any) => {
  const id = c.req.param('id')
  const body = await c.req.json()

  await c.env.DB.prepare(
    `UPDATE products
     SET title = ?,
         description = ?,
         price = ?,
         stock = ?
     WHERE id = ?`
  )
    .bind(
      body.title,
      body.description,
      body.price,
      body.stock,
      id
    )
    .run()

  return c.json({ success: true })
})

app.delete('/admin/products/:id', async (c: any) => {
  const id = c.req.param('id')

  await c.env.DB.prepare(
    'DELETE FROM products WHERE id = ?'
  )
    .bind(id)
    .run()

  return c.json({ success: true })
})

export default app
