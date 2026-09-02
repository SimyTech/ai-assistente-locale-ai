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
  assert.equal(routes.get("/login"), "/login.html");
  assert.equal(routes.get("/register"), "/register.html");
  assert.equal(routes.get("/app"), "/app.html");
  assert.equal(routes.get("/setup"), "/setup.html");
  assert.equal(routes.get("/account"), "/account.html");
  assert.equal(routes.get("/api/chat"), "/api/chat-entry");
  assert.equal(routes.get("/api/whatsapp"), "/api/whatsapp-proxy");
});

test("le pagine di accesso e account non vengono servite da cache", async () => {
  const config = JSON.parse(await text("vercel.json"));
  const headers = new Map(config.headers.map(item => [item.source, item.headers]));
  for (const route of ["/", "/login", "/register", "/app", "/setup", "/account"]) {
    const values = headers.get(route) || [];
    assert.ok(values.some(item => item.key === "Cache-Control" && /no-store/.test(item.value)));
  }
});

test("il login usa credenziali account e salva il tenant restituito dal server", async () => {
  const html = await text("login.html");
  assert.match(html, /Email o nome utente/);
  assert.match(html, /autocomplete="current-password"/);
  assert.match(html, /JSON\.stringify\(\{login,password\}\)/);
  assert.match(html, /payload\.tenantId/);
  assert.match(html, /location\.replace\("\/app"\)/);
  assert.match(html, /href="\/register"/);
});

test("l'accesso esplicito mostra il form anche con una sessione già valida", async () => {
  const html = await text("login.html");
  assert.match(html, /new URLSearchParams\(location\.search\)\.get\("switch"\)===\"1\"/);
  assert.match(html, /if\(FORCE_LOGIN\)\{/);
  assert.match(html, /Inserisci le credenziali dell’account che vuoi usare/);
  const forceIndex = html.indexOf("if(FORCE_LOGIN)");
  const authIndex = html.indexOf("if(await authStatus())");
  assert.ok(forceIndex >= 0 && authIndex > forceIndex);
});

test("una nuova attività può registrarsi senza configurazione tecnica", async () => {
  const html = await text("register.html");
  assert.match(html, /Nome attività/);
  assert.match(html, /Email di accesso/);
  assert.match(html, /autocomplete="new-password"/);
  assert.match(html, /fetch\("\/api\/register"/);
  assert.match(html, /localStorage\.setItem\(TENANT_KEY/);
  assert.match(html, /location\.replace\("\/setup"\)/);
  assert.match(html, /href="\/login\?switch=1"/);
});

test("la configurazione iniziale riusa nome ed email inseriti in registrazione", async () => {
  const html = await text("setup.html");
  assert.match(html, /MAVIRI_REGISTRATION_DRAFT/);
  assert.match(html, /function applyDraft/);
  assert.match(html, /localStorage\.removeItem\(DRAFT_KEY\)/);
});

test("la dashboard verifica sessione e carica il profilo prima di mostrare index", async () => {
  const html = await text("app.html");
  const index = await text("index.html");
  assert.match(html, /api\("\/api\/auth"\)/);
  assert.match(html, /api\("\/api\/activity-profile"\)/);
  assert.match(html, /x-maviri-tenant/);
  assert.match(html, /const auth=await verify\(\)/);
  assert.match(html, /if\(!auth\|\|auth\.authenticated!==true\)/);
  assert.match(html, /location\.replace\("\/login\?switch=1&reason=session-required"\)/);
  assert.doesNotMatch(html, /if\(!auth\|\|auth\.authenticated!==true\)\{clearLocalAuth\(\);location\.replace\("\/"\)/);
  assert.match(html, /syncAccountFromAuth\(auth\)/);
  assert.match(html, /if\(!j\.configured\)\{location\.replace\("\/setup"\)/);
  assert.match(html, /adaptiveDashboardPlan\(profile\)/);
  assert.match(html, /frame\.src="\/index\.html"/);
  assert.match(html, /ownerSyncToken/);
  assert.match(index, /window\.top===window\.self/);
  assert.match(index, /location\.replace\("\/app"\)/);
  assert.match(index, /credentials:"same-origin"/);
  assert.match(index, /reason=session-expired/);
});

test("la gestione account è raggiungibile dalla dashboard", async () => {
  const html = await text("app.html");
  assert.match(html, /href="\/account"/);
  assert.match(html, />Account<\/a>/);
  const accountHtml = await text("account.html");
  assert.match(accountHtml, /Cambia password/);
  assert.match(accountHtml, /fetch\("\/api\/account"/);
  assert.match(accountHtml, /currentPassword/);
  assert.match(accountHtml, /newPassword/);
});

test("la pagina account modifica il nome titolare senza confonderlo con il nome attività", async () => {
  const html = await text("account.html");
  assert.match(html, /Nome del titolare/);
  assert.match(html, /Non modifica il nome dell’attività/);
  assert.match(html, /id="profileForm"/);
  assert.match(html, /action:"update-profile"/);
  assert.match(html, /displayName/);
  assert.match(html, /rememberAccount\(j\.account\)/);
});

test("la pagina account cambia email solo con password e gestisce l'invio automatico della verifica", async () => {
  const html = await text("account.html");
  const api = await text("api/account.js");
  assert.match(html, /Cambia email di accesso/);
  assert.match(html, /id="emailForm"/);
  assert.match(html, /id="emailPassword"/);
  assert.match(html, /action:"change-email"/);
  assert.match(html, /newEmail,currentPassword/);
  assert.match(html, /j\.emailVerificationSent/);
  assert.match(html, /Ti abbiamo inviato il link di verifica/);
  assert.match(api, /emailVerificationConfigured/);
  assert.match(api, /requestEmailVerification/);
  assert.match(api, /needsEmailVerification: true/);
  assert.match(api, /emailVerificationSent/);
});

test("il browser non riusa la cache gestionale di un altro tenant", async () => {
  const html = await text("app.html");
  assert.match(html, /MAVIRI_LOCAL_DATA_TENANT/);
  assert.match(html, /function guardTenantCache/);
  assert.match(html, /previous!==current/);
  assert.match(html, /LEGACY_DATA_KEYS\.forEach\(key=>localStorage\.removeItem\(key\)\)/);
  assert.match(html, /guardTenantCache\(\)/);
});

test("il bridge autenticato forza tenant e profilo su Mavi", async () => {
  const html = await text("app.html");
  assert.match(html, /function installApiBridge/);
  assert.match(html, /headers\.set\("x-maviri-tenant",t\)/);
  assert.match(html, /payload\.tenantId=t/);
  assert.match(html, /payload\.activityProfile=profile/);
  assert.match(html, /credentials:init\.credentials\|\|"same-origin"/);
});

test("il pull server applica anche eliminazioni complete di servizi e promozioni", async () => {
  const html = await text("index.html");
  assert.match(html, /if\(hasServices\)data\.services=remote\.services\.map/);
  assert.match(html, /if\(hasPromotions\)data\.promotions=remote\.promotions\.map/);
  assert.doesNotMatch(html, /if\(hasServices\)\{\s*data\.services=mergeRemoteList/);
});

test("la dashboard include centro operativo, promemoria manuali e no-show persistenti", async () => {
  const html = await text("index.html");
  assert.match(html, /id="operations"/);
  assert.match(html, /function renderOperations\(\)/);
  assert.match(html, /function openReminder\(id\)/);
  assert.match(html, /reminderSentAt/);
  assert.match(html, /reminderChannel="whatsapp-manual"/);
  assert.match(html, /function markNoShow\(id\)/);
  assert.match(html, /a\.status="no_show"/);
  assert.match(html, /Assenze: \$\{noShows\.length\}/);
});

test("la scheda cliente calcola affidabilità e tasso di presenza", async () => {
  const html = await text("index.html");
  assert.match(html, /function clientReliability\(id\)/);
  assert.match(html, /Math\.round\(completed\/total\*100\)/);
  assert.match(html, /% presenza/);
  assert.match(html, /Affidabilità da calcolare/);
});

test("la dashboard propone il recupero dei clienti inattivi senza ricontattarli due volte", async () => {
  const html = await text("index.html");
  const chat = await text("api/chat.js");
  assert.match(html, /id="recoveries"/);
  assert.match(html, /function recoveryClients\(\)/);
  assert.match(html, /60\*86400000/);
  assert.match(html, /30\*86400000/);
  assert.match(html, /function openRecovery\(id\)/);
  assert.match(html, /function markRecoveryContacted\(id\)/);
  assert.match(html, /recoveryContactedAt=new Date\(\)\.toISOString\(\)/);
  assert.match(chat, /recoveryContactedAt:/);
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


test("la home mostra redditività servizi e valore perso per no-show", async () => {
  const html = await text("index.html");
  assert.match(html, /id="servicePerformance"/);
  assert.match(html, /id="noShowLostValue"/);
  assert.match(html, /function servicePerformanceRows\(\)/);
  assert.match(html, /function renderPerformance\(\)/);
  assert.match(html, /renderHome\(\);renderPerformance\(\);renderOperations\(\)/);
});


test("l\'annullamento registra il motivo e lo mostra nello storico", async () => {
  const html = await text("index.html");
  assert.match(html, /Motivo dell\'annullamento/);
  assert.match(html, /api\("cancel",\{id,reason\}\)/);
  assert.match(html, /a\.cancellationReason=String\(reason/);
  assert.match(html, /Motivo: \$\{esc\(a\.cancellationReason\)\}/);
});

test("la home rende azionabili i richiami intelligenti", async () => {
  const html = await text("index.html");
  assert.match(html, /id="rebookingCandidates"/);
  assert.match(html, /function smartRebookingClients\(\)/);
  assert.match(html, /function openSmartRebooking\(id,serviceEncoded\)/);
  assert.match(html, /rebookingContactedAt/);
  assert.match(html, /renderOperations\(\);renderRebooking\(\);renderRecoveries\(\)/);
});

test("il richiamo e la scheda cliente aprono una prenotazione precompilata", async () => {
  const html = await text("index.html");
  assert.match(html, /function newAp\(clientId="",serviceEncoded="",source=""\)/);
  assert.match(html, /value="\$\{esc\(c\?\.name\|\|""\)\}"/);
  assert.match(html, /preferred&&norm\(s\.name\)===norm\(preferred\)/);
  assert.match(html, /newApForClient\('\$\{c\.id\}','\$\{encodeURIComponent\(service\)\}','smart-rebooking'\)/);
  assert.match(html, /function newApForClient\(id,serviceEncoded="",source=""\).*newAp\(id,serviceEncoded,source\)/);
});

test("misura il valore prodotto dai richiami intelligenti", async () => {
  const html = await text("index.html");
  assert.match(html, /id="sRebookingValue"/);
  assert.match(html, /data-booking-source="\$\{esc\(source\)\}"/);
  assert.match(html, /\["smart-rebooking","operational-recovery"\]\.includes\(source\)/);
  assert.match(html, /source:r\.appointment\.source\|\|source/);
  assert.match(html, /\["smart-rebooking","operational-recovery"\]\.includes\(a\.source\)/);
  assert.match(html, /completedMonth\(a\)&&recovered\(a\)/);
});

test("misura contatti e conversione dei richiami negli ultimi trenta giorni", async () => {
  const html = await text("index.html");
  assert.match(html, /id="sRecoveryContacts"/);
  assert.match(html, /id="sRecoveryConversion"/);
  assert.match(html, /Date\.parse\(c\.recoveryContactedAt\|\|c\.rebookingContactedAt\|\|""\)>=cutoff/);
  assert.match(html, /recovered\(a\)&&active\(a\)/);
  assert.match(html, /Math\.round\(recoveryBookings\/contacts\*100\)/);
});

test("segnala e gestisce gli appuntamenti a rischio no-show", async () => {
  const html = await text("index.html");
  assert.match(html, /id="sRiskCount"/);
  assert.match(html, /function appointmentRisk\(a\)/);
  assert.match(html, /Rischio no-show/);
  assert.match(html, /Puoi confermarci la tua presenza\?/);
  assert.match(html, /confirmationRequestedAt/);
  assert.match(html, /Number\(appointmentRisk\(b\)\.high\)-Number\(appointmentRisk\(a\)\.high\)/);
});
