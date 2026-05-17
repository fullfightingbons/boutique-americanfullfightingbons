import { useEffect, useState } from 'react'
    price: '',
    description: '',
    image_url: ''
  })

  async function createProduct() {
    await api.post('/admin/products', form)
    location.reload()
  }

  useEffect(() => {
    api.get('/products').then((res) => {
      setProducts(res.data)
    })
  }, [])

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-4xl font-black mb-8">Dashboard Admin</h1>

      <div className="bg-zinc-900 p-6 rounded-2xl mb-10">
        <h2 className="text-2xl mb-4">Ajouter un produit</h2>

        <div className="grid gap-4">
          <input
            placeholder="Titre"
            className="bg-black p-3 rounded"
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />

          <input
            placeholder="Prix"
            className="bg-black p-3 rounded"
            onChange={(e) => setForm({ ...form, price: e.target.value })}
          />

          <textarea
            placeholder="Description"
            className="bg-black p-3 rounded"
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />

          <input
            placeholder="Image URL"
            className="bg-black p-3 rounded"
            onChange={(e) => setForm({ ...form, image_url: e.target.value })}
          />

          <button
            onClick={createProduct}
            className="bg-red-700 p-3 rounded"
          >
            Ajouter
          </button>
        </div>
      </div>

      <div className="grid gap-4">
        {products.map((product: any) => (
          <div
            key={product.id}
            className="bg-zinc-900 p-4 rounded-xl flex justify-between"
          >
            <span>{product.title}</span>
            <span>{product.price} €</span>
          </div>
        ))}
      </div>
    </div>
  )
}
