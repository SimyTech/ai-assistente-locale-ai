import test from "node:test";
import assert from "node:assert/strict";
import { authenticateOwnerAccount, ownerAccounts, passwordHash, verifyPassword } from "../lib/accounts.js";

test("genera e verifica hash password PBKDF2", () => {
  const hash = passwordHash("Segreta!123", { salt: "00112233445566778899aabbccddeeff", iterations: 100000 });
  assert.match(hash, /^pbkdf2-sha256\$100000\$/);
  assert.equal(verifyPassword("Segreta!123", hash), true);
  assert.equal(verifyPassword("sbagliata", hash), false);
});

test("un account determina il proprio tenant", () => {
  const hash = passwordHash("Password!456", { salt: "ffeeddccbbaa99887766554433221100", iterations: 100000 });
  const env = {
    MAVIRI_OWNER_ACCOUNTS: JSON.stringify({
      anna: {
        tenantId: "Salone_Anna",
        username: "Anna",
        email: "anna@example.test",
        displayName: "Anna",
        passwordHash: hash
      }
    })
  };

  const account = authenticateOwnerAccount({ login: "ANNA@EXAMPLE.TEST", password: "Password!456" }, env);
  assert.equal(account.tenantId, "salone-anna");
  assert.equal(account.username, "anna");
  assert.equal(account.displayName, "Anna");
});

test("account disabilitati o configurazioni non valide non accedono", () => {
  const hash = passwordHash("Password!789", { salt: "1234567890abcdef1234567890abcdef", iterations: 100000 });
  const env = {
    MAVIRI_OWNER_ACCOUNTS: JSON.stringify({
      luca: { tenantId: "barber-luca", username: "luca", passwordHash: hash, disabled: true }
    })
  };

  assert.equal(authenticateOwnerAccount({ login: "luca", password: "Password!789" }, env), null);
  assert.deepEqual(ownerAccounts({ MAVIRI_OWNER_ACCOUNTS: "{" }), []);
});
