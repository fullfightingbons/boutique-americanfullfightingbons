import { Link } from 'react-router-dom'

export default function ProductCard({ product }: any) {
  return (
    <div className="group bg-zinc-950 rounded-3xl overflow-hidden border border-zinc-900 hover:border-red-700 transition-all duration-500">
      <div className="overflow-hidden">
        <img
          src={product.image_url}
          className="w-full h-[420px] object-cover group-hover:scale-110 transition-all duration-700"
        />
      </div>

      <div className="p-6">
        <h3 className="text-3xl font-black uppercase mb-3">
          {product.title}
        </h3>

        <p className="text-zinc-500 mb-6">
          {product.description}
        </p>

        <div className="flex items-center justify-between">
          <span className="text-2xl text-red-500 font-bold">
            {product.price} €
          </span>

          <Link
            to={`/product/${product.slug}`}
            className="bg-red-700 hover:bg-red-600 px-5 py-3 rounded-xl"
          >
            Voir
          </Link>
        </div>
      </div>
    </div>
  )
}
