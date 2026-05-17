import { useEffect, useState } from 'react'
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
    <div className="pt-32 px-6 pb-20 max-w-7xl mx-auto grid lg:grid-cols-2 gap-16">
      <div>
        <img
          src={product.image_url}
          className="rounded-3xl w-full"
        />
      </div>

      <div>
        <p className="uppercase tracking-[0.3em] text-red-600 mb-4">
          AFFB Official
        </p>

        <h1 className="text-6xl font-black uppercase mb-6">
          {product.title}
        </h1>

        <p className="text-zinc-400 text-lg leading-relaxed mb-10">
          {product.description}
        </p>

        <div className="flex items-center gap-6 mb-10">
          <span className="text-5xl text-red-500 font-black">
            {product.price} €
          </span>
        </div>

        <button
          onClick={buy}
          className="bg-red-700 hover:bg-red-600 px-10 py-5 rounded-2xl text-xl font-bold transition-all"
        >
          Acheter maintenant
        </button>
      </div>
    </div>
  )
}
