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
});

test("il login usa credenziali account e salva il tenant restituito dal server", async () => {
  const html = await text("login.html");
  assert.match(html, /Email o nome utente/);
  assert.match(html, /autocomplete="current-password"/);
  assert.match(html, /JSON\.stringify\(\{login,password\}\)/);
  assert.match(html, /payload\.tenantId/);
  assert.match(html, /location\.replace\("\/app"\)/);
});

test("la dashboard autenticata verifica sessione e configurazione attività", async () => {
  const html = await text("app.html");
  assert.match(html, /fetch\("\/api\/auth"/);
  assert.match(html, /fetch\("\/api\/activity-profile"/);
  assert.match(html, /x-maviri-tenant/);
  assert.match(html, /if\(!\(await verify\(\)\)\)/);
  assert.match(html, /if\(!\(await activityConfigured\(\)\)\)/);
  assert.match(html, /location\.replace\("\/setup"\)/);
  assert.match(html, /ownerSyncToken/);
  assert.match(html, /field\.style\.display="none"/);
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
