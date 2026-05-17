import { Hono } from 'hono'
import { createHelloAssoCheckout } from '../utils/helloasso'

const app = new Hono()

app.post('/checkout', async (c: any) => {
  const body = await c.req.json()

  const product = await c.env.DB.prepare(
    'SELECT * FROM products WHERE id = ?'
  )
    .bind(body.productId)
    .first()

  const checkout = await createHelloAssoCheckout(c.env, product)

  return c.json({
    checkoutUrl: checkout.redirectUrl
  })
})

export default app
