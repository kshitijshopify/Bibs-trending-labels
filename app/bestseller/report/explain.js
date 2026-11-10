// Plain-language explanations for the dashboard and the preview email.
// Pure functions over the stored run result (no server or browser APIs).

export const ACTIONS = {
  add: { label: "Add tag", tone: "success" },
  remove: { label: "Remove tag", tone: "critical" },
  keep: { label: "Keep tag", tone: "info" },
  cleanup: { label: "Remove tag (Bulk)", tone: "critical" },
  review: { label: "Check manually", tone: "warning" },
};

const units = (n) => `${n} unit${n === 1 ? "" : "s"}`;

/** Why a product is in the category's selection. */
export function selectionReason(product, category) {
  const season = category.launch.chosenSeason;
  if (product.pickedAs === "launch-reserved") {
    const sales = product.netUnits ? `${units(product.netUnits)} sold` : "no sales yet";
    return `Newest launch ${season}: reserved place (${sales})`;
  }
  const launchNote = product.isLaunch ? ` (also from launch ${season})` : "";
  return `Top seller: #${product.overallRank} in ${category.name} with ${units(product.netUnits)}${launchNote}`;
}

/** Why a labeled product would lose the tag. */
export function removalReason(product, category) {
  if (product.bulkReasons?.length) {
    return `Bulk product (${product.bulkReasons.join(", ")}): Bulk products must not carry the tag`;
  }
  if (product.status && product.status !== "ACTIVE") {
    return `Product is ${product.status.toLowerCase()}: only active products can carry the tag`;
  }
  const rank = product.overallRank ? `rank #${product.overallRank}, ` : "";
  return `No longer in the top ${category.total} (${rank}${units(product.netUnits ?? 0)})`;
}

/**
 * One flat list of every proposed tag action, for the "what to do" table.
 * Each row: { action, category, product, why }
 */
export function actionList(result) {
  const rows = [];
  for (const category of result.categories) {
    for (const p of category.wouldAdd) {
      rows.push({ action: "add", category: category.name, product: p, why: `${selectionReason(p, category)}; not tagged yet` });
    }
    for (const p of category.wouldRemove) {
      rows.push({ action: "remove", category: category.name, product: p, why: removalReason(p, category) });
    }
    for (const p of category.wouldKeep) {
      rows.push({ action: "keep", category: category.name, product: p, why: `${selectionReason(p, category)}; already tagged` });
    }
  }
  for (const p of result.cleanup) {
    rows.push({
      action: "cleanup",
      category: "Outside the 3 categories",
      product: p,
      why: `Bulk product (${p.bulkReasons.join(", ")}) outside the category mappings: tag would be removed`,
    });
  }
  for (const p of result.review) {
    rows.push({
      action: "review",
      category: "Outside the 3 categories",
      product: p,
      why: `Tagged, but product type "${p.productType || "(blank)"}" is not in any category; not changed automatically`,
    });
  }
  return rows;
}

export function actionCounts(result) {
  const counts = { add: 0, remove: 0, keep: 0, cleanup: result.cleanup.length, review: result.review.length };
  for (const c of result.categories) {
    counts.add += c.wouldAdd.length;
    counts.remove += c.wouldRemove.length;
    counts.keep += c.wouldKeep.length;
  }
  return counts;
}

/** One sentence per season step, newest first. */
export function seasonStory(category) {
  const lines = category.launch.ladder.map((step) => {
    const source = step.source === "plain" ? "plain season tags" : "label: fallback tags";
    if (step.decision === "chosen") {
      return `${step.season} chosen: the newest season with active, non-Bulk ${category.name.toLowerCase()} (${step.eligibleMembers} product(s), from ${source}).`;
    }
    if (step.categoryMembers === 0) return `${step.season} skipped: no ${category.name.toLowerCase()} carry this season.`;
    return `${step.season} skipped: all ${step.categoryMembers} ${category.name.toLowerCase()} in this season are inactive or Bulk.`;
  });
  if (!category.launch.chosenSeason) {
    lines.push("No season qualifies, so every place is filled from the sales ranking.");
  }
  return lines;
}

/** Short, human summary of how the category's places were filled. */
export function selectionSummary(category) {
  const { launch } = category;
  const parts = [];
  if (launch.chosenSeason) {
    parts.push(
      `${launch.reservedFilled} of ${launch.reservedTarget} reserved place(s) go to the newest launch ${launch.chosenSeason}`,
    );
    if (launch.launchReservedShortfall > 0) {
      parts.push(`the launch has only ${launch.reservedFilled} eligible product(s), so ${launch.launchReservedShortfall} more place(s) come from the sales ranking`);
    }
  }
  const fromRanking = category.selected.filter((p) => p.pickedAs === "sales-ranking").length;
  parts.push(`${fromRanking} place(s) are filled by the best sellers`);
  if (launch.launchSelectedTotal > launch.reservedFilled) {
    parts.push(`${launch.launchSelectedTotal - launch.reservedFilled} more launch product(s) earned a place through sales`);
  }
  if (category.shortfall > 0) {
    parts.push(`only ${category.selected.length} eligible products exist, so ${category.shortfall} place(s) stay empty`);
  }
  return `${parts.join("; ")}.`;
}

/**
 * Text of the email for one category, exactly as the Flow workflow will send
 * it. mode "preview": asks for approval (with the approval link). mode
 * "applied": confirms what was changed in the store. Shown in the app only.
 */
export function previewEmail(result, category, { mode = "preview", approvalUrl = null } = {}) {
  const tag = result.config.bestsellerTag;
  const applied = mode === "applied";
  const season = category.launch.chosenSeason
    ? `${category.launch.chosenSeason} (${category.launch.source === "plain" ? "plain season tags" : "label: fallback tags"})`
    : "none qualifies (sales ranking only)";
  const lines = [];
  const list = (title, products, why) => {
    lines.push("", `${title} (${products.length})`);
    if (!products.length) lines.push("  none");
    for (const p of products) lines.push(`  - ${p.title} [${p.legacyId}] ${why(p)}`);
  };

  lines.push(
    applied ? "Status: applied in the store" : "Status: waiting for your approval",
    `Category: ${category.name}`,
    `Tag: ${tag}`,
    `Sales window: ${result.window.label}`,
    `Newest eligible launch: ${season}`,
    `Selected: ${category.selected.length} of ${category.total}${category.shortfall ? ` (shortfall ${category.shortfall})` : ""}`,
    "",
    "Selected products:",
  );
  for (const p of category.selected) {
    lines.push(`  ${p.position}. ${p.title} [${p.legacyId}]: ${units(p.netUnits)}, ${p.pickedAs === "launch-reserved" ? "launch (reserved)" : `rank #${p.overallRank}`}`);
  }
  list(applied ? "Tag added" : "Would add the tag", category.wouldAdd, (p) => `(${units(p.netUnits)})`);
  list(applied ? "Tag removed" : "Would remove the tag", category.wouldRemove, (p) => `(${removalReason(p, category)})`);
  list(applied ? "Tag kept" : "Would keep the tag", category.wouldKeep, (p) => `(${units(p.netUnits)})`);
  lines.push("", ...closingLines(applied, approvalUrl));

  return {
    subject: `${tag} ${applied ? "updated" : "preview"} – ${category.name} – ${category.launch.chosenSeason ?? "no launch"} – ${result.window.startDate} to ${result.window.endDate}`,
    body: lines.join("\n"),
  };
}

function closingLines(applied, approvalUrl) {
  if (applied) {
    return [
      "These changes were made in the store. All other tags were left unchanged.",
      ...(approvalUrl ? [`Spotted a mistake? Review or undo this update (valid for 48 hours): ${approvalUrl}`] : []),
      "The latest update can also be undone in the app under Overview.",
    ];
  }
  return [
    "Preview only: no product has been changed.",
    `Approve or reject this list (valid for 48 hours): ${approvalUrl ?? "(approval link appears here)"}`,
    "You can also approve it in the app under Overview.",
  ];
}

export function cleanupEmail(result, { mode = "preview", approvalUrl = null } = {}) {
  const applied = mode === "applied";
  const lines = [
    applied ? "Status: applied in the store" : "Status: waiting for your approval",
    `Tag: ${result.config.bestsellerTag}`,
    `Sales window: ${result.window.label}`,
    "",
  ];
  lines.push(`Bulk products outside the categories, tag ${applied ? "removed" : "would be removed"} (${result.cleanup.length}):`);
  if (!result.cleanup.length) lines.push("  none");
  for (const p of result.cleanup) lines.push(`  - ${p.title} [${p.legacyId}] (${p.bulkReasons.join(", ")})`);
  lines.push("", `Tagged products outside the categories, please review (${result.review.length}):`);
  if (!result.review.length) lines.push("  none");
  for (const p of result.review) lines.push(`  - ${p.title} [${p.legacyId}] type "${p.productType || "(blank)"}"`);
  lines.push("", ...closingLines(applied, approvalUrl));
  return {
    subject: `${result.config.bestsellerTag} ${applied ? "updated" : "preview"} – cleanup and review – ${result.window.startDate} to ${result.window.endDate}`,
    body: lines.join("\n"),
  };
}

/**
 * Text of the ONE combined email (trigger "Bestseller daily summary ready"):
 * every category, cleanup and review in a single message.
 */
export function combinedEmail(result, { mode = "preview", approvalUrl = null } = {}) {
  const tag = result.config.bestsellerTag;
  const applied = mode === "applied";
  const add = result.categories.reduce((n, c) => n + c.wouldAdd.length, 0);
  const remove = result.categories.reduce((n, c) => n + c.wouldRemove.length, 0) + result.cleanup.length;
  const keep = result.categories.reduce((n, c) => n + c.wouldKeep.length, 0);
  const upToDate = add + remove === 0;
  const lines = [
    applied ? "Status: applied in the store" : upToDate ? "Status: up to date, nothing to change" : "Status: waiting for your approval",
    `Tag: ${tag}`,
    `Sales window: ${result.window.label}`,
    upToDate ? `No changes: all ${keep} selected product(s) already have ${tag}.` : `${add} product(s) ${applied ? "got" : "get"} ${tag}, ${remove} ${applied ? "lost" : "lose"} it, ${keep} keep it.`,
  ];
  for (const c of result.categories) {
    const season = c.launch.chosenSeason ? `newest launch ${c.launch.chosenSeason} (${c.launch.source})` : "no launch";
    lines.push("", `== ${c.name} · ${season} · ${c.selected.length} of ${c.total} selected${c.shortfall ? ` (shortfall ${c.shortfall})` : ""} ==`);
    for (const p of c.selected) {
      lines.push(`  ${p.position}. ${p.title}: ${units(p.netUnits)}${p.pickedAs === "launch-reserved" ? " (launch, reserved)" : ""}${p.labeled ? "" : applied ? " · tag added" : " · NEW"}`);
    }
    if (c.wouldRemove.length) {
      lines.push(`  ${applied ? "Tag removed" : "Loses the tag"}:`);
      for (const p of c.wouldRemove) lines.push(`  - ${p.title} (${removalReason(p, c)})`);
    }
    if (!c.wouldAdd.length && !c.wouldRemove.length) lines.push("  No changes in this category.");
  }
  lines.push("", `== Outside the categories ==`);
  lines.push(`  Bulk products, tag ${applied ? "removed" : "would be removed"}: ${result.cleanup.map((p) => p.title).join(", ") || "none"}`);
  lines.push(`  Please review (tag stays): ${result.review.map((p) => p.title).join(", ") || "none"}`);
  lines.push("", ...closingLines(applied, upToDate && !applied ? null : approvalUrl).filter((l) => !(upToDate && !applied && l.startsWith("Approve"))));
  return {
    subject: `${tag} ${applied ? "updated" : "daily preview"} – ${upToDate && !applied ? "no changes" : `${add} add, ${remove} remove`} – ${result.window.startDate} to ${result.window.endDate}`,
    body: lines.join("\n"),
  };
}
