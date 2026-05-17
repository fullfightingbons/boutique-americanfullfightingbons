import { useEffect, useState } from 'react'
import ProductCard from '../components/ProductCard'
import { api } from '../lib/api'

export default function Shop() {
  const [products, setProducts] = useState([])

  useEffect(() => {
    api.get('/products').then((res) => {
      setProducts(res.data)
    })
  }, [])

  return (
    <div className="pt-32 pb-20 px-6 max-w-7xl mx-auto">
      <div className="mb-12">
        <p className="uppercase tracking-[0.3em] text-red-600 mb-3">
          Official Store
        </p>

        <h1 className="text-6xl font-black uppercase">
          Boutique AFFB
        </h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </div>
  )
}
