import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import healthHandler from "../api/health.js";

function response() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

test("resta entro il limite di 12 funzioni serverless del piano Vercel Hobby", async () => {
  const files = await readdir(new URL("../api/", import.meta.url));
  const functions = files.filter(name => name.endsWith(".js"));
  assert.ok(functions.length <= 12, `Funzioni serverless: ${functions.length} (${functions.join(", ")})`);
  assert.equal(functions.includes("readiness.js"), false);
  assert.equal(functions.includes("reminders.js"), false);
});

test("readiness e reminders restano raggiungibili tramite rewrite verso health", async () => {
  const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.ok(vercel.rewrites.some(item => item.source === "/api/readiness" && item.destination === "/api/health?mode=readiness"));
  assert.ok(vercel.rewrites.some(item => item.source === "/api/reminders" && item.destination === "/api/health?mode=reminders"));
});

test("health serve la readiness completa nello stesso processo", () => {
  const old = { ...process.env };
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "token";
  process.env.MAVIRI_SESSION_SECRET = "session";
  delete process.env.CRON_SECRET;
  delete process.env.MAVIRI_REMINDER_SECRET;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.WHATSAPP_APP_SECRET;

  const res = response();
  healthHandler({ method: "GET", query: { mode: "readiness" } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.payload.coreReady, true);
  assert.ok(Array.isArray(res.payload.blockers));

  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, old);
});

test("health delega i promemoria e mantiene la protezione con secret", async () => {
  const old = { ...process.env };
  delete process.env.CRON_SECRET;
  delete process.env.MAVIRI_REMINDER_SECRET;
  const res = response();
  await healthHandler({ method: "POST", query: { mode: "reminders" }, headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.ok, false);

  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, old);
});
