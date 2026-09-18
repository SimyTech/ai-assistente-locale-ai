import test from "node:test";
import assert from "node:assert/strict";

import { maviQrTarget, publicMaviOrigin } from "../api/mavi-qr.js";

test("uses the canonical Maviri origin by default", () => {
  assert.equal(publicMaviOrigin({}), "https://www.maviri.it");
});

test("builds the tenant-specific short URL encoded in the QR", () => {
  assert.equal(
    maviQrTarget("simytech-574244", { MAVIRI_PUBLIC_ORIGIN: "https://www.maviri.it/" }),
    "https://www.maviri.it/s/simytech-574244"
  );
});
