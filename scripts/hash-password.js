import { randomBytes } from "node:crypto";
import { passwordHash } from "../lib/accounts.js";

const password = process.argv[2];

if (!password) {
  console.error("Uso: npm run hash-password -- \"LaTuaPassword\"");
  process.exit(1);
}

const salt = randomBytes(16).toString("hex");
console.log(passwordHash(password, { salt }));
