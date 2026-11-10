// Applies the database migrations (`prisma migrate deploy`) before the app
// starts (`npm run setup`). DATABASE_URL is optional: the same default as the
// app is used (Render disk /var/data/prod.sqlite, else prisma/dev.sqlite).
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { ensureDatabaseUrl, missingRenderDisk } from "../app/database-url.js";

const url = ensureDatabaseUrl();
console.log(`[setup] Database: ${url.startsWith("file:") ? url : "(DATABASE_URL)"}`);
if (missingRenderDisk(process.env, url)) {
  console.warn("[setup] No persistent disk at /var/data: the database is lost on every deploy.");
}

const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
const result = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], { stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
