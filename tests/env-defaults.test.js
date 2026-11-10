import { test } from "node:test";
import assert from "node:assert/strict";
import { missingRenderDisk, resolveDatabaseUrl } from "../app/database-url.js";

// Skip reading .env, so only the variables set here count.
process.env.NODE_ENV = "production";
const { getSettings, LIVE_DEFAULTS } = await import("../app/bestseller/env.server.js");

const VARS = [
  "BESTSELLER_FLOW_TRIGGER_ENABLED",
  "BESTSELLER_APPLY_ENABLED",
  "BESTSELLER_APPLY_ALLOWED_SHOPS",
  "BESTSELLER_CRON_SHOPS",
  "BESTSELLER_ALLOW_TIMEZONE_MISMATCH",
  "BESTSELLER_DEV_WINDOW_INCLUDE_TODAY",
];

function withEnv(values, fn) {
  const saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
  for (const k of VARS) delete process.env[k];
  Object.assign(process.env, values);
  try {
    return fn();
  } finally {
    for (const k of VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test("Render with only the Shopify variables: live defaults apply", () => {
  const s = withEnv({}, getSettings);
  assert.equal(s.flowTriggerEnabled, true);
  assert.equal(s.applyEnabled, true);
  assert.deepEqual(s.applyAllowedShops, ["*"]);
  assert.deepEqual(s.cronShops, ["*"]);
  // Development-only switches stay off.
  assert.equal(s.allowTimeZoneMismatch, false);
  assert.equal(s.devWindowIncludeToday, false);
  // The defaults object cannot be changed by a caller.
  s.cronShops.push("x.myshopify.com");
  assert.deepEqual(LIVE_DEFAULTS.cronShops, ["*"]);
});

test("a variable that is set always wins, even when empty", () => {
  const s = withEnv(
    {
      BESTSELLER_FLOW_TRIGGER_ENABLED: "false",
      BESTSELLER_APPLY_ENABLED: "",
      BESTSELLER_APPLY_ALLOWED_SHOPS: "",
      BESTSELLER_CRON_SHOPS: "A.myshopify.com, b.myshopify.com",
    },
    getSettings,
  );
  assert.equal(s.flowTriggerEnabled, false);
  assert.equal(s.applyEnabled, false);
  assert.deepEqual(s.applyAllowedShops, []);
  assert.deepEqual(s.cronShops, ["a.myshopify.com", "b.myshopify.com"]);
});

test("database: DATABASE_URL wins, else the Render disk, else prisma/dev.sqlite", () => {
  const disk = (path) => path === "/var/data";
  const none = () => false;
  assert.equal(resolveDatabaseUrl({ DATABASE_URL: "file:/tmp/x.sqlite" }, disk), "file:/tmp/x.sqlite");
  assert.equal(resolveDatabaseUrl({}, disk), "file:/var/data/prod.sqlite");
  assert.equal(resolveDatabaseUrl({ DATABASE_URL: "  " }, disk), "file:/var/data/prod.sqlite");
  assert.equal(resolveDatabaseUrl({}, none), "file:dev.sqlite");
});

test("database: warns on Render only when the disk is missing", () => {
  assert.equal(missingRenderDisk({ RENDER: "true" }, "file:dev.sqlite"), true);
  assert.equal(missingRenderDisk({ RENDER: "true" }, "file:/var/data/prod.sqlite"), false);
  assert.equal(missingRenderDisk({}, "file:dev.sqlite"), false);
});
