import { Hono } from 'hono'

const app = new Hono()

app.post('/admin/upload', async (c: any) => {
  const form = await c.req.formData()

  const file = form.get('file') as File

  const filename = `${Date.now()}-${file.name}`

  await c.env.PRODUCT_BUCKET.put(filename, file.stream(), {
    httpMetadata: {
      contentType: file.type
    }
  })

  return c.json({
    url: `${c.env.R2_PUBLIC_URL}/${filename}`
  })
})

export default app
