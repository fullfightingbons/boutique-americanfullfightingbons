import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Shop from './pages/Shop'
import Product from './pages/Product'
import Admin from './pages/Admin'
import Success from './pages/Success'
import Navbar from './components/Navbar'
import Footer from './components/Footer'

export default function App() {
  return (
    <div className="bg-black text-white min-h-screen overflow-hidden">
      <Navbar />

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/shop" element={<Shop />} />
        <Route path="/product/:slug" element={<Product />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/success" element={<Success />} />
      </Routes>

      <Footer />
    </div>
  )
}
