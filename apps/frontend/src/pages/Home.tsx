import { Link } from 'react-router-dom'

export default function Home() {
  return (
    <div>
      <section className="h-[70vh] flex flex-col justify-center items-center text-center px-4">
        <h1 className="text-6xl font-black mb-6 text-red-600">
          AMERICAN FULL FIGHTING BONS
        </h1>

        <p className="text-xl max-w-2xl text-zinc-300 mb-8">
          Boutique officielle inspirée de l’univers MMA et combat.
        </p>

        <Link
          to="/shop"
          className="bg-red-700 hover:bg-red-600 px-8 py-4 rounded-xl text-lg"
        >
          Accéder à la boutique
        </Link>
      </section>
    </div>
  )
}
