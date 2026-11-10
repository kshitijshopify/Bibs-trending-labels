// Small presentational helpers for the report pages (Polaris web components).
import { ACTIONS } from "../report/explain.js";
import { Disclosure } from "./kit.jsx";

export function ActionBadge({ action }) {
  const meta = ACTIONS[action];
  return <s-badge tone={meta.tone}>{meta.label}</s-badge>;
}

export function ProductName({ product }) {
  return (
    <s-stack gap="none">
      <s-text>{product.title}</s-text>
      <s-text color="subdued">
        {[`ID ${product.legacyId}`, product.productType, product.status && product.status !== "ACTIVE" ? product.status.toLowerCase() : null]
          .filter(Boolean)
          .join(" · ")}
      </s-text>
    </s-stack>
  );
}

/** Product title linking to the product in Shopify admin, with its type underneath. */
export function ProductLink({ product, showType = true }) {
  const meta = [showType ? product.productType : null, product.status && product.status !== "ACTIVE" ? product.status.toLowerCase() : null].filter(Boolean);
  return (
    <s-stack gap="none">
      <s-link href={`shopify:admin/products/${product.legacyId}`} target="_blank">
        {product.title}
      </s-link>
      {meta.length ? <s-text color="subdued">{meta.join(" · ")}</s-text> : null}
    </s-stack>
  );
}

/** Card used inside grids (technical report). */
export function Card({ heading, badge, children }) {
  return (
    <s-box padding="base" background="base" border="base" borderRadius="base">
      <s-stack gap="small">
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-heading>{heading}</s-heading>
          {badge}
        </s-stack>
        {children}
      </s-stack>
    </s-box>
  );
}

export function CardGrid({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>{children}</div>;
}

const RUN_STATUS = {
  SUCCEEDED: { tone: "success", label: "Completed" },
  FAILED: { tone: "critical", label: "Failed" },
  RUNNING: { tone: "info", label: "Running" },
};

export function StatusBadge({ status }) {
  const meta = RUN_STATUS[status] ?? { tone: "neutral", label: status };
  return <s-badge tone={meta.tone}>{meta.label}</s-badge>;
}

export function DataTable({ headers, rows, empty = "None" }) {
  if (!rows.length) return <s-paragraph>{empty}</s-paragraph>;
  return (
    <s-table>
      <s-table-header-row>
        {headers.map((header) => (
          <s-table-header key={header}>{header}</s-table-header>
        ))}
      </s-table-header-row>
      <s-table-body>
        {rows.map((row, index) => (
          <s-table-row key={index}>
            {row.map((cell, cellIndex) => (
              <s-table-cell key={cellIndex}>{cell}</s-table-cell>
            ))}
          </s-table-row>
        ))}
      </s-table-body>
    </s-table>
  );
}

export function ProductTable({ products, columns = ["title", "type", "status", "units"], empty }) {
  const headerFor = {
    position: "#",
    title: "Product",
    type: "Type",
    status: "Status",
    units: "Net units",
    rank: "Rank",
    pickedAs: "Picked as",
    launch: "Launch",
    labeled: "Labeled now",
    reasons: "Reason",
  };
  const cellFor = (p, column) => {
    switch (column) {
      case "position":
        return p.position;
      case "title":
        return (
          <span>
            {p.title}
            <br />
            <small>ID {p.legacyId}</small>
          </span>
        );
      case "type":
        return p.productType || "(blank)";
      case "status":
        return p.status;
      case "units":
        return p.netUnits;
      case "rank":
        return p.overallRank ?? "-";
      case "pickedAs":
        return p.pickedAs === "launch-reserved" ? "Launch (reserved)" : p.pickedAs === "sales-ranking" ? "Sales ranking" : "-";
      case "launch":
        return p.isLaunch ? "Yes" : "No";
      case "labeled":
        return p.labeled ? `Yes (${p.bestsellerTags.join(", ")})` : "No";
      case "reasons":
        return (p.removeReasons ?? (p.reviewReason ? [p.reviewReason] : [])).join("; ");
      default:
        return "";
    }
  };
  return (
    <DataTable
      headers={columns.map((c) => headerFor[c])}
      rows={products.map((p) => columns.map((c) => cellFor(p, c)))}
      empty={empty}
    />
  );
}

export function KeyValues({ items }) {
  return (
    <DataTable
      headers={["Item", "Value"]}
      rows={items.filter(Boolean).map(([key, value]) => [key, typeof value === "object" ? JSON.stringify(value) : String(value)])}
    />
  );
}

export function Collapsible({ title, children }) {
  return <Disclosure title={title}>{children}</Disclosure>;
}

export function downloadText(filename, text, mime = "application/json") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** CSV of every selection and proposed change, one row per product and list. */
export function resultToCsv(result) {
  const rows = [["category", "list", "position", "product_id", "title", "product_type", "status", "net_units", "rank", "picked_as", "launch", "labeled", "reasons"]];
  const push = (category, list, p) =>
    rows.push([
      category,
      list,
      p.position ?? "",
      p.legacyId,
      p.title,
      p.productType,
      p.status,
      p.netUnits,
      p.overallRank ?? "",
      p.pickedAs ?? "",
      p.isLaunch ? "yes" : "no",
      p.labeled ? "yes" : "no",
      (p.removeReasons ?? (p.reviewReason ? [p.reviewReason] : [])).join("; "),
    ]);
  for (const c of result.categories) {
    c.selected.forEach((p) => push(c.name, "selected", p));
    c.wouldAdd.forEach((p) => push(c.name, "would_add", p));
    c.wouldRemove.forEach((p) => push(c.name, "would_remove", p));
    c.wouldKeep.forEach((p) => push(c.name, "would_keep", p));
  }
  result.cleanup.forEach((p) => push("Outside mappings", "cleanup_remove", p));
  result.review.forEach((p) => push("Outside mappings", "review", p));
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
