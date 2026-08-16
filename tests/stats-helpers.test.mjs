import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveSeasonLabel,
  buildRevenueBreakdown,
} from "../src/stats-helpers.mjs";

test("resolveSeasonLabel: septembre à décembre démarre la saison de cette année-là", () => {
  assert.equal(resolveSeasonLabel("2025-09-01 10:00:00"), "2025-2026");
  assert.equal(resolveSeasonLabel("2025-12-31 23:59:59"), "2025-2026");
});

test("resolveSeasonLabel: janvier à août appartient à la saison démarrée l'année précédente", () => {
  assert.equal(resolveSeasonLabel("2026-01-01 00:00:00"), "2025-2026");
  assert.equal(resolveSeasonLabel("2026-08-31 23:59:59"), "2025-2026");
});

test("resolveSeasonLabel: valeur manquante ou invalide renvoie 'inconnue'", () => {
  assert.equal(resolveSeasonLabel(""), "inconnue");
  assert.equal(resolveSeasonLabel(null), "inconnue");
});

test("buildRevenueBreakdown: ventile et arrondit par saison et par catégorie", () => {
  const rows = [
    { created_at: "2025-09-10 12:00:00", category: "gants", amount: 59 },
    { created_at: "2025-10-01 08:00:00", category: "gants", amount: 65 },
    { created_at: "2025-11-01 08:00:00", category: "protections", amount: 18 },
    { created_at: "2026-02-01 08:00:00", category: "tenues", amount: 28 },
    { created_at: "2024-09-01 08:00:00", category: "gants", amount: 100 },
  ];
  const result = buildRevenueBreakdown(rows);

  assert.deepEqual(result.by_season, [
    { saison: "2025-2026", total: 170 },
    { saison: "2024-2025", total: 100 },
  ]);

  const gants = result.by_category.find((c) => c.category === "gants");
  assert.equal(gants.total, 224);

  const seasonCat = result.by_season_category.find(
    (r) => r.saison === "2025-2026" && r.category === "gants"
  );
  assert.equal(seasonCat.total, 124);
});

test("buildRevenueBreakdown: produit supprimé retombe sur 'autre' sans faire disparaître le CA", () => {
  const rows = [{ created_at: "2025-09-10 12:00:00", category: null, amount: 42 }];
  const result = buildRevenueBreakdown(rows);
  assert.equal(result.by_category[0].category, "autre");
  assert.equal(result.by_category[0].total, 42);
});

test("buildRevenueBreakdown: tableau vide renvoie des ventilations vides", () => {
  const result = buildRevenueBreakdown([]);
  assert.deepEqual(result.by_season, []);
  assert.deepEqual(result.by_category, []);
  assert.deepEqual(result.by_season_category, []);
});
