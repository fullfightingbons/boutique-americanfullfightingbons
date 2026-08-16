// ============================================================
//  AFFB Boutique — Logique pure de ventilation du CA
//  Extraite de worker.js pour rester testable sans D1/Worker,
//  même principe que helloasso-helpers.mjs pour le paiement.
// ============================================================

// Saison sportive club : 1er septembre → 31 août (ex: un achat le
// 10/09/2025 et un autre le 20/03/2026 appartiennent tous deux à la
// saison "2025-2026"). `dateStr` est au format SQLite de
// `datetime('now')` : "YYYY-MM-DD HH:MM:SS" (toujours UTC, jamais de
// suffixe "Z") — on découpe la chaîne directement plutôt que de passer
// par `new Date(...)`, dont le parsing de ce format (espace, pas de
// "T"/"Z") dépend du moteur JS.
export function resolveSeasonLabel(dateStr) {
  const str   = String(dateStr || '');
  const year  = parseInt(str.slice(0, 4), 10);
  const month = parseInt(str.slice(5, 7), 10);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return 'inconnue';
  return month >= 9 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Regroupe des lignes { created_at, category, amount } (une ligne par
// order_item — cf. getStats dans worker.js) en trois ventilations.
// `category` doit déjà être résolue en amont (COALESCE côté SQL pour les
// order_items dont le produit a été supprimé depuis) pour que la somme de
// chaque ventilation reste toujours égale à total_revenue, même si un
// produit n'existe plus.
export function buildRevenueBreakdown(rows) {
  const bySeason         = new Map();
  const byCategory       = new Map();
  const bySeasonCategory = new Map();

  for (const row of rows || []) {
    const saison   = resolveSeasonLabel(row.created_at);
    const category = row.category || 'autre';
    const amount   = Number(row.amount) || 0;

    const s = bySeason.get(saison) || { saison, total: 0 };
    s.total += amount;
    bySeason.set(saison, s);

    const c = byCategory.get(category) || { category, total: 0 };
    c.total += amount;
    byCategory.set(category, c);

    const key = saison + '\u0000' + category;
    const sc = bySeasonCategory.get(key) || { saison, category, total: 0 };
    sc.total += amount;
    bySeasonCategory.set(key, sc);
  }

  const bySeasonDesc = (a, b) => b.saison.localeCompare(a.saison);

  return {
    by_season: [...bySeason.values()]
      .map((r) => ({ ...r, total: round2(r.total) }))
      .sort(bySeasonDesc),
    by_category: [...byCategory.values()]
      .map((r) => ({ ...r, total: round2(r.total) }))
      .sort((a, b) => b.total - a.total),
    by_season_category: [...bySeasonCategory.values()]
      .map((r) => ({ ...r, total: round2(r.total) }))
      .sort((a, b) => bySeasonDesc(a, b) || b.total - a.total),
  };
}
