import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workerSource   = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
const indexSource    = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
const migrationSource = readFileSync(new URL("../migration_listing_seller_actions.sql", import.meta.url), "utf8");

test("les nouvelles colonnes vendeur sont bien migrées sur listings", () => {
  assert.match(migrationSource, /ALTER TABLE listings ADD COLUMN manage_token TEXT/);
  assert.match(migrationSource, /ALTER TABLE listings ADD COLUMN last_reminder_at TEXT/);
});

test("les routes self-service vendeur existent et sont publiques (pas de flag admin)", () => {
  assert.match(workerSource, /route\('GET',\s*'\/api\/listings\/:id\/manage',\s*getListingManageInfo\)/);
  assert.match(workerSource, /route\('POST',\s*'\/api\/listings\/:id\/mark-sold',\s*markListingSoldBySeller\)/);
});

test("createListing génère un manage_token et l'insère en base", () => {
  assert.match(workerSource, /const manageToken = randomToken\(\);/);
  assert.match(workerSource, /INSERT INTO listings \(title, description, price, category, condition, contact_name, contact_email, contact_phone, status, manage_token\)/);
});

test("markListingSoldBySeller vérifie le token, est idempotent et rate-limité", () => {
  assert.match(workerSource, /async function markListingSoldBySeller/);
  assert.match(workerSource, /isPublicActionRateLimited\(env, ip, 'listing_mark_sold'/);
  assert.match(workerSource, /secureCompare\(token, listing\.manage_token\)/);
  assert.match(workerSource, /already: true/);
});

test("le cron quotidien envoie les rappels mensuels aux annonces actives", () => {
  assert.match(workerSource, /sendListingActiveReminders\(env\)/);
  assert.match(workerSource, /status = 'active'\s*\n\s*AND COALESCE\(last_reminder_at, created_at\) <= datetime\('now', '-' \|\| \? \|\| ' days'\)/);
  assert.match(workerSource, /const LISTING_REMINDER_INTERVAL_DAYS = 30;/);
});

test("le front-end gère le lien magique 'listing_action=vendu' et nettoie l'URL", () => {
  assert.match(indexSource, /id="listingManageModal"/);
  assert.match(indexSource, /function handleListingManageReturn/);
  assert.match(indexSource, /searchParams\.get\('listing_action'\)/);
  assert.match(indexSource, /searchParams\.delete\('listing_token'\)/);
});
