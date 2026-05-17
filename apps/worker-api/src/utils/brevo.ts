export async function sendOrderEmail(env: any, email: string) {
  await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sender: {
        name: 'AFFB SHOP',
        email: 'contact@americanfullfightingbons.fr'
      },
      to: [{ email }],
      subject: 'Commande AFFB confirmée',
      htmlContent: `
        <div style="background:#000;padding:40px;color:white;font-family:Arial;">
          <h1 style="color:#b91c1c;">Merci pour votre commande</h1>
          <p>Votre paiement a été validé.</p>
        </div>
      `
    })
  })
}
