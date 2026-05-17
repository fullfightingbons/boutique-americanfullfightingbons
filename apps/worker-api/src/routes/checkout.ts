import { Hono } from 'hono'

const app = new Hono()

app.post('/checkout', async (c: any) => {
  const body = await c.req.json()

  const product = await c.env.DB.prepare(
    'SELECT * FROM products WHERE id = ?'
  )
    .bind(body.productId)
    .first()

  const response = await fetch(
    `https://api.helloasso.com/v5/organizations/${c.env.HELLOASSO_ORG}/checkout-intents`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.env.HELLOASSO_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        totalAmount: Math.round(product.price * 100),
        initialAmount: Math.round(product.price * 100),
        itemName: product.title,
        backUrl: 'https://boutique.americanfullfightingbons.fr/success'
      })
    }
  )

  const data = await response.json()

  return c.json({
    checkoutUrl: data.redirectUrl
  })
})

export default app
