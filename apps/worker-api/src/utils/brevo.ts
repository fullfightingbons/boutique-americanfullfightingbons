export async function sendOrderEmail(env: any, email: string) {
  await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sender: {
        name: 'AFFB',
        email: 'contact@americanfullfightingbons.fr'
      },
      to: [{ email }],
      subject: 'Commande confirmée',
      htmlContent: '<h1>Merci pour votre commande</h1>'
    })
  })
}
