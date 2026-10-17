import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * SINGLE SOURCE OF TRUTH for the Event Analytics charts (Events Logged Over
 * Time, Events by Category, Events by Thematic Area, Engagement by Level).
 *
 * The Dashboard (pages/Dashboard/Dashboard.jsx) and the TV Display's Event
 * Analytics screens (pages/TvDisplay/TvDisplay.jsx) BOTH render these
 * components. They used to each carry their own hand-copied version of the
 * palette, bar colors, axis math, donut, bars and trend chart, so every
 * change to one silently left the other out of date. Do not copy these into
 * a page again: change them here and both screens follow.
 *
 * The only thing that differs between the two screens is physical size
 * (the TV is read from across a room), so that lives in SCALES below and is
 * selected with the `scale` prop. Colors, palette, labels, gridlines, axis
 * treatment, ranking and formatting are identical for every scale.
 */

// --- Shared design tokens ---------------------------------------------
export const CHART_LINE = "#2563C4"; // brand primary blue, line stroke (hero trend)
export const CHART_FILL = "#2563C4"; // brand primary blue, bar/segment fills, area gradient
export const CATEGORY_DONUT_PALETTE = ["#2563C4", "#1D9E75", "#E5A729", "#7C5CD6", "#0E9AA8"];
export const CHART_GRID = "#E5E9F0"; // thin gridlines / axis lines
export const CHART_TICK = "#8A93A6"; // muted tick text
export const CHART_LABEL_INK = "#1A1A1A"; // value labels on bars

// Rank-based blue gradient: rank 1 (highest count) = brand blue fading to a
// pale tint of the SAME blue. Color encodes RANK, not the category.
const RANKED_BAR_DARK = [0x25, 0x63, 0xc4];
const RANKED_BAR_LIGHT = [0xc9, 0xdf, 0xfa];

export function rankedBarColor(index, total) {
  const t = total <= 1 ? 0 : index / (total - 1);
  const rgb = RANKED_BAR_DARK.map((start, i) => Math.round(start + (RANKED_BAR_LIGHT[i] - start) * t));
  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// "Nice" axis max/ticks so the 5 gridlines land on clean numbers.
export function niceAxisTicks(maxValue) {
  const rawStep = Math.max(1, maxValue) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const niceSteps = [1, 2, 4, 5, 8, 10];
  const step = niceSteps.find((s) => s * magnitude >= rawStep) * magnitude || rawStep;
  return [0, 1, 2, 3, 4].map((i) => Math.round(i * step));
}

// White or dark label text depending on contrast with the segment's fill.
export function readableTextColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#1A1A1A" : "#FFFFFF";
}

// X-axis label for the trend chart: a per-day bucket ("2026-09-14") shows as
// "Sep 14" on the weekly period; every other bucket shows as given.
export function formatTrendTick(value, period) {
  return period === "weekly" && value?.length === 10
    ? new Date(value + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : value;
}

// --- Physical sizing only ---------------------------------------------
const SCALES = {
  dashboard: {
    interactive: true, // hover tooltips / active dot (a mouse exists)
    axisInterval: undefined,
    donut: {
      rowClass: "mt-3 flex items-center gap-6",
      pieClass: "h-52 flex-1 min-w-0",
      legendClass: "shrink-0 space-y-2.5",
      itemClass: "flex items-center gap-2 text-sm text-ink min-w-0",
      swatchClass: "h-2.5 w-2.5 rounded-sm shrink-0",
      labelFontSize: 13,
      sliceStroke: 2,
      minLabelPercent: 0,
    },
    bars: {
      vertical: { margin: { top: 40, right: 8, bottom: 0, left: 8 }, barSize: () => 44, radius: [4, 4, 0, 0], catTick: 13, numTick: 12 },
      horizontal: { margin: { top: 0, right: 40, bottom: 0, left: 0 }, barSize: () => 24, radius: [0, 4, 4, 0], catTick: 13, numTick: 12, yWidth: 140 },
      labelFontSize: 13,
    },
    trend: { margin: undefined, tick: 12, legendFontSize: undefined, strokeWidth: 2.5, dotR: 3 },
  },
  tv: {
    interactive: false, // a wall screen has no pointer
    axisInterval: 0, // never skip an axis label
    donut: {
      rowClass: "absolute inset-0 flex items-center justify-center gap-20",
      pieClass: "h-full aspect-square max-w-[60%]",
      legendClass: "shrink-0 space-y-5",
      itemClass: "flex items-center gap-4 text-3xl text-ink min-w-0",
      swatchClass: "h-5 w-5 rounded-sm shrink-0",
      labelFontSize: 22,
      sliceStroke: 3,
      minLabelPercent: 6, // slivers too thin to hold a 22px label stay unlabeled
    },
    bars: {
      vertical: { margin: { top: 40, right: 24, bottom: 0, left: 8 }, barSize: () => 80, radius: [6, 6, 0, 0], catTick: 22, numTick: 20 },
      horizontal: { margin: { top: 0, right: 140, bottom: 0, left: 0 }, barSize: (n) => (n > 7 ? 26 : 38), radius: [0, 6, 6, 0], catTick: 22, numTick: 20, yWidth: 300 },
      labelFontSize: 22,
    },
    trend: { margin: { top: 16, right: 24, bottom: 0, left: 0 }, tick: 22, legendFontSize: 22, strokeWidth: 4, dotR: 5 },
  },
};

function getScale(scale) {
  return SCALES[scale] || SCALES.dashboard;
}

// --- TV-only helpers ----------------------------------------------------
// Everything below is used ONLY by scale="tv" (the wall screen). The
// Dashboard-sized charts keep using the original code paths untouched.

// Display-resolution factor: 1.0 at 1080px tall (Full HD), smaller on a
// 768px panel, larger on 4K. Every TV font / bar / margin is multiplied by
// it, so the charts keep the same proportions on any TV resolution or
// aspect ratio instead of being tuned for one fixed size.
function readViewportScale() {
  if (typeof window === "undefined") return 1;
  return Math.min(2, Math.max(0.7, window.innerHeight / 1080));
}

function useViewportScale() {
  const [k, setK] = useState(readViewportScale);
  useEffect(() => {
    const onResize = () => setK(readViewportScale());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return k;
}

// The chart's own pixel box, so label/bar sizing can react to the space it
// really has (not a guess).
function useElementSize() {
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

// Whole-number axis for counts. The old helper rounded fractional steps, so
// small counts produced repeated ticks (0, 0, 1, 1, 2). This always gives
// distinct integer ticks (at most 6) and one step of headroom above the
// tallest value, so the number printed above the tallest bar never touches
// the top of the chart.
export function countAxisTicks(maxValue) {
  const m = Math.max(1, Math.ceil(maxValue));
  const target = m * 1.18;
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
  const step = steps.find((st) => Math.ceil(target / st) <= 5) || Math.ceil(target / 4);
  const top = Math.ceil(target / step) * step;
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { ticks, axisMax: top };
}

// Word-wraps (max `maxLines`) and ellipsizes a label to the width it has, so
// axis labels never overlap each other or run off the chart.
function wrapLabel(text, maxChars, maxLines) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxChars || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  const ellipsize = (l) => (l.endsWith("\u2026") ? l : `${l.slice(0, Math.max(1, maxChars - 1))}\u2026`);
  const out = lines.slice(0, maxLines).map((l) => (l.length > maxChars ? ellipsize(l) : l));
  if (lines.length > maxLines) out[out.length - 1] = ellipsize(out[out.length - 1]);
  return out;
}

function TvCategoryTick({ x, y, payload, fontSize, maxChars, maxLines, anchor, dy }) {
  const lines = wrapLabel(payload?.value, maxChars, maxLines);
  const lineH = fontSize * 1.15;
  const startY = anchor === "end" ? y - ((lines.length - 1) * lineH) / 2 : y + dy;
  return (
    <text x={x} y={startY} textAnchor={anchor} dominantBaseline={anchor === "end" ? "central" : "hanging"} fontSize={fontSize} fill={CHART_TICK}>
      {lines.map((l, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : lineH}>
          {l}
        </tspan>
      ))}
    </text>
  );
}

const singularize = (word) => (word.endsWith("s") ? word.slice(0, -1) : word);

function TvRankedBarChart({ data, labelKey, countKey, countSuffix, orientation }) {
  const k = useViewportScale();
  const [ref, { w, h }] = useElementSize();
  const sorted = [...data].sort((a, b) => b[countKey] - a[countKey]);
  const n = Math.max(1, sorted.length);
  const maxValue = Math.max(1, ...sorted.map((row) => row[countKey]));
  const { ticks, axisMax } = countAxisTicks(maxValue);
  const isVertical = orientation === "vertical";

  const labelFs = Math.round(22 * k);
  const tickFs = Math.round(20 * k);
  const catFs = Math.round(22 * k);
  const minBar = Math.round(14 * k); // a value of 1 still draws a visible bar
  const minPointSize = (value) => (value > 0 ? minBar : 0);
  const longestWord = `${maxValue} ${countSuffix}`;
  const wordWidth = longestWord.length * labelFs * 0.56;
  const one = singularize(countSuffix);
  const withWord = (value) => `${value} ${value === 1 ? one : countSuffix}`;

  if (isVertical) {
    const yW = Math.round(60 * k);
    const margin = {
      top: Math.round(labelFs * 1.5 + 14 * k), // room for the number above the tallest bar
      right: Math.round(24 * k),
      bottom: Math.round(8 * k),
      left: Math.round(8 * k),
    };
    const plotW = Math.max(0, w - yW - margin.left - margin.right);
    const slot = plotW / n;
    // Number + word only when it truly fits over its bar; otherwise just the
    // number, so neighbouring labels never run into each other.
    const showWord = slot >= wordWidth + 20 * k;
    const barSize = Math.max(Math.round(28 * k), Math.min(Math.round(slot * 0.55), Math.round(120 * k)));
    const maxChars = Math.max(4, Math.floor((slot - 12 * k) / (catFs * 0.56)));
    const maxLines = 2;
    const xAxisH = Math.round(catFs * 1.15 * maxLines + 22 * k);

    return (
      <div ref={ref} className="h-full w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={sorted} layout="horizontal" margin={margin} barCategoryGap="12%">
            <CartesianGrid vertical={false} stroke={CHART_GRID} />
            <XAxis
              type="category"
              dataKey={labelKey}
              interval={0}
              height={xAxisH}
              tickMargin={Math.round(14 * k)}
              tick={<TvCategoryTick fontSize={catFs} maxChars={maxChars} maxLines={maxLines} anchor="middle" dy={Math.round(4 * k)} />}
              axisLine={{ stroke: CHART_GRID }}
              tickLine={false}
            />
            <YAxis
              type="number"
              domain={[0, axisMax]}
              ticks={ticks}
              allowDecimals={false}
              width={yW}
              tickMargin={Math.round(10 * k)}
              tick={{ fontSize: tickFs, fill: CHART_TICK }}
              axisLine={false}
              tickLine={false}
            />
            <Bar dataKey={countKey} barSize={barSize} radius={[6, 6, 0, 0]} minPointSize={minPointSize} isAnimationActive={false}>
              {sorted.map((row, index) => (
                <Cell key={row[labelKey]} fill={rankedBarColor(index, sorted.length)} />
              ))}
              <LabelList
                dataKey={countKey}
                position="top"
                offset={Math.round(10 * k)}
                formatter={(value) => (showWord ? withWord(value) : `${value}`)}
                style={{ fontSize: labelFs, fontWeight: 600, fill: CHART_LABEL_INK }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // Horizontal bars (Thematic Area): category name column on the left (wrapped
  // to two lines when the row is tall enough), value label after each bar.
  const yW = Math.round(Math.min(360 * k, Math.max(170 * k, w * 0.28)));
  const margin = { top: Math.round(8 * k), right: Math.round(wordWidth + 28 * k), bottom: Math.round(4 * k), left: 0 };
  const xAxisH = Math.round(tickFs * 1.4 + 14 * k);
  const plotH = Math.max(0, h - margin.top - margin.bottom - xAxisH);
  const rowH = plotH / n;
  const barSize = Math.max(Math.round(16 * k), Math.min(Math.round(rowH * 0.6), Math.round(60 * k)));
  const maxLines = rowH >= catFs * 2.5 ? 2 : 1;
  const maxChars = Math.max(6, Math.floor((yW - 16 * k) / (catFs * 0.56)));

  return (
    <div ref={ref} className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={sorted} layout="vertical" margin={margin} barCategoryGap="14%">
          <CartesianGrid horizontal={false} stroke={CHART_GRID} />
          <XAxis
            type="number"
            domain={[0, axisMax]}
            ticks={ticks}
            allowDecimals={false}
            height={xAxisH}
            tickMargin={Math.round(10 * k)}
            tick={{ fontSize: tickFs, fill: CHART_TICK }}
            axisLine={{ stroke: CHART_GRID }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey={labelKey}
            interval={0}
            width={yW}
            tick={<TvCategoryTick fontSize={catFs} maxChars={maxChars} maxLines={maxLines} anchor="end" dy={0} />}
            axisLine={{ stroke: CHART_GRID }}
            tickLine={false}
          />
          <Bar dataKey={countKey} barSize={barSize} radius={[0, 6, 6, 0]} minPointSize={minPointSize} isAnimationActive={false}>
            {sorted.map((row, index) => (
              <Cell key={row[labelKey]} fill={rankedBarColor(index, sorted.length)} />
            ))}
            <LabelList
              dataKey={countKey}
              position="right"
              offset={Math.round(12 * k)}
              formatter={withWord}
              style={{ fontSize: labelFs, fontWeight: 600, fill: CHART_LABEL_INK }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function TvEventTrendAreaChart({ series, period }) {
  const k = useViewportScale();
  const maxValue = Math.max(1, ...series.map((row) => row.count || 0));
  const { ticks, axisMax } = countAxisTicks(maxValue);
  const tickFs = Math.round(22 * k);
  const gradientId = "eventTrendFill-tv";
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={series} margin={{ top: Math.round(20 * k), right: Math.round(32 * k), bottom: Math.round(6 * k), left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_FILL} stopOpacity={0.5} />
            <stop offset="100%" stopColor={CHART_FILL} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
        <XAxis
          dataKey="month"
          interval="preserveStartEnd"
          minTickGap={Math.round(28 * k)}
          height={Math.round(tickFs * 1.2 + 22 * k)}
          tickMargin={Math.round(14 * k)}
          tick={{ fontSize: tickFs, fill: CHART_TICK }}
          axisLine={{ stroke: CHART_GRID }}
          tickLine={false}
          tickFormatter={(value) => formatTrendTick(value, period)}
        />
        <YAxis
          type="number"
          domain={[0, axisMax]}
          ticks={ticks}
          allowDecimals={false}
          width={Math.round(60 * k)}
          tickMargin={Math.round(10 * k)}
          tick={{ fontSize: tickFs, fill: CHART_TICK }}
          axisLine={false}
          tickLine={false}
        />
        <Area
          isAnimationActive={false}
          type="monotone"
          dataKey="count"
          name="Events"
          stroke={CHART_LINE}
          strokeWidth={Math.round(4 * k)}
          fill={`url(#${gradientId})`}
          dot={{ r: Math.round(6 * k), fill: CHART_LINE, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// --- Donut (Events by Category) ---------------------------------------
function DonutPercentLabel({ cx, cy, midAngle, innerRadius, outerRadius, percentage, fill, fontSize, minPercent }) {
  if (percentage < minPercent) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.55;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill={readableTextColor(fill)} textAnchor="middle" dominantBaseline="central" fontSize={fontSize} fontWeight={700}>
      {percentage}%
    </text>
  );
}

/** Donut + legend row. `data` = [{ category, percentage }], order preserved. */
export function DonutCategoryChart({ data, scale = "dashboard" }) {
  const s = getScale(scale).donut;
  const vk = useViewportScale();
  const k = scale === "tv" ? vk : 1;
  const legendStyle = scale === "tv" ? { fontSize: Math.round(30 * k) } : undefined;
  return (
    <div className={s.rowClass}>
      <div className={s.pieClass}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="percentage"
              nameKey="category"
              innerRadius="57%"
              outerRadius="95%"
              startAngle={90}
              endAngle={-270}
              paddingAngle={1.5}
              stroke="#FFFFFF"
              strokeWidth={s.sliceStroke}
              isAnimationActive={false}
              label={(props) => (
                <DonutPercentLabel
                  {...props}
                  percentage={props.percentage}
                  fill={props.fill}
                  fontSize={Math.round(s.labelFontSize * k)}
                  minPercent={s.minLabelPercent}
                />
              )}
              labelLine={false}
            >
              {data.map((entry, idx) => (
                <Cell key={entry.category} fill={CATEGORY_DONUT_PALETTE[idx % CATEGORY_DONUT_PALETTE.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className={s.legendClass}>
        {data.map((entry, idx) => (
          <li key={entry.category} className={s.itemClass} style={legendStyle}>
            <span className={s.swatchClass} style={{ backgroundColor: CATEGORY_DONUT_PALETTE[idx % CATEGORY_DONUT_PALETTE.length] }} />
            <span className="truncate">{entry.category}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Ranked bars (Events by Thematic Area / Engagement by Level) ------
/**
 * Accepts a plain, unsorted list; sorting (descending by `countKey`) and
 * rank-coloring happen here so callers never pre-sort or pre-color.
 * Fills its parent (the parent must give it a height).
 */
export function RankedBarChart({
  data,
  labelKey = "area",
  countKey = "eventCount",
  countSuffix = "events",
  orientation = "horizontal",
  scale = "dashboard",
}) {
  if (scale === "tv") {
    return <TvRankedBarChart data={data} labelKey={labelKey} countKey={countKey} countSuffix={countSuffix} orientation={orientation} />;
  }
  const cfg = getScale(scale);
  const sorted = [...data].sort((a, b) => b[countKey] - a[countKey]);
  const maxValue = Math.max(1, ...sorted.map((row) => row[countKey]));
  const ticks = niceAxisTicks(maxValue);
  const axisMax = ticks[ticks.length - 1];
  const isVertical = orientation === "vertical";
  const v = cfg.bars.vertical;
  const h = cfg.bars.horizontal;
  const labelStyle = { fontSize: cfg.bars.labelFontSize, fontWeight: 400, fill: CHART_LABEL_INK };
  const valueLabel = (value) => `${value} ${countSuffix}`;
  const tooltip = cfg.interactive ? (
    <Tooltip
      cursor={{ fill: "#F1F4F9" }}
      formatter={(value) => [`${value} ${countSuffix}`, ""]}
      contentStyle={{ fontSize: 13, borderRadius: 8, border: `1px solid ${CHART_GRID}` }}
    />
  ) : null;

  return (
    <ResponsiveContainer width="100%" height="100%">
      {isVertical ? (
        <BarChart data={sorted} layout="horizontal" margin={v.margin}>
          <CartesianGrid vertical={false} stroke={CHART_GRID} />
          <XAxis
            type="category"
            dataKey={labelKey}
            interval={cfg.axisInterval}
            tick={{ fontSize: v.catTick, fill: CHART_TICK }}
            axisLine={{ stroke: CHART_GRID }}
            tickLine={false}
          />
          <YAxis
            type="number"
            domain={[0, axisMax]}
            ticks={ticks}
            tick={{ fontSize: v.numTick, fill: CHART_TICK }}
            axisLine={{ stroke: CHART_GRID }}
            tickLine={false}
          />
          {tooltip}
          <Bar dataKey={countKey} barSize={v.barSize(sorted.length)} radius={v.radius} isAnimationActive={false}>
            {sorted.map((row, index) => (
              <Cell key={row[labelKey]} fill={rankedBarColor(index, sorted.length)} />
            ))}
            <LabelList dataKey={countKey} position="top" formatter={valueLabel} style={labelStyle} />
          </Bar>
        </BarChart>
      ) : (
        <BarChart data={sorted} layout="vertical" margin={h.margin}>
          <CartesianGrid horizontal={false} stroke={CHART_GRID} />
          <XAxis
            type="number"
            domain={[0, axisMax]}
            ticks={ticks}
            tick={{ fontSize: h.numTick, fill: CHART_TICK }}
            axisLine={{ stroke: CHART_GRID }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey={labelKey}
            width={h.yWidth}
            interval={cfg.axisInterval}
            tick={{ fontSize: h.catTick, fill: CHART_TICK }}
            axisLine={{ stroke: CHART_GRID }}
            tickLine={false}
          />
          {tooltip}
          <Bar dataKey={countKey} barSize={h.barSize(sorted.length)} radius={h.radius} isAnimationActive={false}>
            {sorted.map((row, index) => (
              <Cell key={row[labelKey]} fill={rankedBarColor(index, sorted.length)} />
            ))}
            <LabelList dataKey={countKey} position="right" formatter={valueLabel} style={labelStyle} />
          </Bar>
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}

// --- Trend (Events Logged Over Time) ----------------------------------
/** `series` = [{ month, count }]. Fills its parent (which must give it a height). */
export function EventTrendAreaChart({ series, period, scale = "dashboard" }) {
  if (scale === "tv") return <TvEventTrendAreaChart series={series} period={period} />;
  const cfg = getScale(scale);
  const t = cfg.trend;
  const gradientId = `eventTrendFill-${scale}`;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={series} margin={t.margin}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_FILL} stopOpacity={0.5} />
            <stop offset="100%" stopColor={CHART_FILL} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fontSize: t.tick }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(value) => formatTrendTick(value, period)}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: t.tick }}
          axisLine={false}
          tickLine={false}
        />
        {cfg.interactive && <Tooltip />}
        <Legend wrapperStyle={t.legendFontSize ? { fontSize: t.legendFontSize } : undefined} />
        <Area
          isAnimationActive={false}
          type="monotone"
          dataKey="count"
          name="Events"
          stroke={CHART_LINE}
          strokeWidth={t.strokeWidth}
          fill={`url(#${gradientId})`}
          dot={{ r: t.dotR, fill: CHART_LINE, strokeWidth: 0 }}
          activeDot={cfg.interactive ? { r: 5 } : undefined}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
