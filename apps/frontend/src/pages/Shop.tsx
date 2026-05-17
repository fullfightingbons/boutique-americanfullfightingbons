import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import ProductCard from '../components/ProductCard'

export default function Shop() {
  const [products, setProducts] = useState([])

  useEffect(() => {
    api.get('/products').then((res) => {
      setProducts(res.data)
    })
  }, [])

  return (
    <div className="p-8 grid grid-cols-1 md:grid-cols-3 gap-6">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  )
}
