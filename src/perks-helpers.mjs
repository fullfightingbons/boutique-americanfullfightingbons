// Avantages adhérent en boutique — logique pure, testable sans D1 ni Worker.
//
// Tenue offerte aux Membres du Bureau : même convention de détection que
// l'inscription (inscription/src/routes/_lib/boutique-stock.js) — un produit
// est un vêtement du club si son nom contient "t-shirt"/"tshirt" ou
// "pantalon". Renommer un produit chaque saison ("T-shirt Club 2027") ne
// casse donc rien tant que ce mot-clé reste.
export function isClubClothingProduct(product) {
  return /t-?shirt|pantalon/i.test(String(product?.name || ''));
}

// Prix unitaire réellement facturé : 0 pour un vêtement du club commandé par
// un Membre du Bureau identifié (cf. resolveBureauMember dans worker.js),
// prix catalogue sinon.
export function effectiveUnitPrice(product, isBureauMember) {
  return isBureauMember === true && isClubClothingProduct(product) ? 0 : Number(product?.price);
}

// Décide si l'adhérent qui commande est un Membre du Bureau, ET POURQUOI pas
// quand ce n'est pas le cas. Dépendances injectées (requireMember, fetchImpl)
// pour rester testable sans Worker ni D1.
//
// Ne lève jamais : au moindre doute l'adhérent paie le tarif public (jamais
// l'inverse). Mais le motif est désormais renvoyé — auparavant tous les échecs
// (jeton invalide, secret manquant, gestion injoignable, fiche non "bureau")
// se confondaient en un silencieux `false`, impossible à diagnostiquer.
//
// reason :
//   bureau              → membre du bureau confirmé par gestion
//   no_token            → pas de jeton membre (visiteur ordinaire)
//   invalid_token       → jeton falsifié, expiré, ou signé avec un autre SESSION_SECRET
//   server_config       → SESSION_SECRET ou GESTION_SYNC_TOKEN manquant côté boutique
//   gestion_unreachable → appel réseau vers gestion échoué
//   gestion_refused     → gestion a répondu HTTP non-2xx (status renseigné :
//                         401 = secret partagé différent OU route pas déployée)
//   gestion_bad_response→ réponse de gestion illisible / sans champ `bureau`
//   not_bureau          → gestion répond que la fiche n'est PAS "Membre du Bureau"
export async function lookupBureauStatus({ hasBearer, requireMember, gestionUrl, syncToken, fetchImpl = fetch }) {
  if (!hasBearer) return { bureau: false, reason: 'no_token' };

  let member;
  try {
    member = await requireMember();
  } catch (err) {
    return { bureau: false, reason: 'server_config', detail: String(err?.message || err) };
  }
  if (!member) return { bureau: false, reason: 'invalid_token' };
  if (!syncToken) return { bureau: false, reason: 'server_config', detail: 'GESTION_SYNC_TOKEN manquant' };

  const email = String(member.email).trim().toLowerCase();
  let res;
  try {
    res = await fetchImpl(gestionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Boutique-Sales-Token': syncToken },
      body: JSON.stringify({ email }),
    });
  } catch (err) {
    return { bureau: false, reason: 'gestion_unreachable', detail: String(err?.message || err) };
  }
  if (!res.ok) return { bureau: false, reason: 'gestion_refused', status: res.status };

  const body = await res.json().catch(() => null);
  if (body?.data?.bureau === true) return { bureau: true, reason: 'bureau' };
  if (body?.data?.bureau === false) return { bureau: false, reason: 'not_bureau', checked_email: email };
  return { bureau: false, reason: 'gestion_bad_response' };
}
