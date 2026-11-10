import { APPROVAL_MAX_AGE_HOURS } from "./state.js";
import { signApprovalToken } from "./token.js";

export function approvalSecret() {
  return process.env.BESTSELLER_APPROVAL_SECRET || process.env.SHOPIFY_API_SECRET || "";
}

/** Public link to the approve/reject page for a run (valid 48 hours after the run). */
export function approvalUrlFor({ id, shop, resultHash, finishedAt }) {
  const appUrl = String(process.env.SHOPIFY_APP_URL ?? "").replace(/\/$/, "");
  const secret = approvalSecret();
  if (!appUrl || !secret || !resultHash || !shop) return null;
  const base = finishedAt ? new Date(finishedAt) : new Date();
  const expiresAt = new Date(base.getTime() + APPROVAL_MAX_AGE_HOURS * 3600 * 1000);
  return `${appUrl}/approve/${signApprovalToken({ runId: id, shop, resultHash, expiresAt }, secret)}`;
}
