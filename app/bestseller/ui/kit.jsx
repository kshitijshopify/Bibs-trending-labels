// Shared Polaris building blocks for every page.
//
// Polaris web components emit native DOM events that React 18 does not bind
// through JSX props (only clicks work), so inputs are wired up with refs.
// Boolean attributes are only spread when true: React 18 would otherwise
// write "false" as a (truthy) attribute value.
import { useEffect, useId, useMemo, useRef, useState } from "react";

export function useElementEvent(ref, eventName, handler) {
  const saved = useRef(handler);
  saved.current = handler;
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const listener = (event) => saved.current(event);
    element.addEventListener(eventName, listener);
    return () => element.removeEventListener(eventName, listener);
  }, [ref, eventName]);
}

const flag = (name, on) => (on ? { [name]: true } : {});

/** Info icon with a tooltip. Keep the text to one or two short sentences. */
export function InfoTip({ children, label = "More information" }) {
  const id = `tip-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <>
      <s-button variant="tertiary" icon="info" accessibilityLabel={label} interestFor={id} />
      <s-tooltip id={id}>{children}</s-tooltip>
    </>
  );
}

/** Card section with a heading, optional info tooltip and optional actions. */
export function Section({ heading, info, actions, children, padding }) {
  return (
    <s-section {...(padding ? { padding } : {})}>
      <s-stack gap="base">
        {heading ? (
          <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
            <s-stack direction="inline" gap="small-300" alignItems="center">
              <s-heading>{heading}</s-heading>
              {info ? <InfoTip>{info}</InfoTip> : null}
            </s-stack>
            {actions ?? null}
          </s-stack>
        ) : null}
        {children}
      </s-stack>
    </s-section>
  );
}

/**
 * Page body with even spacing between every block (cards, grids, banners).
 * Slotted page actions stay direct children of <s-page>.
 */
export function PageBody({ children }) {
  return <s-stack gap="base">{children}</s-stack>;
}

/**
 * Responsive card grid with a guaranteed gap. Plain CSS grid, so spacing
 * never depends on how <s-page> lays out non-section children.
 */
export function CardGrid({ children, min = 200, gap = 16 }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap, alignItems: "stretch" }}>
      {children}
    </div>
  );
}

/** Two columns on wide screens (main + side), one column on narrow screens. */
export function TwoColumn({ main, side, ratio = "2fr 1fr" }) {
  if (!main || !side) return <div style={{ display: "grid", gap: 16 }}>{main ?? side}</div>;
  return (
    <div className="bbl-two-col" style={{ display: "grid", gap: 16, alignItems: "start" }}>
      <style>{`.bbl-two-col{grid-template-columns:1fr}@media (min-width: 900px){.bbl-two-col{grid-template-columns:${ratio}}}`}</style>
      <div style={{ minWidth: 0, display: "grid", gap: 16 }}>{main}</div>
      <div style={{ minWidth: 0, display: "grid", gap: 16 }}>{side}</div>
    </div>
  );
}

/** Shopify-style metric card (a Polaris section card): label, value, caption, optional trend. */
export function MetricCard({ label, value, caption, info, badge, trend }) {
  return (
    <s-section>
      <s-stack gap="small-200">
        <s-stack direction="inline" gap="small-300" alignItems="center">
          <s-text color="subdued">{label}</s-text>
          {info ? <InfoTip>{info}</InfoTip> : null}
        </s-stack>
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-heading fontSize="large-200">{value}</s-heading>
          {badge ?? null}
        </s-stack>
        {caption ? <s-text color="subdued">{caption}</s-text> : null}
        {trend ?? null}
      </s-stack>
    </s-section>
  );
}

export function MetricGrid({ children }) {
  return <CardGrid min={190}>{children}</CardGrid>;
}

/**
 * Thin meter (e.g. places filled). The track is a lighter step of the same
 * blue ramp as the fill, so the state reads across the whole bar.
 */
export function Meter({ value, max, label }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label} style={{ height: 8, borderRadius: 4, background: "#cde2fb", overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", borderRadius: 4, background: "#2a78d6" }} />
    </div>
  );
}

/** Label / value rows, like a description list in a card. */
export function DetailList({ items }) {
  return (
    <s-stack gap="small">
      {items.filter(Boolean).map(([label, value]) => (
        <s-grid key={label} gridTemplateColumns="minmax(140px, 220px) 1fr" gap="base" alignItems="center">
          <s-text color="subdued">{label}</s-text>
          <s-text>{value}</s-text>
        </s-grid>
      ))}
    </s-stack>
  );
}

/** Polaris search field (debounced). */
export function SearchField({ label, placeholder, onChange, delay = 150 }) {
  const ref = useRef(null);
  const timer = useRef(null);
  useElementEvent(ref, "input", (event) => {
    const value = event.target.value ?? "";
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(value), delay);
  });
  useEffect(() => () => clearTimeout(timer.current), []);
  return <s-search-field ref={ref} label={label} labelAccessibilityVisibility="exclusive" placeholder={placeholder} />;
}

/** Polaris select. options: [{ value, label }] */
export function SelectField({ label, value, options, onChange, hideLabel = false }) {
  const ref = useRef(null);
  useElementEvent(ref, "change", (event) => onChange(event.target.value));
  useEffect(() => {
    if (ref.current && ref.current.value !== value) ref.current.value = value;
  }, [value]);
  return (
    <s-select ref={ref} label={label} value={value} {...(hideLabel ? { labelAccessibilityVisibility: "exclusive" } : {})}>
      {options.map((o) => (
        <s-option key={o.value} value={o.value} {...flag("selected", o.value === value)}>
          {o.label}
        </s-option>
      ))}
    </s-select>
  );
}

/** Polaris single-choice list. options: [{ value, label, details? }] */
export function ChoiceField({ label, name, value, options, onChange, disabledValues = [] }) {
  const ref = useRef(null);
  useElementEvent(ref, "change", (event) => {
    const values = event.currentTarget?.values ?? event.target?.values ?? [];
    if (values[0] !== undefined) onChange(values[0]);
  });
  return (
    <s-choice-list ref={ref} label={label} name={name}>
      {options.map((o) => (
        <s-choice key={o.value} value={o.value} {...flag("selected", o.value === value)} {...flag("disabled", disabledValues.includes(o.value))}>
          {o.label}
          {o.details ? <s-text slot="details">{o.details}</s-text> : null}
        </s-choice>
      ))}
    </s-choice-list>
  );
}

/** Polaris switch (on/off toggle), controlled through a ref. */
export function SwitchField({ label, details, checked, onChange, disabled = false }) {
  const ref = useRef(null);
  useElementEvent(ref, "change", (event) => onChange(Boolean(event.currentTarget?.checked ?? event.target?.checked)));
  useEffect(() => {
    // Keep the element in step with React state (e.g. after "Cancel").
    if (ref.current && ref.current.checked !== checked) ref.current.checked = checked;
  }, [checked]);
  return <s-switch ref={ref} label={label} details={details} {...flag("checked", checked)} {...flag("disabled", disabled)} />;
}

/** Polaris text field (controlled through a ref). */
export function TextField({ label, value, onChange, placeholder, details }) {
  const ref = useRef(null);
  useElementEvent(ref, "input", (event) => onChange(event.target.value ?? ""));
  useEffect(() => {
    if (ref.current && ref.current.value !== value) ref.current.value = value;
  }, [value]);
  return <s-text-field ref={ref} label={label} placeholder={placeholder} details={details} />;
}

/** Show/hide block for long technical content. */
export function Disclosure({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <s-stack gap="small">
      <s-stack direction="inline">
        <s-button variant="tertiary" icon={open ? "chevron-up" : "chevron-down"} onClick={() => setOpen((v) => !v)}>
          {title}
        </s-button>
      </s-stack>
      {open ? children : null}
    </s-stack>
  );
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function compareValues(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined || a === "") return 1;
  if (b === null || b === undefined || b === "") return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(String(a), String(b));
}

/**
 * Index table in the Shopify admin style: search, filter and sort controls in
 * the table's filter bar, Polaris pagination, responsive list on small screens.
 *
 * columns: [{ key, label, listSlot?, numeric?, render?(row) }]
 * filters: [{ key, label, options: [{ value, label }], match(row, value) }]
 * sorts:   [{ value, label, compare(a, b) }]
 * search:  { placeholder, text(row) }
 */
export function IndexTable({
  columns,
  rows,
  rowKey,
  filters = [],
  sorts = [],
  search,
  pageSize = 25,
  emptyText = "No results.",
  initialFilters = {},
  onFiltersChange,
  heading,
}) {
  const tableRef = useRef(null);
  const [query, setQuery] = useState("");
  const [filterValues, setFilterValues] = useState(() =>
    Object.fromEntries(filters.map((f) => [f.key, initialFilters[f.key] ?? f.options[0].value])),
  );
  const [sort, setSort] = useState(sorts[0]?.value ?? null);
  const [page, setPage] = useState(0);

  const visibleRows = useMemo(() => {
    let list = rows;
    for (const f of filters) list = list.filter((row) => f.match(row, filterValues[f.key]));
    if (search && query.trim()) {
      const needle = query.trim().toLowerCase();
      list = list.filter((row) => search.text(row).toLowerCase().includes(needle));
    }
    const sorter = sorts.find((s) => s.value === sort);
    return sorter ? [...list].sort(sorter.compare) : list;
  }, [rows, filters, filterValues, search, query, sorts, sort]);

  const pages = Math.max(1, Math.ceil(visibleRows.length / pageSize));
  const current = Math.min(page, pages - 1);
  const pageRows = visibleRows.slice(current * pageSize, current * pageSize + pageSize);

  useEffect(() => setPage(0), [query, filterValues, sort]);
  useElementEvent(tableRef, "nextpage", () => setPage((p) => Math.min(pages - 1, p + 1)));
  useElementEvent(tableRef, "previouspage", () => setPage((p) => Math.max(0, p - 1)));

  const setFilter = (key, value) => {
    const next = { ...filterValues, [key]: value };
    setFilterValues(next);
    onFiltersChange?.(next);
  };

  const hasControls = Boolean(search) || filters.length > 0 || sorts.length > 1;

  return (
    <s-section padding="none" {...(heading ? { heading } : {})}>
      <s-table
        ref={tableRef}
        variant="auto"
        {...flag("paginate", pages > 1)}
        {...flag("hasPreviousPage", current > 0)}
        {...flag("hasNextPage", current < pages - 1)}
      >
        {hasControls ? (
          <s-grid slot="filters" gridTemplateColumns="repeat(auto-fit, minmax(170px, 1fr))" gap="small" alignItems="end">
            {search ? <SearchField label="Search" placeholder={search.placeholder} onChange={setQuery} /> : null}
            {filters.map((f) => (
              <SelectField key={f.key} label={f.label} value={filterValues[f.key]} options={f.options} onChange={(v) => setFilter(f.key, v)} />
            ))}
            {sorts.length > 1 ? (
              <SelectField label="Sort by" value={sort} options={sorts.map((s) => ({ value: s.value, label: s.label }))} onChange={setSort} />
            ) : null}
          </s-grid>
        ) : null}
        <s-table-header-row>
          {columns.map((c) => (
            <s-table-header key={c.key} {...(c.listSlot ? { listSlot: c.listSlot } : {})} {...(c.numeric ? { format: "numeric" } : {})}>
              {c.label}
            </s-table-header>
          ))}
        </s-table-header-row>
        <s-table-body>
          {pageRows.map((row, index) => (
            <s-table-row key={rowKey ? rowKey(row) : index}>
              {columns.map((c) => (
                <s-table-cell key={c.key}>{c.render ? c.render(row) : row[c.key] ?? "—"}</s-table-cell>
              ))}
            </s-table-row>
          ))}
        </s-table-body>
      </s-table>
      {pageRows.length === 0 ? (
        <s-box padding="base">
          <s-text color="subdued">{emptyText}</s-text>
        </s-box>
      ) : (
        <s-box padding="small-200" paddingInline="base">
          <s-text color="subdued">
            {pages > 1
              ? `${current * pageSize + 1}–${Math.min(visibleRows.length, (current + 1) * pageSize)} of ${visibleRows.length}`
              : `${visibleRows.length} ${visibleRows.length === 1 ? "result" : "results"}`}
          </s-text>
        </s-box>
      )}
    </s-section>
  );
}

const numberFormat = new Intl.NumberFormat("en-GB");
export const formatNumber = (n) => (n === null || n === undefined ? "—" : numberFormat.format(n));

export function formatMoney(amount, currency) {
  if (amount === null || amount === undefined) return "—";
  if (!currency) return numberFormat.format(Math.round(amount));
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

export function formatCompact(n) {
  if (n === null || n === undefined) return "—";
  return Math.abs(n) >= 10000 ? new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 }).format(n) : numberFormat.format(n);
}

export const shortDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

export const dateRange = (start, end) => {
  const fmt = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${fmt(start)} – ${fmt(end)} ${end.slice(0, 4)}`;
};
