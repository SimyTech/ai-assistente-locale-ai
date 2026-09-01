import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/auth.js";

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

function call(method, body = {}, headers = {}) {
  const res = response();
  handler({ method, body, headers }, res);
  return res;
}

test("login imposta un cookie HttpOnly e la sessione autorizza le richieste successive", () => {
  process.env.MAVIRI_OWNER_SYNC_TOKEN = "owner-secret";
  process.env.MAVIRI_SESSION_SECRET = "independent-session-secret";
  try {
    const login = call("POST", { tenantId: "default", token: "owner-secret" });
    assert.equal(login.statusCode, 200);
    assert.match(login.headers["Set-Cookie"], /HttpOnly/);
    assert.match(login.headers["Set-Cookie"], /SameSite=Strict/);

    const cookie = login.headers["Set-Cookie"].split(";")[0];
    const status = call("GET", { tenantId: "default" }, { cookie });
    assert.equal(status.statusCode, 200);
    assert.equal(status.payload.authenticated, true);
  } finally {
    delete process.env.MAVIRI_OWNER_SYNC_TOKEN;
    delete process.env.MAVIRI_SESSION_SECRET;
  }
});

test("login rifiuta credenziali errate e logout cancella il cookie", () => {
  process.env.MAVIRI_OWNER_SYNC_TOKEN = "owner-secret";
  try {
    const denied = call("POST", { tenantId: "default", token: "wrong" });
    assert.equal(denied.statusCode, 401);
    const logout = call("DELETE", { tenantId: "default" });
    assert.equal(logout.statusCode, 200);
    assert.match(logout.headers["Set-Cookie"], /Max-Age=0/);
  } finally {
    delete process.env.MAVIRI_OWNER_SYNC_TOKEN;
  }
});
