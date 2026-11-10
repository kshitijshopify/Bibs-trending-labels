/* eslint-env node */
import { existsSync } from "node:fs";

/**
 * Where the SQLite database lives when DATABASE_URL is not set, so Render
 * needs no DATABASE_URL variable:
 * - a persistent disk mounted at /var/data (Render)  -> /var/data/prod.sqlite
 * - otherwise (local development)                     -> prisma/dev.sqlite
 *
 * Used by app/db.server.js (the app) and scripts/setup-db.mjs (migrations), so
 * both always use the same file. Plain Node, no Vite-only imports.
 */
export const RENDER_DISK_PATH = "/var/data";

export function resolveDatabaseUrl(env = process.env, exists = existsSync) {
  const configured = String(env.DATABASE_URL ?? "").trim();
  if (configured) return configured;
  // Relative SQLite paths are relative to prisma/schema.prisma.
  return exists(RENDER_DISK_PATH) ? `file:${RENDER_DISK_PATH}/prod.sqlite` : "file:dev.sqlite";
}

/** Reads .env (local development only), then fills in DATABASE_URL if missing. */
export function ensureDatabaseUrl(env = process.env, exists = existsSync) {
  if (env === process.env && env.NODE_ENV !== "production" && !env.DATABASE_URL && exists(".env")) {
    try {
      process.loadEnvFile(".env"); // existing variables are not overwritten
    } catch {
      // A malformed .env leaves the default below.
    }
  }
  env.DATABASE_URL = resolveDatabaseUrl(env, exists);
  return env.DATABASE_URL;
}

/** True when running on Render without the persistent disk (data would be lost on deploy). */
export function missingRenderDisk(env = process.env, url = env.DATABASE_URL) {
  return Boolean(env.RENDER) && String(url ?? "").startsWith("file:") && !String(url).startsWith(`file:${RENDER_DISK_PATH}/`);
}
