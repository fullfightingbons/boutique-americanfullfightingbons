import { Link } from 'react-router-dom'

export default function ProductCard({ product }: any) {
  return (
    <div className="bg-zinc-900 rounded-xl overflow-hidden border border-zinc-800 hover:border-red-700 transition-all">
      <img
        src={product.image_url}
        className="w-full h-64 object-cover"
      />

      <div className="p-4">
        <h3 className="text-xl font-bold mb-2">
          {product.title}
        </h3>

        <p className="text-red-500 text-lg mb-4">
          {product.price} €
        </p>

        <Link
          to={`/product/${product.slug}`}
          className="bg-red-700 px-4 py-2 rounded-lg inline-block"
        >
          Voir
        </Link>
      </div>
    </div>
  )
}
