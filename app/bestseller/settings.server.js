import prisma from "../db.server";
import { EMAIL_FORMATS, SALES_WINDOW_DAYS, validateLabelTag, validateWindowDays } from "./config.js";
import { getRunConfig } from "./env.server.js";
import { ConfigurationError } from "./errors.js";

/**
 * Label tag per shop. Priority: dashboard setting > BESTSELLER_LABEL_TAG env
 * > label:BESTSELLER. Runs read it when they start.
 */
export async function getShopLabelSetting(shop) {
  const fallback = getRunConfig();
  const saved = await prisma.bestsellerSetting.findUnique({ where: { shop } });
  if (saved) {
    return {
      labelTag: saved.labelTag,
      approvalMode: saved.approvalMode ?? "automatic",
      emailFormat: saved.emailFormat ?? "separate",
      salesWindowDays: saved.salesWindowDays ?? SALES_WINDOW_DAYS,
      storeUpdates: saved.storeUpdates === true,
      source: "dashboard",
      updatedAt: saved.updatedAt,
      updatedBy: saved.updatedBy,
    };
  }
  return {
    labelTag: fallback.bestsellerTag,
    approvalMode: "automatic",
    emailFormat: "separate",
    salesWindowDays: SALES_WINDOW_DAYS,
    storeUpdates: false,
    source: process.env.BESTSELLER_LABEL_TAG ? "environment" : "default",
    updatedAt: null,
    updatedBy: null,
  };
}

export const APPROVAL_MODES = {
  automatic: "Automatic: every night the store is updated and an email lists every change",
  manual: "Manual: every list needs an approval (in the app or with the email link) before the store is changed",
};

/** Saves the preview email format and records the change in the history. */
export async function saveShopEmailFormat(shop, format, updatedBy) {
  if (!EMAIL_FORMATS[format]) throw new ConfigurationError("INVALID_EMAIL_FORMAT", `Unknown email format “${format}”.`);
  const current = await getShopLabelSetting(shop);
  if (current.emailFormat === format) return { changed: false, emailFormat: format };
  await prisma.$transaction([
    prisma.bestsellerSetting.upsert({
      where: { shop },
      create: { shop, labelTag: current.labelTag, approvalMode: current.approvalMode, emailFormat: format, updatedBy },
      update: { emailFormat: format, updatedBy },
    }),
    prisma.bestsellerEvent.create({
      data: {
        shop,
        kind: "setting",
        tag: current.labelTag,
        detail: `Preview email format changed from ${current.emailFormat} to ${format}${updatedBy ? ` by ${updatedBy}` : ""}.`,
      },
    }),
  ]);
  return { changed: true, emailFormat: format };
}

export async function getShopApprovalMode(shop) {
  return (await getShopLabelSetting(shop)).approvalMode;
}

/**
 * The in-app "Store updates" switch. OFF by default: the app then only
 * calculates, reports and emails, and never changes a product. Recorded in
 * the history every time it is switched.
 */
export async function saveShopStoreUpdates(shop, enabled, updatedBy) {
  const on = enabled === true;
  const current = await getShopLabelSetting(shop);
  if (current.storeUpdates === on) return { changed: false, storeUpdates: on };
  await prisma.$transaction([
    prisma.bestsellerSetting.upsert({
      where: { shop },
      create: {
        shop,
        labelTag: current.labelTag,
        approvalMode: current.approvalMode,
        emailFormat: current.emailFormat,
        salesWindowDays: current.salesWindowDays,
        storeUpdates: on,
        updatedBy,
      },
      update: { storeUpdates: on, updatedBy },
    }),
    prisma.bestsellerEvent.create({
      data: {
        shop,
        kind: "setting",
        tag: current.labelTag,
        detail: on
          ? `Store updates switched ON${updatedBy ? ` by ${updatedBy}` : ""}: the app may now add and remove ${current.labelTag}.`
          : `Store updates switched OFF${updatedBy ? ` by ${updatedBy}` : ""}: the app no longer changes products.`,
      },
    }),
  ]);
  return { changed: true, storeUpdates: on };
}

/** Saves the approval mode and records the change in the history. */
export async function saveShopApprovalMode(shop, mode, updatedBy) {
  if (!APPROVAL_MODES[mode]) throw new ConfigurationError("INVALID_APPROVAL_MODE", `Unknown approval mode “${mode}”.`);
  const current = await getShopLabelSetting(shop);
  if (current.approvalMode === mode) return { changed: false, approvalMode: mode };
  await prisma.$transaction([
    prisma.bestsellerSetting.upsert({
      where: { shop },
      create: { shop, labelTag: current.labelTag, approvalMode: mode, updatedBy },
      update: { approvalMode: mode, updatedBy },
    }),
    prisma.bestsellerEvent.create({
      data: {
        shop,
        kind: "setting",
        tag: current.labelTag,
        detail: `Approval mode changed from ${current.approvalMode} to ${mode}${updatedBy ? ` by ${updatedBy}` : ""}.`,
      },
    }),
  ]);
  return { changed: true, approvalMode: mode };
}

export async function getShopRunConfig(shop) {
  const base = getRunConfig();
  const { labelTag, salesWindowDays } = await getShopLabelSetting(shop);
  return { ...base, bestsellerTag: labelTag, salesWindowDays };
}

/** Saves the length of the sales period and records the change in the history. */
export async function saveShopSalesWindow(shop, value, updatedBy) {
  const check = validateWindowDays(value);
  if (!check.ok) throw new ConfigurationError("INVALID_SALES_WINDOW", `The sales period ${check.problem}.`);
  const current = await getShopLabelSetting(shop);
  if (current.salesWindowDays === check.days) return { changed: false, salesWindowDays: check.days };
  await prisma.$transaction([
    prisma.bestsellerSetting.upsert({
      where: { shop },
      create: {
        shop,
        labelTag: current.labelTag,
        approvalMode: current.approvalMode,
        emailFormat: current.emailFormat,
        salesWindowDays: check.days,
        updatedBy,
      },
      update: { salesWindowDays: check.days, updatedBy },
    }),
    prisma.bestsellerEvent.create({
      data: {
        shop,
        kind: "setting",
        tag: current.labelTag,
        detail: `Sales period changed from ${current.salesWindowDays} to ${check.days} days${updatedBy ? ` by ${updatedBy}` : ""}. Applies from the next update.`,
      },
    }),
  ]);
  return { changed: true, salesWindowDays: check.days };
}

/** Saves the tag and records the change in the history. */
export async function saveShopLabelTag(shop, tag, updatedBy) {
  const check = validateLabelTag(tag);
  if (!check.ok) {
    throw new ConfigurationError("INVALID_LABEL_TAG", `“${tag}” can't be used: it ${check.problems.join(", ")}.`);
  }
  const previous = await getShopLabelSetting(shop);
  if (previous.labelTag === check.value) return { changed: false, labelTag: check.value };

  await prisma.$transaction([
    prisma.bestsellerSetting.upsert({
      where: { shop },
      create: { shop, labelTag: check.value, updatedBy },
      update: { labelTag: check.value, updatedBy },
    }),
    prisma.bestsellerEvent.create({
      data: {
        shop,
        kind: "setting",
        tag: check.value,
        detail: `Tag changed from ${previous.labelTag} to ${check.value}${updatedBy ? ` by ${updatedBy}` : ""}. Applies from the next run.`,
      },
    }),
  ]);
  return { changed: true, labelTag: check.value, previous: previous.labelTag };
}
