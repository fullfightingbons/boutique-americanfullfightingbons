import { Hono } from 'hono'
import { cors } from 'hono/cors'

import products from './routes/products'
import checkout from './routes/checkout'
import webhook from './routes/webhook'
import auth from './routes/auth'
import admin from './routes/admin'
import upload from './routes/upload'

const app = new Hono()

app.use('*', cors())

app.route('/api', products)
app.route('/api', checkout)
app.route('/api', webhook)
app.route('/api', auth)
app.route('/api', admin)
app.route('/api', upload)

export default app
