import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildMaviEntryUrl,
  createMaviEntryToken,
  verifyMaviEntryToken
} from "../lib/mavi-entry-link.js";
import { composeAutomaticWhatsAppMessage } from "../lib/whatsapp-notify.js";
import { applyMaviEntryToken } from "../api/chat-entry.js";

const ORIGINAL_SECRET = process.env.MAVIRI_SESSION_SECRET;

function withSecret(fn) {
  process.env.MAVIRI_SESSION_SECRET = "test-maviri-session-secret-0123456789";
  try {
    return fn();
  } finally {
    if (ORIGINAL_SECRET === undefined) delete process.env.MAVIRI_SESSION_SECRET;
    else process.env.MAVIRI_SESSION_SECRET = ORIGINAL_SECRET;
  }
}

test("Mavi entry token preserves tenant, client and appointment context", () => {
  withSecret(() => {
    const token = createMaviEntryToken({
      tenantId: "salone-demo",
      clientId: "client-42",
      appointmentId: "appointment-99"
    });

    const verified = verifyMaviEntryToken(token);
    assert.equal(verified.ok, true);
    assert.equal(verified.tenantId, "salone-demo");
    assert.equal(verified.clientId, "client-42");
    assert.equal(verified.appointmentId, "appointment-99");
    assert.ok(verified.expiresAt > Date.now());
  });
});

test("Mavi entry token rejects tampering", () => {
  withSecret(() => {
    const token = createMaviEntryToken({ tenantId: "salone-demo" });
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    const verified = verifyMaviEntryToken(tampered);
    assert.equal(verified.ok, false);
  });
});

test("Mavi entry URL points to public Mavi route and contains only the signed token", () => {
  withSecret(() => {
    const url = buildMaviEntryUrl({
      origin: "https://maviri.example/",
      tenantId: "salone-demo",
      clientId: "client-42",
      appointmentId: "appointment-99"
    });

    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://maviri.example");
    assert.equal(parsed.pathname, "/mavi");
    assert.ok(parsed.searchParams.get("token"));
    assert.equal(parsed.searchParams.has("tenantId"), false);
    assert.equal(parsed.searchParams.has("clientId"), false);
    assert.equal(parsed.searchParams.has("appointmentId"), false);
  });
});

test("Mavi route serves the static client page and keeps the chat on the existing API", () => {
  const vercel = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const rewrite = vercel.rewrites.find(item => item.source === "/mavi");
  assert.equal(rewrite?.destination, "/client.html");

  const html = fs.readFileSync(new URL("../client.html", import.meta.url), "utf8");
  assert.match(html, /fetch\("\/api\/chat"/);
  assert.doesNotMatch(html, /\/api\/mavi-client/);
});

test("signed Mavi context cannot be overridden by browser payload", () => {
  withSecret(() => {
    const token = createMaviEntryToken({
      tenantId: "salone-demo",
      clientId: "client-42",
      appointmentId: "appointment-99"
    });

    const result = applyMaviEntryToken({
      token,
      action: "chat",
      tenantId: "altro-tenant",
      clientId: "client-attacker",
      appointmentId: "appointment-attacker"
    });

    assert.equal(result.ok, true);
    assert.equal(result.body.tenantId, "salone-demo");
    assert.equal(result.body.clientId, "client-42");
    assert.equal(result.body.appointmentId, "appointment-99");
    assert.equal(result.body.role, "client");
    assert.equal(result.body.source, "whatsapp-link");
    assert.equal("token" in result.body, false);
  });
});

test("automatic WhatsApp confirmation message contains Mavi link and appointment details", () => {
  const link = "https://maviri.example/mavi?token=signed-token";
  const message = composeAutomaticWhatsAppMessage({
    businessName: "Studio Demo",
    eventType: "confirmed",
    appointment: {
      service: "Taglio",
      date: "2026-09-10",
      time: "15:30"
    },
    link
  });

  assert.match(message, /Studio Demo/);
  assert.match(message, /confermato/i);
  assert.match(message, /Taglio/);
  assert.match(message, /2026-09-10/);
  assert.match(message, /15:30/);
  assert.match(message, new RegExp(link.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("automatic WhatsApp messages distinguish reschedule and cancellation", () => {
  const common = {
    businessName: "Studio Demo",
    appointment: { service: "Visita", date: "2026-09-11", time: "10:00" },
    link: "https://maviri.example/mavi?token=signed-token"
  };

  assert.match(
    composeAutomaticWhatsAppMessage({ ...common, eventType: "rescheduled" }),
    /spostato/i
  );
  assert.match(
    composeAutomaticWhatsAppMessage({ ...common, eventType: "cancelled" }),
    /cancellato/i
  );
});
