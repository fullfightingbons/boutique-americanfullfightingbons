import test from 'node:test';
import assert from 'node:assert/strict';

import { isClubClothingProduct, effectiveUnitPrice, lookupBureauStatus } from '../src/perks-helpers.mjs';

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

// ── lookupBureauStatus : le motif d'un refus doit être identifiable ─────────

const MEMBER = { kind: 'member', email: '  Teddy@Example.com ' };
const gestionReply = (status, body) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
const base = (over = {}) => ({
  hasBearer: true,
  requireMember: async () => MEMBER,
  gestionUrl: 'https://gestion.example/api/internal/boutique/member-status',
  syncToken: 'secret-partage-1234',
  fetchImpl: gestionReply(200, { data: { bureau: true }, error: null }),
  ...over,
});

test('lookupBureauStatus : membre du bureau confirmé, email normalisé et secret transmis à gestion', async () => {
  let seen;
  const r = await lookupBureauStatus(base({
    fetchImpl: async (url, init) => { seen = { url, init }; return gestionReply(200, { data: { bureau: true } })(); },
  }));
  assert.deepEqual(r, { bureau: true, reason: 'bureau' });
  assert.equal(seen.init.headers['X-Boutique-Sales-Token'], 'secret-partage-1234');
  assert.deepEqual(JSON.parse(seen.init.body), { email: 'teddy@example.com' });
});

test('lookupBureauStatus : sans jeton → no_token, gestion jamais appelé', async () => {
  let called = false;
  const r = await lookupBureauStatus(base({ hasBearer: false, fetchImpl: async () => { called = true; } }));
  assert.deepEqual(r, { bureau: false, reason: 'no_token' });
  assert.equal(called, false);
});

test('lookupBureauStatus : jeton falsifié/expiré/autre SESSION_SECRET → invalid_token', async () => {
  const r = await lookupBureauStatus(base({ requireMember: async () => null }));
  assert.equal(r.bureau, false);
  assert.equal(r.reason, 'invalid_token');
});

test('lookupBureauStatus : SESSION_SECRET manquant (requireMember lève) → server_config', async () => {
  const r = await lookupBureauStatus(base({ requireMember: async () => { throw new Error('SESSION_SECRET manquant'); } }));
  assert.equal(r.bureau, false);
  assert.equal(r.reason, 'server_config');
});

test('lookupBureauStatus : GESTION_SYNC_TOKEN manquant → server_config, gestion jamais appelé', async () => {
  let called = false;
  const r = await lookupBureauStatus(base({ syncToken: undefined, fetchImpl: async () => { called = true; } }));
  assert.equal(r.reason, 'server_config');
  assert.equal(called, false);
});

test('lookupBureauStatus : gestion injoignable → gestion_unreachable', async () => {
  const r = await lookupBureauStatus(base({ fetchImpl: async () => { throw new Error('network down'); } }));
  assert.equal(r.bureau, false);
  assert.equal(r.reason, 'gestion_unreachable');
});

test('lookupBureauStatus : gestion répond 401 (secret différent ou route non déployée) → gestion_refused + status', async () => {
  const r = await lookupBureauStatus(base({ fetchImpl: gestionReply(401, { error: { message: 'Non autorisé' } }) }));
  assert.deepEqual(r, { bureau: false, reason: 'gestion_refused', status: 401 });
});

test('lookupBureauStatus : fiche non "Membre du Bureau" → not_bureau, avec l\'email vérifié', async () => {
  const r = await lookupBureauStatus(base({ fetchImpl: gestionReply(200, { data: { bureau: false } }) }));
  assert.deepEqual(r, { bureau: false, reason: 'not_bureau', checked_email: 'teddy@example.com' });
});

test('lookupBureauStatus : réponse de gestion illisible ou sans champ bureau → gestion_bad_response, jamais gratuit', async () => {
  const noBody = async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json'); } });
  assert.equal((await lookupBureauStatus(base({ fetchImpl: noBody }))).reason, 'gestion_bad_response');
  const truthy = await lookupBureauStatus(base({ fetchImpl: gestionReply(200, { data: { bureau: 'true' } }) }));
  assert.equal(truthy.bureau, false, 'seul le booléen true ouvre la gratuité');
  assert.equal(truthy.reason, 'gestion_bad_response');
});
