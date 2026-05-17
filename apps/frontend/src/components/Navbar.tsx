import { Link } from 'react-router-dom'

export default function Navbar() {
  return (
    <header className="fixed top-0 left-0 w-full z-50 backdrop-blur-xl bg-black/60 border-b border-white/5">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link
          to="/"
          className="text-2xl md:text-4xl font-black uppercase tracking-wide"
        >
          AFFB
        </Link>

        <nav className="hidden md:flex items-center gap-8 text-sm uppercase tracking-widest">
          <Link to="/shop">Boutique</Link>
          <Link to="/events">Stages</Link>
          <Link to="/gallery">Galerie</Link>
          <Link to="/admin">Admin</Link>
        </nav>
      </div>
    </header>
  )
}
