import test from 'node:test';
import assert from 'node:assert/strict';

import { isClubClothingProduct, effectiveUnitPrice } from '../src/perks-helpers.mjs';

const TSHIRT = { id: 1, name: 'T-shirt Club 2027', price: 25 };
const PANTALON = { id: 2, name: 'Pantalon budo noir', price: 15 };
const GANTS = { id: 3, name: 'Gants de boxe', price: 45 };

test('reconnaît les t-shirts et pantalons du club, quelle que soit la saison ou la casse', () => {
  assert.equal(isClubClothingProduct(TSHIRT), true);
  assert.equal(isClubClothingProduct({ name: 'TSHIRT noir' }), true);
  assert.equal(isClubClothingProduct(PANTALON), true);
  assert.equal(isClubClothingProduct(GANTS), false);
  assert.equal(isClubClothingProduct(null), false);
});

test('membre du bureau identifié : vêtements du club à 0 €, autres produits inchangés', () => {
  assert.equal(effectiveUnitPrice(TSHIRT, true), 0);
  assert.equal(effectiveUnitPrice(PANTALON, true), 0);
  assert.equal(effectiveUnitPrice(GANTS, true), 45);
});

test('tout autre visiteur paie le prix catalogue (même vêtement)', () => {
  assert.equal(effectiveUnitPrice(TSHIRT, false), 25);
  assert.equal(effectiveUnitPrice(PANTALON, undefined), 15);
  // Seul `true` strict ouvre la gratuité : jamais une valeur "truthy" approximative.
  assert.equal(effectiveUnitPrice(TSHIRT, 'true'), 25);
  assert.equal(effectiveUnitPrice(TSHIRT, 1), 25);
});
