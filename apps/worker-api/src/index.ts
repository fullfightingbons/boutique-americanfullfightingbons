import { Hono } from 'hono'
import products from './routes/products'
import admin from './routes/admin'
import checkout from './routes/checkout'
import webhook from './routes/webhook'

const app = new Hono()

app.route('/api', products)
app.route('/api', admin)
app.route('/api', checkout)
app.route('/api', webhook)

export default app
