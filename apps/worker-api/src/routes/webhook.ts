import { Hono } from 'hono'
import { sendOrderEmail } from '../utils/brevo'

const app = new Hono()

app.post('/webhooks/helloasso', async (c: any) => {
  const body = await c.req.json()

  await c.env.DB.prepare(
    `INSERT INTO orders (
      customer_email,
      total,
      status
    ) VALUES (?, ?, ?)`
  )
    .bind(
      body.data.payer.email,
      body.data.amount.total,
      'paid'
    )
    .run()

  await sendOrderEmail(
    c.env,
    body.data.payer.email
  )

  return c.json({ received: true })
})

export default app
