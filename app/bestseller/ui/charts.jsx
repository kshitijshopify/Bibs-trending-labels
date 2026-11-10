// Small SVG charts for the analytics page.
// Palette: validated reference instance (dataviz skill) - categorical slots
// 1-3 (blue, orange, aqua) pass every check all-pairs in light and dark mode.
// Aqua is below 3:1 on the light surface, so every chart ships direct labels
// and a table view (the relief rule). Text always uses text tokens.
import { useState } from "react";
import { formatNumber } from "./kit.jsx";

export const SERIES_SLOTS = { pacifiers: 1, bottles: 2, accessories: 3 };

export function VizStyles() {
  return (
    <style>{`
      .bbl-viz { color-scheme: light;
        --surface-1:#fcfcfb; --text-primary:#0b0b0b; --text-secondary:#52514e; --text-muted:#898781;
        --grid:#e1e0d9; --axis:#c3c2b7; --series-1:#2a78d6; --series-2:#eb6834; --series-3:#1baf7a;
        font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--text-primary); }
      @media (prefers-color-scheme: dark) {
        :root:where(:not([data-theme="light"])) .bbl-viz { color-scheme: dark;
          --surface-1:#1a1a19; --text-primary:#f0efec; --text-secondary:#c3c2b7; --text-muted:#898781;
          --grid:#2c2c2a; --axis:#383835; --series-1:#3987e5; --series-2:#d95926; --series-3:#199e70; }
      }
      :root[data-theme="dark"] .bbl-viz { color-scheme: dark;
        --surface-1:#1a1a19; --text-primary:#f0efec; --text-secondary:#c3c2b7; --text-muted:#898781;
        --grid:#2c2c2a; --axis:#383835; --series-1:#3987e5; --series-2:#d95926; --series-3:#199e70; }
      .bbl-viz .tabular { font-variant-numeric: tabular-nums; }
    `}</style>
  );
}

const seriesColor = (key) => `var(--series-${SERIES_SLOTS[key] ?? 1})`;

function niceMax(value) {
  if (value <= 0) return 4;
  const step = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= value) return m * step;
  return 10 * step;
}

const dayLabel = (day) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Units per day, one line per category. Legend always shown (>= 2 series),
 * end labels where they do not collide, crosshair tooltip on hover/keyboard,
 * and a table view.
 */
export function TrendChart({ days, series }) {
  const [hover, setHover] = useState(null);
  const [asTable, setAsTable] = useState(false);
  const W = 720;
  const H = 240;
  const pad = { left: 44, right: 110, top: 12, bottom: 28 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const x = (i) => pad.left + (days.length <= 1 ? 0 : (i / (days.length - 1)) * innerW);
  const y = (v) => pad.top + innerH - (Math.max(0, v) / max) * innerH;
  const ticks = [0, max / 4, max / 2, (3 * max) / 4, max];
  const xTicks = days.map((d, i) => i).filter((i) => i % 5 === 0 || i === days.length - 1);

  // End labels only where they are at least 14px apart (no nudging).
  const ends = series
    .map((s) => ({ key: s.key, name: s.name, value: s.values[s.values.length - 1] ?? 0, y: y(s.values[s.values.length - 1] ?? 0) }))
    .sort((a, b) => a.y - b.y);
  const labelled = new Set(ends.filter((e, i) => (i === 0 || e.y - ends[i - 1].y >= 14) && (i === ends.length - 1 || ends[i + 1].y - e.y >= 14)).map((e) => e.key));

  const indexFromEvent = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * W;
    return Math.max(0, Math.min(days.length - 1, Math.round(((px - pad.left) / innerW) * (days.length - 1))));
  };

  if (!days.length || !series.length) return <s-paragraph>No daily sales data for this window.</s-paragraph>;

  return (
    <div className="bbl-viz">
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        {series.map((s) => (
          <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-secondary)", fontSize: 13 }}>
            <svg width="16" height="4" aria-hidden="true">
              <line x1="0" y1="2" x2="16" y2="2" stroke={seriesColor(s.key)} strokeWidth="2" strokeLinecap="round" />
            </svg>
            {s.name}
          </span>
        ))}
        <span style={{ marginLeft: "auto" }}>
          <s-button variant="tertiary" onClick={() => setAsTable((v) => !v)}>
            {asTable ? "Show chart" : "Show as table"}
          </s-button>
        </span>
      </div>

      {asTable ? (
        <div style={{ maxHeight: 320, overflow: "auto" }}>
          <table className="tabular" style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: 4 }}>Day</th>
                {series.map((s) => (
                  <th key={s.key} style={{ textAlign: "right", padding: 4 }}>
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((day, i) => (
                <tr key={day} style={{ borderTop: "1px solid var(--grid)" }}>
                  <td style={{ padding: 4 }}>{dayLabel(day)}</td>
                  {series.map((s) => (
                    <td key={s.key} style={{ textAlign: "right", padding: 4 }}>
                      {formatNumber(s.values[i])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ position: "relative" }}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            role="img"
            aria-label={`Units sold per day, ${series.map((s) => s.name).join(", ")}. Use the arrow keys to read each day.`}
            tabIndex={0}
            style={{ display: "block", outline: "none" }}
            onPointerMove={(e) => setHover(indexFromEvent(e))}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover((h) => h ?? days.length - 1)}
            onBlur={() => setHover(null)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? days.length) - 1));
              if (e.key === "ArrowRight") setHover((h) => Math.min(days.length - 1, (h ?? -1) + 1));
            }}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.left} x2={pad.left + innerW} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth="1" />
                <text x={pad.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)" className="tabular">
                  {formatNumber(Math.round(t))}
                </text>
              </g>
            ))}
            {xTicks.map((i) => (
              <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--text-muted)">
                {dayLabel(days[i])}
              </text>
            ))}
            {series.map((s) => (
              <polyline
                key={s.key}
                fill="none"
                stroke={seriesColor(s.key)}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
              />
            ))}
            {series.map((s) => {
              const last = s.values.length - 1;
              return (
                <g key={`end-${s.key}`}>
                  <circle cx={x(last)} cy={y(s.values[last] ?? 0)} r="4" fill={seriesColor(s.key)} stroke="var(--surface-1)" strokeWidth="2" />
                  {labelled.has(s.key) ? (
                    <text x={x(last) + 10} y={y(s.values[last] ?? 0) + 4} fontSize="12" fill="var(--text-secondary)">
                      {`${s.name} ${formatNumber(s.values[last] ?? 0)}`}
                    </text>
                  ) : null}
                </g>
              );
            })}
            {hover !== null ? (
              <g pointerEvents="none">
                <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + innerH} stroke="var(--axis)" strokeWidth="1" />
                {series.map((s) => (
                  <circle key={s.key} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r="4" fill={seriesColor(s.key)} stroke="var(--surface-1)" strokeWidth="2" />
                ))}
              </g>
            ) : null}
          </svg>
          {hover !== null ? (
            <div
              role="status"
              style={{
                position: "absolute",
                top: 8,
                left: `${Math.min(70, (x(hover) / W) * 100)}%`,
                transform: "translateX(8px)",
                background: "var(--surface-1)",
                border: "1px solid var(--grid)",
                borderRadius: 8,
                padding: "6px 10px",
                fontSize: 12,
                pointerEvents: "none",
                boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                minWidth: 140,
              }}
            >
              <div style={{ color: "var(--text-secondary)", marginBottom: 4 }}>{dayLabel(days[hover])}</div>
              {series.map((s) => (
                <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <svg width="12" height="4" aria-hidden="true">
                    <line x1="0" y1="2" x2="12" y2="2" stroke={seriesColor(s.key)} strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <strong className="tabular">{formatNumber(s.values[hover] ?? 0)}</strong>
                  <span style={{ color: "var(--text-secondary)" }}>{s.name}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * Horizontal bars with the value at the tip. Each bar keeps its entity's
 * color (category slot); bars are <= 24px thick with a 4px rounded data end.
 * rows: [{ key, label, value, colorKey, sublabel? }]
 */
export function BarList({ rows, format = formatNumber, unit = "" }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="bbl-viz" style={{ display: "grid", gap: 10 }}>
      {rows.map((r) => {
        const pct = Math.max(0, (r.value / max) * 100);
        return (
          <div key={r.key} style={{ display: "grid", gridTemplateColumns: "minmax(120px, 200px) 1fr", gap: 12, alignItems: "center" }}>
            <div style={{ fontSize: 13 }}>
              <div>{r.label}</div>
              {r.sublabel ? <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>{r.sublabel}</div> : null}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }} title={`${r.label}: ${format(r.value)}${unit}`}>
              <div
                style={{
                  height: 14,
                  width: `${pct}%`,
                  minWidth: r.value > 0 ? 2 : 0,
                  background: `var(--series-${SERIES_SLOTS[r.colorKey] ?? 1})`,
                  borderRadius: "0 4px 4px 0",
                }}
              />
              <span className="tabular" style={{ fontSize: 13, color: "var(--text-primary)", whiteSpace: "nowrap" }}>
                {`${format(r.value)}${unit}`}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Inline magnitude bar for table cells (single hue, value printed next to it). */
export function InlineBar({ value, max, colorKey, label }) {
  const pct = max > 0 ? Math.max(0, (value / max) * 100) : 0;
  return (
    <span className="bbl-viz" style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 140 }}>
      <span style={{ display: "inline-block", width: 80, height: 8 }}>
        <span
          style={{
            display: "block",
            height: 8,
            width: `${pct}%`,
            minWidth: value > 0 ? 2 : 0,
            background: `var(--series-${SERIES_SLOTS[colorKey] ?? 1})`,
            borderRadius: "0 4px 4px 0",
          }}
        />
      </span>
      <span className="tabular">{label ?? formatNumber(value)}</span>
    </span>
  );
}


/**
 * Stat-tile sparkline: the history in the de-emphasis ink, the latest day as
 * an accent dot in the entity's color. Decorative next to a labeled value,
 * so the value itself stays in the card text.
 */
export function Sparkline({ values, colorKey, label }) {
  if (!values?.length) return null;
  const W = 200;
  const H = 36;
  const max = Math.max(1, ...values);
  const x = (i) => (values.length === 1 ? W : (i / (values.length - 1)) * (W - 6) + 3);
  const y = (v) => H - 4 - (Math.max(0, v) / max) * (H - 8);
  const last = values.length - 1;
  return (
    <span className="bbl-viz" style={{ display: "block" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={label} preserveAspectRatio="none" style={{ display: "block" }}>
        <polyline
          fill="none"
          stroke="var(--text-muted)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          points={values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
        />
        <circle cx={x(last)} cy={y(values[last])} r="4" fill={`var(--series-${SERIES_SLOTS[colorKey] ?? 1})`} stroke="var(--surface-1)" strokeWidth="2" />
      </svg>
    </span>
  );
}
