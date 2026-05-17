export async function createHelloAssoCheckout(
  env: any,
  product: any
) {
  const response = await fetch(
    `https://api.helloasso.com/v5/organizations/${env.HELLOASSO_ORG}/checkout-intents`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.HELLOASSO_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        totalAmount: Math.round(product.price * 100),
        initialAmount: Math.round(product.price * 100),
        itemName: product.title,
        backUrl: 'https://boutique.americanfullfightingbons.fr/success'
      })
    }
  )

  return response.json()
}
