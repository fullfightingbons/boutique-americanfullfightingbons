import { Hono } from 'hono'
import { sign } from 'hono/jwt'

const app = new Hono()

app.post('/admin/login', async (c: any) => {
  const body = await c.req.json()

  if (
    body.email !== c.env.ADMIN_EMAIL ||
    body.password !== c.env.ADMIN_PASSWORD
  ) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const token = await sign(
    {
      email: body.email,
      role: 'admin'
    },
    c.env.JWT_SECRET
  )

  return c.json({ token })
})

export default app
