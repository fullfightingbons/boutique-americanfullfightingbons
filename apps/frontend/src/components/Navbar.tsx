import { Link } from 'react-router-dom'

export default function Navbar() {
  return (
    <nav className="border-b border-red-700 p-4 flex justify-between items-center">
      <Link to="/" className="text-2xl font-bold text-red-600">
        AFFB SHOP
      </Link>

      <div className="flex gap-6">
        <Link to="/shop">Boutique</Link>
        <Link to="/admin">Admin</Link>
      </div>
    </nav>
  )
}
