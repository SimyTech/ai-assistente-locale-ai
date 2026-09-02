import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../app.html", import.meta.url), "utf8");

test("la dashboard richiede il Centro Operativo a Mavi", () => {
  assert.match(app, /message:\"Mostrami il centro operativo\"/);
  assert.match(app, /fetch\(\"\/api\/chat\"/);
  assert.match(app, /result\?\.operationalCenter/);
});

test("la dashboard mostra valore recuperabile e priorità", () => {
  assert.match(app, /recoverableValue/);
  assert.match(app, /agendaGaps/);
  assert.match(app, /inactiveClients/);
  assert.match(app, /cancellationRecoveries/);
  assert.match(app, /Priorità alta/);
});

test("il Centro Operativo si aggiorna periodicamente senza polling aggressivo", () => {
  assert.match(app, /setInterval\(refreshOperationalDashboard,60000\)/);
});

test("le opportunità operative diventano azioni controllate dal titolare", () => {
  assert.match(app, /data-operational-action/);
  assert.match(app, /Apri prenotazione/);
  assert.match(app, /Recupera cliente/);
  assert.match(app, /Ricontatta cliente/);
  assert.match(app, /win\.newAp\("",encodeURIComponent\(service\),"operational-gap"\)/);
  assert.match(app, /https:\/\/wa\.me\//);
});

test("il contatto WhatsApp prepara il messaggio senza inviarlo automaticamente", () => {
  assert.match(app, /encodeURIComponent\(whatsappDraft\(item,client\)\)/);
  assert.doesNotMatch(app, /action:"send-operational-message"/);
});
