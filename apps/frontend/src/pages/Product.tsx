import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../lib/api'

export default function Product() {
  const { slug } = useParams()
  const [product, setProduct] = useState<any>()

  useEffect(() => {
    api.get(`/products/${slug}`).then((res) => {
      setProduct(res.data)
    })
  }, [])

  async function buy() {
    const res = await api.post('/checkout', {
      productId: product.id
    })

    window.location.href = res.data.checkoutUrl
  }

  if (!product) return null

  return (
    <div className="max-w-6xl mx-auto p-8 grid md:grid-cols-2 gap-8">
      <img src={product.image_url} className="rounded-2xl" />

      <div>
        <h1 className="text-5xl font-black mb-4">
          {product.title}
        </h1>

        <p className="text-zinc-300 mb-6">
          {product.description}
        </p>

        <p className="text-3xl text-red-500 mb-6">
          {product.price} €
        </p>

        <button
          onClick={buy}
          className="bg-red-700 px-8 py-4 rounded-xl"
        >
          Acheter
        </button>
      </div>
    </div>
  )
}
