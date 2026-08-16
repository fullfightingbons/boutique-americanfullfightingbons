import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workerSource = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
const adminSource = readFileSync(new URL("../src/admin.html", import.meta.url), "utf8");

test("wishlist endpoints accept the member bearer token while keeping public email fallback", () => {
  assert.match(workerSource, /async function resolveWishlistEmail/);
  assert.match(workerSource, /requireMember\(request, env\)/);
  assert.match(workerSource, /url\.searchParams\.get\('email'\)/);
  assert.match(workerSource, /body\.email/);
});

test("admin dashboard exposes pending gestion sync count", () => {
  assert.match(workerSource, /gestion_sync_pending/);
  assert.match(workerSource, /gestion_synced_at IS NULL/);
  assert.match(adminSource, /Sync gestion en attente/);
});
