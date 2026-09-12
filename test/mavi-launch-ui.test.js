import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const owner = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const client = fs.readFileSync(path.join(root, 'mavi.html'), 'utf8');
const vercel = fs.readFileSync(path.join(root, 'vercel.json'), 'utf8');

test('Mavi titolare impedisce invii duplicati e comunica gli errori con chiarezza', () => {
  assert.match(owner, /id="maviSendBtn"/);
  assert.match(owner, /aria-live="polite"/);
  assert.match(owner, /maviBusy\s*=\s*false/);
  assert.match(owner, /function setMaviBusy\(value\)/);
  assert.match(owner, /if\s*\([^)]*maviBusy[^)]*\)\s*return/);
  assert.match(owner, /nessuna azione è stata eseguita/);
});

test('Mavi Client Chat usa il logo ufficiale e gestisce rete e continuità', () => {
  assert.match(client, /\/assets\/mavi-logo-official\.webp/);
  assert.match(client, /width="384" height="384"/);
  assert.match(client, /id="connectionStatus"/);
  assert.match(client, /const HISTORY_KEY/);
  assert.match(client, /function saveHistory\(\)/);
  assert.match(client, /function restoreHistory\(\)/);
  assert.match(client, /new AbortController\(\)/);
  assert.match(client, /20000/);
  assert.match(client, /sessionStorage\.removeItem\(HISTORY_KEY\)/);
  assert.match(client, /let pendingBooking=null/);
  assert.match(client, /async function bookingReply\(q\)/);
  assert.match(client, /confirmed:true/);
  assert.match(client, /Scrivi Confermo oppure Annulla/);
  assert.match(client, /function advanceBooking\(booking,message/);
  assert.match(client, /pendingBooking\.status="collecting-time"/);
  assert.match(client, /const bookingPhone=/);
  assert.match(client, /const bookingName=/);
  assert.match(vercel, /mavi-logo-official\.webp/);
  assert.match(vercel, /max-age=31536000, immutable/);
});

test('la gestione clienti usa il telefono come identità e consente l’eliminazione sicura', () => {
  assert.match(owner, /function findClientIdentity\(name,phone\)/);
  assert.match(owner, /api\("delete-client",\{id\}\)/);
  assert.match(owner, /Elimina cliente/);
  assert.match(owner, /Elimina prima.*appuntament/);
});
