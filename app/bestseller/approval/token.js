import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed, expiring approval links for the preview emails.
 * token = base64url(payload) + "." + base64url(HMAC-SHA256(secret, payload))
 * payload = { r: runId, s: shop, h: first 16 chars of the selection hash, e: expiry (unix seconds) }
 *
 * The link only opens a confirmation page; the decision itself needs a click
 * (POST), so email scanners that open links cannot approve anything.
 */

const b64 = (buffer) => Buffer.from(buffer).toString("base64url");

function signature(secret, body) {
  return b64(createHmac("sha256", secret).update(body).digest());
}

export function signApprovalToken({ runId, shop, resultHash, expiresAt }, secret) {
  if (!secret || secret.length < 16) throw new Error("An approval secret of at least 16 characters is required.");
  const body = b64(
    JSON.stringify({ r: runId, s: shop, h: String(resultHash ?? "").slice(0, 16), e: Math.floor(expiresAt.getTime() / 1000) }),
  );
  return `${body}.${signature(secret, body)}`;
}

/** Returns { ok, runId, shop, hashPrefix, expiresAt } or { ok: false, reason }. */
export function verifyApprovalToken(token, secret, now = new Date()) {
  const [body, sig] = String(token ?? "").split(".");
  if (!body || !sig || !secret) return { ok: false, reason: "This link is not valid." };
  const expected = signature(secret, body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "This link is not valid." };
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "This link is not valid." };
  }
  const expiresAt = new Date(payload.e * 1000);
  if (now > expiresAt) return { ok: false, reason: "This link has expired. Please use the link from the newest preview email." };
  return { ok: true, runId: payload.r, shop: payload.s, hashPrefix: payload.h, expiresAt };
}
