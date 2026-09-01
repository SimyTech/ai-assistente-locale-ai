import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("la root Maviri passa dalla schermata di accesso", async () => {
  const config = JSON.parse(await text("vercel.json"));
  const routes = new Map(config.rewrites.map(item => [item.source, item.destination]));
  assert.equal(routes.get("/"), "/login.html");
  assert.equal(routes.get("/app"), "/app.html");
  assert.equal(routes.get("/setup"), "/setup.html");
  assert.equal(routes.get("/api/chat"), "/api/chat-proxy");
  assert.equal(routes.get("/api/whatsapp"), "/api/whatsapp-proxy");
});

test("il login usa credenziali account e salva il tenant restituito dal server", async () => {
  const html = await text("login.html");
  assert.match(html, /Email o nome utente/);
  assert.match(html, /autocomplete="current-password"/);
  assert.match(html, /JSON\.stringify\(\{login,password\}\)/);
  assert.match(html, /payload\.tenantId/);
  assert.match(html, /location\.replace\("\/app"\)/);
});

test("la dashboard verifica sessione e carica il profilo prima di mostrare index", async () => {
  const html = await text("app.html");
  assert.match(html, /api\("\/api\/auth"\)/);
  assert.match(html, /api\("\/api\/activity-profile"\)/);
  assert.match(html, /x-maviri-tenant/);
  assert.match(html, /if\(!\(await verify\(\)\)\)/);
  assert.match(html, /if\(!j\.configured\)\{location\.replace\("\/setup"\)/);
  assert.match(html, /adaptiveDashboardPlan\(profile\)/);
  assert.match(html, /frame\.src="\/index\.html"/);
  assert.match(html, /ownerSyncToken/);
});

test("il bridge autenticato forza tenant e profilo su Mavi", async () => {
  const html = await text("app.html");
  assert.match(html, /function installApiBridge/);
  assert.match(html, /headers\.set\("x-maviri-tenant",t\)/);
  assert.match(html, /payload\.tenantId=t/);
  assert.match(html, /payload\.activityProfile=profile/);
  assert.match(html, /credentials:init\.credentials\|\|"same-origin"/);
});

test("la dashboard adatta navigazione e moduli al modo di lavorare", async () => {
  const html = await text("app.html");
  assert.match(html, /reorderNavigation/);
  assert.match(html, /adaptLabels/);
  assert.match(html, /adaptCapabilities/);
  assert.match(html, /plan\.visible\.calendar/);
  assert.match(html, /plan\.labels\.clients/);
  assert.match(html, /plan\.labels\.appointments/);
  assert.match(html, /Configura attività/);
});

test("l'onboarding non impone un solo settore o l'uso dell'agenda", async () => {
  const html = await text("setup.html");
  assert.match(html, /Altro \/ generico/);
  assert.match(html, /Non uso un'agenda/);
  assert.match(html, /Principalmente senza appuntamento/);
  assert.match(html, /Come chiami ciò che offri/);
  assert.match(html, /Come chiami chi si rivolge a te/);
});

test("il login migra il vecchio token ma non lo conserva dopo la sessione", async () => {
  const html = await text("login.html");
  assert.match(html, /migrateLegacy/);
  assert.match(html, /localStorage\.removeItem\(LEGACY_TOKEN_KEY\)/);
});
