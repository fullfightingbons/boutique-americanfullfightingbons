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
