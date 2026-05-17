import { Link } from 'react-router-dom'
            Équipement officiel, textile combat et accessoires premium.
          </p>

          <div className="flex flex-col md:flex-row gap-4 justify-center">
            <Link
              to="/shop"
              className="bg-red-700 hover:bg-red-600 px-10 py-5 rounded-2xl text-lg font-bold transition-all"
            >
              Accéder à la boutique
            </Link>

            <a
              href="https://americanfullfightingbons.fr"
              className="border border-white/20 hover:border-red-700 px-10 py-5 rounded-2xl text-lg transition-all"
            >
              Découvrir le club
            </a>
          </div>
        </div>
      </section>

      <section className="py-20 px-6 max-w-7xl mx-auto">
        <div className="grid md:grid-cols-3 gap-6">
          <div className="bg-zinc-900 rounded-3xl p-8 border border-zinc-800">
            <h3 className="text-3xl font-black mb-4 text-red-600">
              Textile MMA
            </h3>

            <p className="text-zinc-400">
              Rashguards, shorts, hoodies et équipements officiels.
            </p>
          </div>

          <div className="bg-zinc-900 rounded-3xl p-8 border border-zinc-800">
            <h3 className="text-3xl font-black mb-4 text-red-600">
              Combat Gear
            </h3>

            <p className="text-zinc-400">
              Gants, protections et matériel haute performance.
            </p>
          </div>

          <div className="bg-zinc-900 rounded-3xl p-8 border border-zinc-800">
            <h3 className="text-3xl font-black mb-4 text-red-600">
              AFFB Community
            </h3>

            <p className="text-zinc-400">
              Club, stages, événements et communauté combat.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
