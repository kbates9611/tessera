import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  DEFAULT_SANKEY_COLORS,
  defaultGaugeSettings,
} from "../../domain/defaults";
import type { DashboardBlock, DataTable } from "../../domain/types";
import { formatValue } from "../../lib/format";

const WIDTH = 720;
const HEIGHT = 310;
const M = { top: 24, right: 22, bottom: 48, left: 58 };
const MIN_CHART_HEIGHT = 220;
const SVG_LABEL_STYLE = { fontSize: 11 };
const SVG_VALUE_STYLE = { fontSize: 10.5 };
const DONUT_VIEW = { width: 320, height: 260, cx: 160, cy: 126, padding: 4 };
const BLUE_CHART_PALETTE = [
  "#1c2b4a",
  "#355f9d",
  "#4d76b3",
  "#7897c4",
  "#b7c9e2",
  "#dbe6f3",
] as const;

function ResponsiveChart({
  label,
  children,
}: {
  label: string;
  children: (width: number, height: number) => ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: WIDTH, height: HEIGHT });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(280, Math.round(rect.width));
      const height = Math.max(MIN_CHART_HEIGHT, Math.round(rect.height));
      setSize((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height },
      );
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="chart-block__visual"
      style={{
        display: "flex",
        width: "100%",
        minWidth: 0,
        minHeight: MIN_CHART_HEIGHT,
        flex: "1 1 auto",
      }}
    >
      <svg
        viewBox={`0 0 ${size.width} ${size.height}`}
        width="100%"
        height="100%"
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
        style={{ display: "block", width: "100%", height: "100%" }}
      >
        {children(size.width, size.height)}
      </svg>
    </div>
  );
}

interface Series {
  field: string;
  color: string;
  values: number[];
  missing: boolean[];
}

const CHART_NAMES: Record<string, string> = {
  bar: "Column chart",
  horizontalBar: "Ranked bars",
  groupedBar: "Comparison chart",
  line: "Trend chart",
  donut: "Composition chart",
  sankey: "Flow chart",
  gauge: "Target gauge",
  scatter: "Relationship chart",
  treemap: "Composition map",
  heatmap: "Performance matrix",
};

export function ChartRenderer({
  block,
  table,
  datasetName,
  provenance,
}: {
  block: DashboardBlock;
  table?: DataTable;
  datasetName?: string;
  provenance?: string;
}) {
  const prepared = prepare(table, block);
  return (
    <article className="chart-block" data-chart-type={block.type}>
      <header>
        <div className="chart-block__title">
          <div>
            <h3>{block.title}</h3>
            {block.subtitle && <p>{block.subtitle}</p>}
          </div>
        </div>
        <span className="chart-block__dataset">
          {datasetName ?? CHART_NAMES[block.type] ?? "Unbound"}
        </span>
      </header>
      {!table || !prepared.labels.length || !prepared.series.length ? (
        <div className="chart-empty">
          Choose a dataset and bind the chart fields.
        </div>
      ) : block.type === "scatter" ? (
        <Scatter block={block} table={table} />
      ) : block.type === "gauge" ? (
        <GaugeChart block={block} series={prepared.series[0]} table={table} />
      ) : block.type === "treemap" ? (
        <Treemap
          block={block}
          labels={prepared.labels}
          series={prepared.series[0]}
        />
      ) : block.type === "heatmap" ? (
        <Heatmap
          block={block}
          labels={prepared.labels}
          rowIndexes={prepared.rowIndexes}
          series={prepared.series}
        />
      ) : block.type === "donut" ? (
        <Donut
          block={block}
          labels={prepared.labels}
          series={prepared.series[0]}
        />
      ) : block.type === "horizontalBar" ? (
        <HorizontalBar
          block={block}
          labels={prepared.labels}
          series={prepared.series[0]}
        />
      ) : block.type === "sankey" ? (
        <Sankey block={block} table={table} />
      ) : (
        <Cartesian
          block={block}
          labels={prepared.labels}
          series={prepared.series}
        />
      )}
      {block.chart.showLegend &&
        prepared.series.length > 1 &&
        !["sankey", "heatmap", "scatter"].includes(block.type) && (
          <div className={`chart-legend is-${block.chart.legendPosition}`}>
            {prepared.series.map((series) => (
              <span
                key={series.field}
                style={{ minHeight: 20, fontSize: 11, lineHeight: 1.3 }}
              >
                <i
                  style={{
                    width: 9,
                    height: 9,
                    background:
                      block.type === "line"
                        ? lineSeriesColor(block, series.field, series.color)
                        : series.color,
                  }}
                />{" "}
                {series.field}
              </span>
            ))}
          </div>
        )}
      {provenance && <footer className="block-provenance">{provenance}</footer>}
    </article>
  );
}

function Cartesian({
  block,
  labels,
  series,
}: {
  block: DashboardBlock;
  labels: string[];
  series: Series[];
}) {
  return (
    <ResponsiveChart label={`${block.title} ${block.type}`}>
      {(width, height) => {
        const all = series.flatMap((item) =>
          item.values.filter(
            (_, index) => block.type !== "line" || !item.missing[index],
          ),
        );
        const naturalMin = Math.min(...all, 0);
        const naturalMax = Math.max(...all, 0);
        const span =
          naturalMax - naturalMin || Math.max(Math.abs(naturalMax), 1);
        const min =
          block.chart.minY ?? (naturalMin < 0 ? naturalMin - span * 0.08 : 0);
        const max = block.chart.maxY ?? naturalMax + span * 0.12;
        const references = referenceLines(
          block,
          series[0]?.values.filter((_, index) => !series[0].missing[index]) ??
            [],
        );
        const plotTop = M.top;
        const plotW = width - M.left - M.right;
        const plotH = height - plotTop - M.bottom;
        const x = (index: number) =>
          M.left + ((index + 0.5) * plotW) / labels.length;
        const y = (value: number) =>
          plotTop +
          plotH -
          ((value - min) / Math.max(max - min, 0.000001)) * plotH;
        const ticks = Array.from(
          { length: 5 },
          (_, index) => min + ((max - min) * index) / 4,
        );
        const baseline = y(Math.max(min, Math.min(max, 0)));
        const positionedReferences = positionReferenceLabels(
          references,
          y,
          plotTop,
          plotTop + plotH,
          plotW,
          block,
        );
        const displayLabels = compactAxisLabels(labels);
        const angledLabels =
          labels.length > 7 && displayLabels.some((label) => label.length > 8);
        const labelY = angledLabels ? height - 32 : height - 20;
        return (
          <>
            <defs>
              {series.map((item) => (
                <linearGradient
                  key={item.field}
                  id={gradientId(block, item.field)}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={item.color} stopOpacity="1" />
                  <stop offset="100%" stopColor={item.color} stopOpacity="1" />
                </linearGradient>
              ))}
            </defs>
            {ticks.map((tick, index) => (
              <g key={index}>
                {block.chart.showGridlines && (
                  <line
                    className="chart-grid"
                    x1={M.left}
                    x2={width - M.right}
                    y1={y(tick)}
                    y2={y(tick)}
                  />
                )}
                {block.chart.showYAxis && (
                  <text
                    className="chart-axis-label"
                    x={M.left - 9}
                    y={y(tick) + 4}
                    textAnchor="end"
                    style={SVG_LABEL_STYLE}
                  >
                    {formatChartValue(block, tick)}
                  </text>
                )}
              </g>
            ))}
            {block.chart.showXAxis && (
              <>
                <line
                  className="chart-axis"
                  x1={M.left}
                  x2={width - M.right}
                  y1={plotTop + plotH}
                  y2={plotTop + plotH}
                />
                {displayLabels.map((label, index) => (
                  <text
                    key={`${label}-${index}`}
                    className="chart-axis-label"
                    x={x(index)}
                    y={labelY}
                    textAnchor={angledLabels ? "end" : "middle"}
                    transform={
                      angledLabels
                        ? `rotate(-28 ${x(index)} ${labelY})`
                        : undefined
                    }
                    style={SVG_LABEL_STYLE}
                  >
                    {truncate(label, angledLabels ? 15 : 12)}
                  </text>
                ))}
              </>
            )}
            {block.type === "line" ? (
              <Lines
                block={block}
                series={series}
                labels={labels}
                x={x}
                y={y}
                areaBaseline={y(min)}
              />
            ) : (
              <Bars
                block={block}
                series={series}
                labels={labels}
                x={x}
                y={y}
                baseline={baseline}
                plotW={plotW}
              />
            )}
            {positionedReferences.map((line, index) => (
              <g key={`${line.label}-${index}`}>
                <line
                  className="chart-reference"
                  x1={M.left}
                  x2={width - M.right}
                  y1={line.lineY}
                  y2={line.lineY}
                />
                <rect
                  className="chart-reference-label-bg"
                  x={width - M.right - line.labelWidth}
                  y={line.labelY - 12}
                  width={line.labelWidth}
                  height="16"
                  rx="3"
                  fill="#ffffff"
                  fillOpacity="0.96"
                />
                <text
                  className="chart-reference-label"
                  x={width - M.right}
                  y={line.labelY}
                  textAnchor="end"
                  style={SVG_VALUE_STYLE}
                >
                  {line.text}
                </text>
              </g>
            ))}
            {block.chart.xAxisTitle && (
              <text
                className="chart-axis-title"
                x={M.left + plotW / 2}
                y={height - 2}
                textAnchor="middle"
                style={SVG_VALUE_STYLE}
              >
                {block.chart.xAxisTitle}
              </text>
            )}
            {block.chart.yAxisTitle && (
              <text
                className="chart-axis-title"
                x="12"
                y={plotTop + plotH / 2}
                textAnchor="middle"
                transform={`rotate(-90 12 ${plotTop + plotH / 2})`}
                style={SVG_VALUE_STYLE}
              >
                {block.chart.yAxisTitle}
              </text>
            )}
          </>
        );
      }}
    </ResponsiveChart>
  );
}

function Bars({
  block,
  series,
  labels,
  x,
  y,
  baseline,
  plotW,
}: {
  block: DashboardBlock;
  series: Series[];
  labels: string[];
  x: (index: number) => number;
  y: (value: number) => number;
  baseline: number;
  plotW: number;
}) {
  const slot = plotW / labels.length;
  const count = block.type === "groupedBar" ? series.length : 1;
  const width = Math.max(3, (slot * (1 - block.chart.barGap / 100)) / count);
  const shown = block.type === "groupedBar" ? series : series.slice(0, 1);
  return shown.map((item, seriesIndex) =>
    item.values.map((value, index) => (
      <g key={`${item.field}-${index}`} opacity={block.chart.seriesOpacity}>
        <rect
          data-category={labels[index]}
          data-series={item.field}
          data-color={barColor(block, labels[index], item.field, item.color)}
          x={x(index) - (width * count) / 2 + seriesIndex * width + 1}
          y={Math.min(y(value), baseline)}
          width={Math.max(2, width - 3)}
          height={Math.max(1, Math.abs(baseline - y(value)))}
          rx={block.chart.barRadius}
          fill={barColor(block, labels[index], item.field, item.color)}
        />
        {block.chart.showValues && (
          <text
            className="chart-value"
            x={x(index) - (width * count) / 2 + seriesIndex * width + width / 2}
            y={value < 0 ? y(value) + 14 : y(value) - 6}
            textAnchor="middle"
            style={SVG_VALUE_STYLE}
          >
            {formatChartValue(block, value)}
          </text>
        )}
      </g>
    )),
  );
}

function Lines({
  block,
  series,
  labels,
  x,
  y,
  areaBaseline,
}: {
  block: DashboardBlock;
  series: Series[];
  labels: string[];
  x: (index: number) => number;
  y: (value: number) => number;
  areaBaseline: number;
}) {
  return series.map((item, seriesIndex) => {
    const override = (block.chart.lineSeriesStyles ?? []).find(
      (style) => style.series === item.field,
    );
    const color = validChartColor(override?.color) ?? item.color;
    const lineWidth = override?.lineWidth ?? block.chart.lineWidth;
    const lineDash = override?.lineDash ?? block.chart.lineDash ?? "solid";
    const opacity = override?.opacity ?? block.chart.seriesOpacity;
    const showPoints = override?.showPoints ?? block.chart.showPoints;
    const pointSize = override?.pointSize ?? block.chart.pointSize ?? 4;
    const pointShape =
      override?.pointShape ?? block.chart.pointShape ?? "circle";
    const coordinates = item.values.map((value, index) =>
      item.missing[index] ? null : { x: x(index), y: y(value), index, value },
    );
    const segments = lineSegments(
      coordinates,
      block.chart.connectNulls ?? false,
    );
    return (
      <g key={item.field} data-line-series={item.field} opacity={opacity}>
        {(block.chart.fillArea ?? false) &&
          segments.map((segment, index) => (
            <path
              key={`area-${index}`}
              className="line-area"
              d={areaPath(segment, areaBaseline, block.chart.curve)}
              fill={color}
              fillOpacity={block.chart.areaOpacity ?? 0.12}
              stroke="none"
            />
          ))}
        {segments.map((segment, index) => (
          <path
            key={`line-${index}`}
            className="line-series"
            data-series={item.field}
            d={linePath(segment, block.chart.curve)}
            fill="none"
            stroke={color}
            strokeWidth={lineWidth}
            strokeDasharray={lineDashArray(lineDash)}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {item.values.map((value, index) => {
          if (item.missing[index]) return null;
          const pointOverride = (block.chart.linePointStyles ?? []).find(
            (style) =>
              style.series === item.field && style.category === labels[index],
          );
          const pointColor = validChartColor(pointOverride?.color) ?? color;
          const radius = pointOverride?.pointSize ?? pointSize;
          const shape = pointOverride?.pointShape ?? pointShape;
          const showPoint =
            showPoints ||
            pointOverride?.color !== undefined ||
            pointOverride?.pointSize !== undefined;
          const showLabel = pointOverride?.showLabel ?? block.chart.showValues;
          return (
            <g
              key={index}
              data-line-point={labels[index]}
              data-series={item.field}
            >
              <title>{`${item.field} — ${labels[index]}: ${formatChartValue(block, value)}`}</title>
              {showPoint && (
                <LinePointMarker
                  x={x(index)}
                  y={y(value)}
                  radius={radius}
                  shape={shape}
                  color={pointColor}
                  strokeWidth={Math.min(3, Math.max(1.5, lineWidth))}
                />
              )}
              {showLabel && (
                <text
                  className="chart-value"
                  x={x(index)}
                  y={
                    y(value) +
                    (series.length > 1 && seriesIndex % 2 === 1 ? 15 : -9)
                  }
                  textAnchor="middle"
                  style={{ ...SVG_VALUE_STYLE, fill: pointColor }}
                >
                  {formatChartValue(block, value)}
                </text>
              )}
            </g>
          );
        })}
      </g>
    );
  });
}

function LinePointMarker({
  x,
  y,
  radius,
  shape,
  color,
  strokeWidth,
}: {
  x: number;
  y: number;
  radius: number;
  shape: "circle" | "square" | "diamond";
  color: string;
  strokeWidth: number;
}) {
  if (shape === "circle")
    return (
      <circle
        cx={x}
        cy={y}
        r={radius}
        fill="#fff"
        stroke={color}
        strokeWidth={strokeWidth}
      />
    );
  const size = radius * 2;
  return (
    <rect
      x={x - radius}
      y={y - radius}
      width={size}
      height={size}
      rx={shape === "square" ? Math.min(2, radius * 0.25) : 0}
      fill="#fff"
      stroke={color}
      strokeWidth={strokeWidth}
      transform={shape === "diamond" ? `rotate(45 ${x} ${y})` : undefined}
    />
  );
}

function HorizontalBar({
  block,
  labels,
  series,
}: {
  block: DashboardBlock;
  labels: string[];
  series: Series;
}) {
  const min = Math.min(...series.values, 0);
  const max = Math.max(...series.values, 0);
  const span = max - min || 1;
  const plotStart = 158;
  const plotWidth = WIDTH - 230;
  const valueX = (value: number) =>
    plotStart + ((value - min) / span) * plotWidth;
  const baseline = valueX(0);
  const rowHeight = Math.min(48, 250 / Math.max(labels.length, 1));
  const barHeight = Math.max(8, rowHeight * (1 - block.chart.barGap / 100));
  const entries = labels.map((label, index) => ({
    label,
    value: series.values[index] ?? 0,
  }));
  if (block.chart.sortOrder === "ascending")
    entries.sort((a, b) => a.value - b.value);
  if (block.chart.sortOrder === "descending")
    entries.sort((a, b) => b.value - a.value);
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`${block.title} horizontal bar chart`}
    >
      <defs>
        <linearGradient
          id={gradientId(block, series.field)}
          x1="0"
          y1="0"
          x2="1"
          y2="0"
        >
          <stop offset="0%" stopColor={series.color} stopOpacity="1" />
          <stop offset="100%" stopColor={series.color} stopOpacity="1" />
        </linearGradient>
      </defs>
      <line
        className="chart-axis"
        x1={baseline}
        x2={baseline}
        y1={M.top - 6}
        y2={M.top + entries.length * rowHeight}
      />
      {entries.map((entry, index) => {
        const y = M.top + index * rowHeight;
        const end = valueX(entry.value);
        const x = Math.min(baseline, end);
        const width = Math.abs(end - baseline);
        return (
          <g key={`${entry.label}-${index}`}>
            <text
              className="chart-axis-label"
              x="145"
              y={y + barHeight / 2 + 4}
              textAnchor="end"
            >
              {truncate(entry.label, 24)}
            </text>
            <rect
              data-category={entry.label}
              data-series={series.field}
              data-color={barColor(
                block,
                entry.label,
                series.field,
                series.color,
              )}
              x={x}
              y={y}
              width={Math.max(1, width)}
              height={barHeight}
              rx={block.chart.barRadius}
              fill={barColor(block, entry.label, series.field, series.color)}
              opacity={block.chart.seriesOpacity}
            />
            {block.chart.showValues && (
              <text
                className="chart-value"
                x={entry.value < 0 ? x - 8 : x + width + 8}
                y={y + barHeight / 2 + 4}
                textAnchor={entry.value < 0 ? "end" : "start"}
              >
                {formatChartValue(block, entry.value)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function Donut({
  block,
  labels,
  series,
}: {
  block: DashboardBlock;
  labels: string[];
  series: Series;
}) {
  const total =
    series.values.reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
  // Size the ring from the space actually available around the centre so the
  // outer edge always fits the viewBox regardless of the hole percentage.
  const outerRadius =
    Math.min(
      DONUT_VIEW.cx,
      DONUT_VIEW.width - DONUT_VIEW.cx,
      DONUT_VIEW.cy,
      DONUT_VIEW.height - DONUT_VIEW.cy,
    ) - DONUT_VIEW.padding;
  const holeRatio = clamp((block.chart.donutHole ?? 0) / 100, 0, 1);
  const ringThickness = outerRadius * (1 - holeRatio);
  const radius = outerRadius - ringThickness / 2;
  const circumference = 2 * Math.PI * radius;
  const stackedLegend = block.chart.legendPosition !== "right";
  let offset = 0;
  return (
    <div
      className={`donut-layout is-${block.chart.legendPosition}`}
      style={{
        width: "100%",
        minHeight: 270,
        flex: "1 1 auto",
        gap: 12,
      }}
    >
      <svg
        viewBox={`0 0 ${DONUT_VIEW.width} ${DONUT_VIEW.height}`}
        role="img"
        aria-label={`${block.title} donut chart`}
        style={{
          display: "block",
          width: stackedLegend ? "min(100%, 340px)" : "min(58%, 300px)",
          minHeight: stackedLegend ? 210 : 240,
          maxHeight: stackedLegend ? 270 : 320,
          flex: stackedLegend ? "1 1 210px" : "0 1 300px",
        }}
      >
        <g transform={`rotate(-90 ${DONUT_VIEW.cx} ${DONUT_VIEW.cy})`}>
          {series.values.map((value, index) => {
            const length = (Math.max(0, value) / total) * circumference;
            const sliceStyle = block.chart.donutSliceStyles.find(
              (style) => style.category === labels[index],
            );
            const circle = (
              <circle
                key={index}
                data-category={labels[index]}
                cx={DONUT_VIEW.cx}
                cy={DONUT_VIEW.cy}
                r={radius}
                fill="none"
                stroke={sliceStyle?.color ?? chartColor(block, index)}
                strokeWidth={ringThickness}
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-offset}
                opacity={sliceStyle?.opacity ?? block.chart.seriesOpacity}
              />
            );
            offset += length;
            return circle;
          })}
        </g>
        <text
          x="160"
          y="120"
          textAnchor="middle"
          className="donut-total"
          style={{ fontSize: 24 }}
        >
          {formatChartValue(block, total)}
        </text>
        <text
          x="160"
          y="143"
          textAnchor="middle"
          className="donut-label"
          style={SVG_LABEL_STYLE}
        >
          {block.chart.donutCenterLabel}
        </text>
      </svg>
      {block.chart.showLegend && (
        <div
          className="donut-legend"
          style={{
            width: stackedLegend ? "100%" : undefined,
            gridTemplateColumns: stackedLegend
              ? "repeat(2, minmax(0, 1fr))"
              : undefined,
          }}
        >
          {labels.map((label, index) => (
            <span
              key={`${label}-${index}`}
              style={{ minHeight: 26, fontSize: 11, lineHeight: 1.25 }}
            >
              <i
                style={{
                  width: 9,
                  height: 9,
                  background:
                    block.chart.donutSliceStyles.find(
                      (style) => style.category === label,
                    )?.color ?? chartColor(block, index),
                }}
              />
              <b>{label}</b>
              <em>
                {block.chart.showValues
                  ? `${Math.round((series.values[index] / total) * 100)}%`
                  : formatChartValue(block, series.values[index])}
              </em>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function GaugeChart({
  block,
  series,
  table,
}: {
  block: DashboardBlock;
  series: Series;
  table: DataTable;
}) {
  const defaults = defaultGaugeSettings();
  const gauge = {
    ...defaults,
    ...block.gauge,
    colors: { ...defaults.colors, ...block.gauge?.colors },
    ranges: block.gauge?.ranges ?? defaults.ranges,
  };
  // `count` counts every non-null cell of the bound field (matching the KPI
  // block), not just the cells that parsed as numbers.
  const aggregate = (values: number[], field?: string) =>
    gauge.aggregation === "count" && field
      ? countBoundValues(table, field)
      : aggregateGaugeValues(values, gauge.aggregation);
  const value = aggregate(series.values, series.field);
  const targetValues = block.targetField
    ? numericColumnValues(table, block.targetField)
    : [];
  const target = targetValues.length
    ? aggregate(targetValues, block.targetField)
    : (gauge.targetValue ?? block.kpi.targetValue);
  const min = gauge.min ?? block.chart.minY ?? 0;
  const automaticMax = Math.max(value, target ?? min, min + 1);
  const maxCandidate = gauge.max ?? block.chart.maxY ?? automaticMax * 1.12;
  const max = maxCandidate > min ? maxCandidate : min + 1;
  const progress = clamp((value - min) / Math.max(max - min, 0.000001), 0, 1);
  const targetProgress =
    target === undefined
      ? null
      : clamp((target - min) / Math.max(max - min, 0.000001), 0, 1);
  const cx = 180;
  const cy = 112;
  const radius = 88;
  const arc = `M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`;
  const targetAngle =
    targetProgress === null ? null : -90 + targetProgress * 180;
  const targetInner =
    targetAngle === null
      ? null
      : polarPoint(cx, cy, radius - gauge.arcWidth / 2 - 5, targetAngle);
  const targetOuter =
    targetAngle === null
      ? null
      : polarPoint(cx, cy, radius + gauge.arcWidth / 2 + 7, targetAngle);
  const needleAngle = -90 + progress * 180;
  const needleEnd = polarPoint(
    cx,
    cy,
    radius - gauge.arcWidth / 2 - 8,
    needleAngle,
  );
  const visibleRanges = gauge.ranges.filter(
    (range) => range.to > min && range.from < max,
  );
  const percentOfTarget =
    target === undefined || target === 0 ? null : (value / target) * 100;
  return (
    <svg
      className="gauge-chart"
      viewBox="55 5 250 195"
      role="img"
      aria-label={`${block.title} gauge, ${formatChartValue(block, value)}${target === undefined ? "" : `, target ${formatChartValue(block, target)}`}`}
    >
      <path
        data-gauge-element="track"
        d={arc}
        pathLength="100"
        fill="none"
        stroke={gauge.colors.track}
        strokeWidth={gauge.arcWidth}
        strokeLinecap={gauge.roundedEnds ? "round" : "butt"}
      />
      {visibleRanges.map((range) => {
        const start = clamp((range.from - min) / (max - min), 0, 1);
        const end = clamp((range.to - min) / (max - min), 0, 1);
        const rangeArcWidth = gauge.display === "dial" ? gauge.arcWidth : 7;
        const rangeRadius = gauge.display === "dial" ? radius : radius + 17;
        const rangeArc = `M ${cx - rangeRadius} ${cy} A ${rangeRadius} ${rangeRadius} 0 0 1 ${cx + rangeRadius} ${cy}`;
        return (
          <path
            key={range.id}
            data-gauge-element="range"
            data-gauge-range-id={range.id}
            d={rangeArc}
            pathLength="100"
            fill="none"
            stroke={range.color}
            strokeWidth={rangeArcWidth}
            strokeLinecap={gauge.roundedEnds ? "round" : "butt"}
            strokeDasharray={`${Math.max(0, end - start) * 100} 100`}
            strokeDashoffset={-start * 100}
            opacity={block.chart.seriesOpacity}
          />
        );
      })}
      {gauge.display === "progress" && (
        <path
          data-gauge-element="value"
          d={arc}
          pathLength="100"
          fill="none"
          stroke={gauge.colors.value}
          strokeWidth={gauge.arcWidth}
          strokeLinecap={gauge.roundedEnds ? "round" : "butt"}
          strokeDasharray={`${progress * 100} 100`}
          opacity={block.chart.seriesOpacity}
        />
      )}
      {gauge.display === "dial" && (
        <g data-gauge-element="needle">
          <line
            x1={cx}
            y1={cy}
            x2={needleEnd.x}
            y2={needleEnd.y}
            stroke={gauge.colors.needle}
            strokeWidth="4"
            strokeLinecap="round"
          />
          <circle cx={cx} cy={cy} r="8" fill={gauge.colors.needle} />
          <circle cx={cx} cy={cy} r="3" fill="#ffffff" />
        </g>
      )}
      {gauge.showTarget && targetInner && targetOuter && (
        <line
          data-gauge-element="target"
          x1={targetInner.x}
          y1={targetInner.y}
          x2={targetOuter.x}
          y2={targetOuter.y}
          stroke={gauge.colors.target}
          strokeWidth="4"
          strokeLinecap="round"
        />
      )}
      {gauge.showValue && (
        <text x={cx} y="136" textAnchor="middle" className="gauge-value">
          {formatChartValue(block, value)}
        </text>
      )}
      <text x={cx} y="156" textAnchor="middle" className="gauge-caption">
        {gauge.valueLabel || block.valueField}
      </text>
      {gauge.showTarget && target !== undefined && (
        <text
          x={cx}
          y="174"
          textAnchor="middle"
          className="gauge-caption"
          fill={gauge.colors.target}
          data-gauge-element="target-label"
        >
          {gauge.targetLabel || "Target"} {formatChartValue(block, target)}
        </text>
      )}
      {gauge.showPercentOfTarget && percentOfTarget !== null && (
        <text x={cx} y="190" textAnchor="middle" className="chart-axis-label">
          {percentOfTarget.toFixed(0)}% of target
        </text>
      )}
      {gauge.showScaleLabels && (
        <>
          <text x="75" y="126" textAnchor="middle" className="chart-axis-label">
            {formatChartValue(block, min)}
          </text>
          <text
            x="285"
            y="126"
            textAnchor="middle"
            className="chart-axis-label"
          >
            {formatChartValue(block, max)}
          </text>
        </>
      )}
      {gauge.showRangeLabels &&
        visibleRanges.map((range) => {
          const midpoint = clamp(
            ((range.from + range.to) / 2 - min) / (max - min),
            0,
            1,
          );
          const point = polarPoint(cx, cy, radius + 31, -90 + midpoint * 180);
          return range.label ? (
            <text
              key={`${range.id}-label`}
              x={point.x}
              y={point.y}
              textAnchor="middle"
              className="chart-axis-label"
              fill={range.color}
              data-gauge-range-label={range.id}
            >
              {range.label}
            </text>
          ) : null;
        })}
    </svg>
  );
}

function aggregateGaugeValues(
  values: number[],
  aggregation: DashboardBlock["gauge"]["aggregation"],
) {
  if (!values.length) return 0;
  if (aggregation === "sum") return values.reduce((sum, item) => sum + item, 0);
  if (aggregation === "minimum") return Math.min(...values);
  if (aggregation === "maximum") return Math.max(...values);
  if (aggregation === "count") return values.length;
  if (aggregation === "first") return values[0];
  if (aggregation === "last") return values[values.length - 1];
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

function numericColumnValues(table: DataTable, field: string) {
  const index = table.columns.indexOf(field);
  if (index < 0) return [];
  return table.rows
    .map((row) => numericValue(row[index]))
    .filter((value): value is number => value !== null);
}

/** Number of rows whose bound field holds a value (not null/undefined/""). */
export function countBoundValues(table: DataTable, field: string) {
  const index = table.columns.indexOf(field);
  if (index < 0) return 0;
  return table.rows.filter((row) => {
    const value = row[index];
    return value !== null && value !== undefined && value !== "";
  }).length;
}

function Scatter({
  block,
  table,
}: {
  block: DashboardBlock;
  table: DataTable;
}) {
  const xIndex = table.columns.indexOf(block.categoryField ?? "");
  const yIndex = table.columns.indexOf(
    block.valueField ?? block.valueFields[0] ?? "",
  );
  const configuredLabelIndex = table.columns.indexOf(block.labelField ?? "");
  const labelIndex =
    configuredLabelIndex >= 0
      ? configuredLabelIndex
      : table.columns.findIndex(
          (column, index) =>
            index !== xIndex &&
            index !== yIndex &&
            !/period|date|status/i.test(column) &&
            table.rows.some(
              (row) => typeof row[index] === "string" && row[index] !== "",
            ),
        );
  const seriesIndex = table.columns.indexOf(block.seriesField ?? "");
  const points = table.rows
    .map((row, index) => ({
      x: xIndex < 0 ? null : numericValue(row[xIndex]),
      y: yIndex < 0 ? null : numericValue(row[yIndex]),
      rowIndex: index + 1,
      label:
        labelIndex < 0
          ? `Record ${index + 1}`
          : String(row[labelIndex] ?? `Record ${index + 1}`),
      series: seriesIndex < 0 ? "" : String(row[seriesIndex] ?? "Unspecified"),
    }))
    .filter(
      (
        point,
      ): point is {
        x: number;
        y: number;
        rowIndex: number;
        label: string;
        series: string;
      } => point.x !== null && point.y !== null,
    );
  if (!points.length)
    return <div className="chart-empty">Bind two numeric fields.</div>;
  const series = [
    ...new Set(points.map((point) => point.series).filter(Boolean)),
  ];
  const clipId = `scatter-clip-${block.id.replace(/[^a-z0-9]/gi, "-")}`;
  const xFormat = block.chart.xValueFormat ?? "auto";
  const xDecimals = block.chart.xDecimalPlaces ?? 1;
  const formatX = (value: number) => formatValue(value, xFormat, xDecimals);
  return (
    <>
      <ResponsiveChart label={`${block.title} scatter chart`}>
        {(width, height) => {
          const plotW = width - M.left - M.right;
          const plotH = height - M.top - M.bottom;
          const [minX, maxX] = scatterDomain(
            points.map((point) => point.x),
            block.chart.minX,
            block.chart.maxX,
            block.chart.scatterIncludeZero ?? false,
          );
          const [minY, maxY] = scatterDomain(
            points.map((point) => point.y),
            block.chart.minY,
            block.chart.maxY,
            block.chart.scatterIncludeZero ?? false,
          );
          const x = (value: number) =>
            M.left + ((value - minX) / (maxX - minX)) * plotW;
          const y = (value: number) =>
            M.top + plotH - ((value - minY) / (maxY - minY)) * plotH;
          const xTicks = scatterTicks(minX, maxX);
          const yTicks = scatterTicks(minY, maxY);
          const trend = scatterTrend(points, minX, maxX);
          const styledPoints = points.map((point) => {
            const rowOverride = (block.chart.scatterPointStyles ?? []).find(
              (style) => style.rowIndex === point.rowIndex,
            );
            const labelOverride = (block.chart.scatterPointStyles ?? []).find(
              (style) =>
                style.rowIndex === undefined && style.label === point.label,
            );
            const override = rowOverride ?? labelOverride;
            const seriesPosition = point.series
              ? Math.max(0, series.indexOf(point.series))
              : 0;
            return {
              ...point,
              screenX: x(point.x),
              screenY: y(point.y),
              color: override?.color ?? scatterColor(block, seriesPosition),
              size: override?.size ?? block.chart.scatterPointSize ?? 6,
              shape:
                override?.shape ?? block.chart.scatterPointShape ?? "circle",
              opacity: override?.opacity ?? block.chart.seriesOpacity ?? 1,
            };
          });
          const labelPlacements = placeScatterLabels(styledPoints, {
            left: M.left,
            right: M.left + plotW,
            top: M.top,
            bottom: M.top + plotH,
          });
          return (
            <>
              <defs>
                <clipPath id={clipId}>
                  <rect x={M.left} y={M.top} width={plotW} height={plotH} />
                </clipPath>
              </defs>
              {xTicks.map((tick) => (
                <g key={`x-${tick}`}>
                  {block.chart.showGridlines && (
                    <line
                      className="chart-grid"
                      x1={x(tick)}
                      x2={x(tick)}
                      y1={M.top}
                      y2={M.top + plotH}
                    />
                  )}
                  {block.chart.showXAxis && (
                    <text
                      className="chart-axis-label"
                      x={x(tick)}
                      y={height - 20}
                      textAnchor="middle"
                    >
                      {formatX(tick)}
                    </text>
                  )}
                </g>
              ))}
              {yTicks.map((tick) => (
                <g key={`y-${tick}`}>
                  {block.chart.showGridlines && (
                    <line
                      className="chart-grid"
                      x1={M.left}
                      x2={width - M.right}
                      y1={y(tick)}
                      y2={y(tick)}
                    />
                  )}
                  {block.chart.showYAxis && (
                    <text
                      className="chart-axis-label"
                      x={M.left - 9}
                      y={y(tick) + 4}
                      textAnchor="end"
                    >
                      {formatChartValue(block, tick)}
                    </text>
                  )}
                </g>
              ))}
              <g clipPath={`url(#${clipId})`}>
                {block.chart.scatterXReferenceValue !== undefined && (
                  <line
                    className="chart-guide scatter-reference"
                    x1={x(block.chart.scatterXReferenceValue)}
                    x2={x(block.chart.scatterXReferenceValue)}
                    y1={M.top}
                    y2={M.top + plotH}
                  />
                )}
                {block.chart.scatterYReferenceValue !== undefined && (
                  <line
                    className="chart-guide scatter-reference"
                    x1={M.left}
                    x2={M.left + plotW}
                    y1={y(block.chart.scatterYReferenceValue)}
                    y2={y(block.chart.scatterYReferenceValue)}
                  />
                )}
                {block.chart.scatterShowTrendLine && trend && (
                  <line
                    data-scatter-trend="true"
                    x1={x(trend.x1)}
                    y1={y(trend.y1)}
                    x2={x(trend.x2)}
                    y2={y(trend.y2)}
                    stroke={block.chart.scatterTrendLineColor ?? "#1c2b4a"}
                    strokeWidth="2"
                    strokeDasharray="7 5"
                  />
                )}
                {styledPoints.map((point) => {
                  const placement = labelPlacements.get(point.rowIndex);
                  const aria = `${point.label}: ${formatX(point.x)} × ${formatChartValue(block, point.y)}${point.series ? `, ${point.series}` : ""}`;
                  return (
                    <g
                      key={point.rowIndex}
                      className="scatter-point"
                      data-point-label={point.label}
                      data-source-row={point.rowIndex}
                      data-series={point.series || undefined}
                      aria-label={aria}
                    >
                      <title>{aria}</title>
                      <ScatterMark
                        x={point.screenX}
                        y={point.screenY}
                        size={point.size}
                        shape={point.shape}
                        color={point.color}
                        opacity={point.opacity}
                        stroke={block.chart.scatterPointStroke ?? "#ffffff"}
                        strokeWidth={block.chart.scatterPointStrokeWidth ?? 2}
                      />
                      {block.chart.showValues && placement && (
                        <text
                          className="chart-value"
                          x={placement.x}
                          y={placement.y}
                          textAnchor={placement.textAnchor}
                        >
                          {truncate(point.label, 18)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
              {block.chart.scatterXReferenceValue !== undefined &&
                block.chart.scatterXReferenceLabel && (
                  <text
                    className="chart-axis-label"
                    x={x(block.chart.scatterXReferenceValue) + 4}
                    y={M.top + 11}
                  >
                    {block.chart.scatterXReferenceLabel}
                  </text>
                )}
              {block.chart.scatterYReferenceValue !== undefined &&
                block.chart.scatterYReferenceLabel && (
                  <text
                    className="chart-axis-label"
                    x={width - M.right - 4}
                    y={y(block.chart.scatterYReferenceValue) - 5}
                    textAnchor="end"
                  >
                    {block.chart.scatterYReferenceLabel}
                  </text>
                )}
              {block.chart.showXAxis && (
                <text
                  className="chart-axis-title"
                  x={M.left + plotW / 2}
                  y={height - 2}
                  textAnchor="middle"
                >
                  {block.chart.xAxisTitle || block.categoryField}
                </text>
              )}
              {block.chart.showYAxis && (
                <text
                  className="chart-axis-title"
                  x="12"
                  y={M.top + plotH / 2}
                  textAnchor="middle"
                  transform={`rotate(-90 12 ${M.top + plotH / 2})`}
                >
                  {block.chart.yAxisTitle || block.valueField}
                </text>
              )}
            </>
          );
        }}
      </ResponsiveChart>
      {block.chart.showLegend && block.seriesField && series.length > 0 && (
        <div className={`chart-legend is-${block.chart.legendPosition}`}>
          {series.map((name, index) => (
            <span key={name}>
              <i style={{ background: scatterColor(block, index) }} />
              {name}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

function ScatterMark({
  x,
  y,
  size,
  shape,
  color,
  opacity,
  stroke,
  strokeWidth,
}: {
  x: number;
  y: number;
  size: number;
  shape: "circle" | "square" | "diamond";
  color: string;
  opacity: number;
  stroke: string;
  strokeWidth: number;
}) {
  const common = {
    fill: color,
    fillOpacity: opacity,
    stroke,
    strokeWidth,
  };
  if (shape === "square")
    return (
      <rect
        {...common}
        x={x - size}
        y={y - size}
        width={size * 2}
        height={size * 2}
        rx={Math.min(2, size / 3)}
      />
    );
  if (shape === "diamond")
    return (
      <polygon
        {...common}
        points={`${x},${y - size * 1.25} ${x + size * 1.25},${y} ${x},${y + size * 1.25} ${x - size * 1.25},${y}`}
      />
    );
  return <circle {...common} cx={x} cy={y} r={size} />;
}

function scatterDomain(
  values: number[],
  configuredMin: number | undefined,
  configuredMax: number | undefined,
  includeZero: boolean,
): [number, number] {
  let rawMin = Math.min(...values);
  let rawMax = Math.max(...values);
  if (includeZero) {
    rawMin = Math.min(0, rawMin);
    rawMax = Math.max(0, rawMax);
  }
  const rawSpan = rawMax - rawMin || Math.max(Math.abs(rawMax), 1);
  const automaticMin = rawMin - rawSpan * 0.08;
  const automaticMax = rawMax + rawSpan * 0.08;
  const min = configuredMin ?? automaticMin;
  const max = configuredMax ?? automaticMax;
  return min < max ? [min, max] : [automaticMin, automaticMax];
}

function scatterTicks(min: number, max: number) {
  return Array.from(
    { length: 5 },
    (_, index) => min + ((max - min) * index) / 4,
  );
}

function scatterTrend(
  points: Array<{ x: number; y: number }>,
  minX: number,
  maxX: number,
) {
  if (points.length < 2) return undefined;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const denominator = points.reduce(
    (sum, point) => sum + (point.x - meanX) ** 2,
    0,
  );
  if (denominator <= Number.EPSILON) return undefined;
  const slope =
    points.reduce(
      (sum, point) => sum + (point.x - meanX) * (point.y - meanY),
      0,
    ) / denominator;
  const intercept = meanY - slope * meanX;
  return {
    x1: minX,
    y1: intercept + slope * minX,
    x2: maxX,
    y2: intercept + slope * maxX,
  };
}

function scatterColor(block: DashboardBlock, index: number) {
  const configured = block.chart.colors[index % block.chart.colors.length];
  return /^#[0-9a-f]{6}$/i.test(configured ?? "")
    ? configured
    : BLUE_CHART_PALETTE[index % BLUE_CHART_PALETTE.length];
}

type ScatterLabelPoint = {
  rowIndex: number;
  label: string;
  screenX: number;
  screenY: number;
  size: number;
};

type ScatterLabelBox = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type ScatterLabelPlacement = ScatterLabelBox & {
  x: number;
  y: number;
  textAnchor: "start" | "middle" | "end";
};

function placeScatterLabels(
  points: ScatterLabelPoint[],
  bounds: ScatterLabelBox,
) {
  const placements = new Map<number, ScatterLabelPlacement>();
  const alternatives = new Map<number, ScatterLabelPlacement[]>();
  const occupied: ScatterLabelBox[] = [];
  const pointBoxes = points.map((point) => ({
    rowIndex: point.rowIndex,
    left: point.screenX - point.size - 2,
    right: point.screenX + point.size + 2,
    top: point.screenY - point.size - 2,
    bottom: point.screenY + point.size + 2,
  }));

  points.forEach((point) => {
    const text = truncate(point.label, 18);
    // Estimated from the 11px label font, padded so near misses on screen
    // still count as collisions.
    const width = Math.max(26, text.length * 6.6 + 4);
    const height = 14;
    const gap = point.size + 5;
    const horizontalPreference =
      point.screenX - bounds.left < width / 2 + 4
        ? "right"
        : bounds.right - point.screenX < width / 2 + 4
          ? "left"
          : "center";
    const verticalPreference =
      point.screenY - bounds.top < height + gap ? "below" : "above";
    const candidates = scatterLabelCandidates(
      point.screenX,
      point.screenY,
      width,
      height,
      gap,
      horizontalPreference,
      verticalPreference,
    );
    const scored = candidates.map((candidate, preference) => {
      const outside =
        Math.max(0, bounds.left + 2 - candidate.left) +
        Math.max(0, candidate.right - bounds.right + 2) +
        Math.max(0, bounds.top + 2 - candidate.top) +
        Math.max(0, candidate.bottom - bounds.bottom + 2);
      const labelOverlap = occupied.reduce(
        (sum, box) => sum + overlapArea(candidate, box),
        0,
      );
      const pointOverlap = pointBoxes.reduce(
        (sum, box) =>
          box.rowIndex === point.rowIndex
            ? sum
            : sum + overlapArea(candidate, box),
        0,
      );
      return {
        candidate,
        score:
          outside * 10000 + labelOverlap * 120 + pointOverlap * 18 + preference,
      };
    });
    const ranked = scored
      .sort((a, b) => a.score - b.score)
      .map(({ candidate }) => candidate);
    placements.set(point.rowIndex, ranked[0]);
    occupied.push(ranked[0]);
    alternatives.set(point.rowIndex, ranked);
  });

  // Greedy placement can still leave two labels touching once every point is
  // in. Revisit each label a few times and move it to its best alternative
  // whenever it overlaps another label, until nothing overlaps or nothing moves.
  for (let pass = 0; pass < 4; pass += 1) {
    let moved = false;
    points.forEach((point) => {
      const current = placements.get(point.rowIndex);
      const options = alternatives.get(point.rowIndex);
      if (!current || !options) return;
      const others = points
        .filter((other) => other.rowIndex !== point.rowIndex)
        .map((other) => placements.get(other.rowIndex))
        .filter((box): box is ScatterLabelPlacement => Boolean(box));
      const overlapWithOthers = (box: ScatterLabelBox) =>
        others.reduce((sum, other) => sum + overlapArea(box, other), 0);
      if (overlapWithOthers(current) === 0) return;
      const better = options.find(
        (option) =>
          overlapWithOthers(option) === 0 &&
          option.left >= bounds.left &&
          option.right <= bounds.right &&
          option.top >= bounds.top &&
          option.bottom <= bounds.bottom,
      );
      if (better && better !== current) {
        placements.set(point.rowIndex, better);
        moved = true;
      }
    });
    if (!moved) break;
  }
  return placements;
}

function scatterLabelCandidates(
  x: number,
  y: number,
  width: number,
  height: number,
  gap: number,
  horizontalPreference: "left" | "center" | "right",
  verticalPreference: "above" | "below",
): ScatterLabelPlacement[] {
  const placement = (
    nextX: number,
    baselineY: number,
    textAnchor: ScatterLabelPlacement["textAnchor"],
  ): ScatterLabelPlacement => {
    const left =
      textAnchor === "start"
        ? nextX
        : textAnchor === "end"
          ? nextX - width
          : nextX - width / 2;
    return {
      x: nextX,
      y: baselineY,
      textAnchor,
      left,
      right: left + width,
      top: baselineY - height + 2,
      bottom: baselineY + 3,
    };
  };
  const above = y - gap;
  const below = y + gap + height - 2;
  const centered = y + 4;
  const preferredVertical = verticalPreference === "above" ? above : below;
  const oppositeVertical = verticalPreference === "above" ? below : above;
  const sideCandidates =
    horizontalPreference === "right"
      ? [
          placement(x + gap, centered, "start"),
          placement(x - gap, centered, "end"),
        ]
      : horizontalPreference === "left"
        ? [
            placement(x - gap, centered, "end"),
            placement(x + gap, centered, "start"),
          ]
        : [
            placement(x + gap, centered, "start"),
            placement(x - gap, centered, "end"),
          ];
  return [
    ...(horizontalPreference === "center"
      ? [placement(x, preferredVertical, "middle")]
      : sideCandidates.slice(0, 1)),
    ...sideCandidates,
    placement(x, preferredVertical, "middle"),
    placement(x, oppositeVertical, "middle"),
    placement(x + gap, preferredVertical, "start"),
    placement(x - gap, preferredVertical, "end"),
    placement(x + gap, oppositeVertical, "start"),
    placement(x - gap, oppositeVertical, "end"),
    placement(x, above - height, "middle"),
    placement(x, below + height, "middle"),
    placement(x + gap * 2, centered, "start"),
    placement(x - gap * 2, centered, "end"),
  ];
}

function overlapArea(a: ScatterLabelBox, b: ScatterLabelBox) {
  return (
    Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
  );
}

function Treemap({
  block,
  labels,
  series,
}: {
  block: DashboardBlock;
  labels: string[];
  series: Series;
}) {
  const entries = labels
    .map((label, index) => {
      const style = block.chart.treemapTileStyles.find(
        (candidate) => candidate.category === label,
      );
      return {
        label,
        value: Math.max(0, series.values[index] ?? 0),
        color: style?.color ?? chartColor(block, index),
        textColor: style?.textColor,
        opacity: style?.opacity ?? 0.9 * block.chart.seriesOpacity,
      };
    })
    .filter((entry) => entry.value > 0);
  if (!entries.length)
    return <div className="chart-empty">No positive values to size tiles</div>;
  return (
    <ResponsiveChart label={`${block.title} treemap`}>
      {(chartWidth, chartHeight) => {
        const rects = layoutTreemap(
          entries,
          4,
          4,
          chartWidth - 8,
          chartHeight - 8,
        );
        return rects.map((rect, index) => {
          const gap = Math.min(12, block.chart.barRadius);
          const width = Math.max(1, rect.width - gap);
          const height = Math.max(1, rect.height - gap);
          const inset = Math.max(8, Math.min(12, width * 0.08));
          const labelColor =
            rect.textColor ?? chartTextColor(rect.color, rect.opacity);
          return (
            <g key={`${rect.label}-${index}`}>
              <rect
                data-category={rect.label}
                x={rect.x + gap / 2}
                y={rect.y + gap / 2}
                width={width}
                height={height}
                rx="7"
                fill={rect.color}
                opacity={rect.opacity}
              />
              {width > 70 && height > 38 && (
                <>
                  <text
                    className="treemap-label"
                    x={rect.x + inset}
                    y={rect.y + 21}
                    style={{ fill: labelColor }}
                  >
                    {truncate(
                      rect.label,
                      Math.max(7, Math.floor((width - inset * 2) / 6.5)),
                    )}
                  </text>
                  {block.chart.showValues && height > 42 && (
                    <text
                      className="treemap-value"
                      x={rect.x + inset}
                      y={rect.y + 39}
                      style={{ fill: labelColor }}
                    >
                      {formatChartValue(block, rect.value)}
                    </text>
                  )}
                </>
              )}
            </g>
          );
        });
      }}
    </ResponsiveChart>
  );
}

function Heatmap({
  block,
  labels,
  rowIndexes,
  series,
}: {
  block: DashboardBlock;
  labels: string[];
  rowIndexes: number[];
  series: Series[];
}) {
  return (
    <ResponsiveChart label={`${block.title} heatmap`}>
      {(width, height) => {
        const left = block.chart.showYAxis
          ? Math.min(142, Math.max(108, width * 0.3))
          : 12;
        const top = block.chart.showXAxis ? 42 : 10;
        const right = 12;
        const bottom = block.chart.showLegend ? 42 : 10;
        const cellWidth = (width - left - right) / Math.max(series.length, 1);
        const cellHeight = (height - top - bottom) / Math.max(labels.length, 1);
        const gap = clamp(block.chart.heatmapCellGap ?? 3, 0, 12);
        const allValues = series.flatMap((item, column) =>
          item.values.flatMap((value, row) =>
            item.missing[row] ? [] : [{ value, row, column }],
          ),
        );
        const globalValues = allValues.map((item) => item.value);
        const globalDomain = heatmapDomain(block, globalValues);
        const gradient = gradientId(block, "heatmap-scale");
        const lowColor = block.chart.heatmapReverse
          ? (block.chart.heatmapMaxColor ?? "#1c2b4a")
          : (block.chart.heatmapMinColor ?? "#edf4fb");
        const highColor = block.chart.heatmapReverse
          ? (block.chart.heatmapMinColor ?? "#edf4fb")
          : (block.chart.heatmapMaxColor ?? "#1c2b4a");
        return (
          <>
            <defs>
              <linearGradient id={gradient} x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor={lowColor} />
                {block.chart.heatmapScaleType === "diverging" && (
                  <stop
                    offset="50%"
                    stopColor={block.chart.heatmapMidColor ?? "#7897c4"}
                  />
                )}
                <stop offset="100%" stopColor={highColor} />
              </linearGradient>
            </defs>
            {block.chart.showXAxis &&
              series.map((item, column) => (
                <text
                  key={item.field}
                  className="heatmap-heading"
                  x={left + column * cellWidth + cellWidth / 2}
                  y="25"
                  textAnchor="middle"
                  style={SVG_LABEL_STYLE}
                >
                  {truncate(item.field, Math.max(6, Math.floor(cellWidth / 7)))}
                </text>
              ))}
            {labels.map((label, row) => (
              <g key={`${label}-${row}`}>
                {block.chart.showYAxis && (
                  <text
                    className="heatmap-row-label"
                    x={left - 10}
                    y={top + row * cellHeight + cellHeight / 2 + 4}
                    textAnchor="end"
                    style={SVG_LABEL_STYLE}
                  >
                    {truncate(label, Math.max(15, Math.floor(left / 6.5)))}
                  </text>
                )}
                {series.map((item, column) => {
                  const value = item.values[row] ?? 0;
                  const missing = item.missing[row] ?? true;
                  const scopeValues =
                    block.chart.heatmapScaleScope === "row"
                      ? series
                          .filter((candidate) => !candidate.missing[row])
                          .map((candidate) => candidate.values[row])
                      : block.chart.heatmapScaleScope === "column"
                        ? item.values.filter((_, index) => !item.missing[index])
                        : globalValues;
                  const domain = heatmapDomain(block, scopeValues);
                  const override = heatmapCellStyle(
                    block,
                    label,
                    (rowIndexes[row] ?? row) + 1,
                    item.field,
                  );
                  const fill =
                    override?.color ??
                    (missing
                      ? (block.chart.heatmapMissingColor ?? "#e8edf3")
                      : heatmapColor(block, value, domain));
                  const cellOpacity = block.chart.seriesOpacity;
                  return (
                    <g
                      key={`${item.field}-${row}`}
                      data-heatmap-row={label}
                      data-heatmap-row-index={(rowIndexes[row] ?? row) + 1}
                      data-heatmap-column={item.field}
                      data-heatmap-value={missing ? "missing" : value}
                      data-custom-color={override?.color ?? undefined}
                    >
                      <title>
                        {label} · {item.field}:{" "}
                        {missing ? "Missing" : formatChartValue(block, value)}
                      </title>
                      <rect
                        x={left + column * cellWidth + gap / 2}
                        y={top + row * cellHeight + gap / 2}
                        width={Math.max(1, cellWidth - gap)}
                        height={Math.max(1, cellHeight - gap)}
                        rx={Math.min(
                          block.chart.heatmapCellRadius ?? 5,
                          Math.max(0, (cellHeight - gap) / 2),
                        )}
                        fill={fill}
                        opacity={cellOpacity}
                        stroke={block.chart.showGridlines ? "#ffffff" : "none"}
                        strokeWidth={block.chart.showGridlines ? 1 : 0}
                      />
                      {block.chart.showValues && !missing && (
                        <text
                          className="heatmap-value"
                          x={left + column * cellWidth + cellWidth / 2}
                          y={top + row * cellHeight + cellHeight / 2 + 4}
                          textAnchor="middle"
                          style={{
                            ...SVG_VALUE_STYLE,
                            fill:
                              override?.textColor ??
                              chartTextColor(fill, cellOpacity),
                          }}
                        >
                          {formatChartValue(block, value)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            ))}
            {block.chart.showLegend && (
              <g className="heatmap-legend">
                <text x={left} y={height - 8} style={SVG_LABEL_STYLE}>
                  {(block.chart.heatmapScaleScope ?? "global") === "global"
                    ? formatChartValue(block, globalDomain.min)
                    : "Low"}
                </text>
                <rect
                  x={left + 42}
                  y={height - 20}
                  width={Math.max(70, Math.min(180, width - left - right - 88))}
                  height="10"
                  rx="5"
                  fill={`url(#${gradient})`}
                />
                <text
                  x={Math.min(width - right, left + 236)}
                  y={height - 8}
                  textAnchor="end"
                  style={SVG_LABEL_STYLE}
                >
                  {(block.chart.heatmapScaleScope ?? "global") === "global"
                    ? formatChartValue(block, globalDomain.max)
                    : "High"}
                </text>
              </g>
            )}
          </>
        );
      }}
    </ResponsiveChart>
  );
}

interface FlowLink {
  source: string;
  target: string;
  value: number;
}

interface FlowNode {
  name: string;
  level: number;
  inbound: number;
  outbound: number;
}

function Sankey({ block, table }: { block: DashboardBlock; table: DataTable }) {
  const links = flowLinks(block, table);
  if (!links.length)
    return (
      <div className="chart-empty">Bind source, target, and value fields.</div>
    );
  const topology = flowTopology(links);
  const highlighted = new Set(block.chart.highlightNodes);
  const columns = topology.columns.map((column) => [...column]);
  const orderIndex = () =>
    new Map(
      columns.flatMap((column) =>
        column.map((node, index) => [node.name, index] as const),
      ),
    );
  const neighborCenter = (
    node: FlowNode,
    direction: "incoming" | "outgoing",
    indexes: Map<string, number>,
  ) => {
    const neighbors = links.filter((link) =>
      direction === "incoming"
        ? link.target === node.name
        : link.source === node.name,
    );
    const total = neighbors.reduce((sum, link) => sum + link.value, 0) || 1;
    return neighbors.reduce(
      (sum, link) =>
        sum +
        (indexes.get(direction === "incoming" ? link.source : link.target) ??
          0) *
          (link.value / total),
      0,
    );
  };

  // A few forward/backward barycentric passes keep related branches together
  // without baking any Northstar-specific warehouse ordering into the chart.
  for (let pass = 0; pass < 4; pass += 1) {
    for (let level = 1; level < columns.length; level += 1) {
      const indexes = orderIndex();
      columns[level].sort(
        (a, b) =>
          neighborCenter(a, "incoming", indexes) -
            neighborCenter(b, "incoming", indexes) ||
          a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
    }
    for (let level = columns.length - 2; level >= 0; level -= 1) {
      const indexes = orderIndex();
      columns[level].sort(
        (a, b) =>
          neighborCenter(a, "outgoing", indexes) -
            neighborCenter(b, "outgoing", indexes) ||
          a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
    }
  }

  const nodeSort = block.chart.sankeyNodeSort ?? "auto";
  if (nodeSort !== "auto") {
    columns.forEach((column) =>
      column.sort((a, b) =>
        nodeSort === "name"
          ? a.name.localeCompare(b.name, undefined, { numeric: true })
          : Math.max(b.inbound, b.outbound) - Math.max(a.inbound, a.outbound) ||
            a.name.localeCompare(b.name, undefined, { numeric: true }),
      ),
    );
  }

  const palette = sankeyPalette(block);
  const nodeColors = new Map<string, string>();
  if (topology.maxLevel === 1) {
    columns[0].forEach((node, index) =>
      nodeColors.set(node.name, palette[index % palette.length]),
    );
  } else {
    columns[0].forEach((node) => nodeColors.set(node.name, palette[0]));
  }
  let branchColorIndex = 1;
  columns.slice(1, -1).forEach((column) =>
    column.forEach((node) => {
      nodeColors.set(node.name, palette[branchColorIndex % palette.length]);
      branchColorIndex += 1;
    }),
  );
  columns.at(-1)?.forEach((node, index) => {
    const dominant = links
      .filter((link) => link.target === node.name)
      .sort((a, b) => b.value - a.value)[0];
    nodeColors.set(
      node.name,
      (dominant && nodeColors.get(dominant.source)) ??
        palette[index % palette.length],
    );
  });
  // Keep automatic link colors independent from node-only exceptions. This
  // makes a request such as “make Warehouse C purple” truly surgical.
  const linkNodeColors = new Map(nodeColors);
  const nodeOverrides = new Map(
    (block.chart.sankeyNodeOverrides ?? []).map((override) => [
      override.node,
      override,
    ]),
  );
  nodeOverrides.forEach((override, node) => {
    if (override.color) nodeColors.set(node, override.color.toLowerCase());
  });
  const linkOverrides = new Map(
    (block.chart.sankeyLinkOverrides ?? []).map((override) => [
      `${override.source}\u0000${override.target}`,
      override,
    ]),
  );
  const totalFlow =
    columns[0]?.reduce((sum, node) => sum + node.outbound, 0) || 1;

  return (
    <ResponsiveChart label={`${block.title} Sankey chart`}>
      {(width, height) => {
        const plotLeft = Math.max(122, Math.min(152, width * 0.23));
        const rightGutter = Math.max(82, Math.min(112, width * 0.16));
        const plotRight = width - rightGutter;
        const top = 48;
        const bottom = height - 22;
        const availableHeight = Math.max(80, bottom - top);
        const maxColumnLength = Math.max(
          ...columns.map((column) => column.length),
          1,
        );
        const nodeGap = Math.min(
          block.chart.sankeyNodeGap,
          maxColumnLength > 1
            ? Math.max(3, (availableHeight * 0.34) / (maxColumnLength - 1))
            : block.chart.sankeyNodeGap,
        );
        const density = clamp(
          0.56 + (block.chart.sankeyLinkThickness ?? 1) * 0.25,
          0.68,
          0.98,
        );
        const scale = Math.min(
          ...columns.map((column) => {
            const total = column.reduce(
              (sum, node) => sum + Math.max(node.inbound, node.outbound),
              0,
            );
            const gaps = Math.max(0, column.length - 1) * nodeGap;
            return total > 0
              ? Math.max(0.000001, (availableHeight * density - gaps) / total)
              : Number.POSITIVE_INFINITY;
          }),
        );
        const positions = new Map<
          string,
          {
            x: number;
            y: number;
            y0: number;
            y1: number;
            height: number;
            level: number;
          }
        >();

        columns.forEach((column, level) => {
          const x =
            topology.maxLevel === 0
              ? width / 2
              : plotLeft + (level / topology.maxLevel) * (plotRight - plotLeft);
          const heights = column.map((node) =>
            Math.max(1.5, Math.max(node.inbound, node.outbound) * scale),
          );
          const columnHeight =
            heights.reduce((sum, nodeHeight) => sum + nodeHeight, 0) +
            Math.max(0, column.length - 1) * nodeGap;
          let cursor = top + (availableHeight - columnHeight) / 2;
          column.forEach((node, index) => {
            const nodeHeight = heights[index];
            positions.set(node.name, {
              x,
              y: cursor + nodeHeight / 2,
              y0: cursor,
              y1: cursor + nodeHeight,
              height: nodeHeight,
              level,
            });
            cursor += nodeHeight + nodeGap;
          });
        });

        const sourceCursors = new Map<string, number>();
        const targetCursors = new Map<string, number>();
        topology.nodes.forEach((node) => {
          const position = positions.get(node.name);
          if (!position) return;
          sourceCursors.set(
            node.name,
            position.y0 +
              (position.height - Math.max(0, node.outbound) * scale) / 2,
          );
          targetCursors.set(
            node.name,
            position.y0 +
              (position.height - Math.max(0, node.inbound) * scale) / 2,
          );
        });
        const orderedLinks = [...links].sort(
          (a, b) =>
            (positions.get(a.source)?.y ?? 0) -
              (positions.get(b.source)?.y ?? 0) ||
            (positions.get(a.target)?.y ?? 0) -
              (positions.get(b.target)?.y ?? 0),
        );
        const ribbons = orderedLinks.map((link, index) => {
          const source = positions.get(link.source);
          const target = positions.get(link.target);
          if (!source || !target) return null;
          const thickness = Math.max(0.75, link.value * scale);
          const sourceY0 = sourceCursors.get(link.source) ?? source.y0;
          const targetY0 = targetCursors.get(link.target) ?? target.y0;
          sourceCursors.set(link.source, sourceY0 + thickness);
          targetCursors.set(link.target, targetY0 + thickness);
          const startX = source.x + block.chart.sankeyNodeWidth;
          const endX = target.x;
          const bend = Math.max(24, (endX - startX) * 0.5);
          const sourceY1 = sourceY0 + thickness;
          const targetY1 = targetY0 + thickness;
          const override = linkOverrides.get(
            `${link.source}\u0000${link.target}`,
          );
          const sourceColor = linkNodeColors.get(link.source) ?? palette[0];
          const targetColor = linkNodeColors.get(link.target) ?? palette[0];
          const colorMode = block.chart.sankeyLinkColorMode ?? "gradient";
          const startColor =
            override?.color ??
            (colorMode === "target" ? targetColor : sourceColor);
          const endColor =
            override?.color ??
            (colorMode === "source" ? sourceColor : targetColor);
          return {
            link,
            index,
            source,
            target,
            thickness,
            override,
            gradientId: `${gradientId(block, `sankey-${index}`)}-flow`,
            startColor,
            endColor,
            labelX: (startX + endX) / 2,
            labelY: (sourceY0 + sourceY1 + targetY0 + targetY1) / 4,
            d: [
              `M ${startX} ${sourceY0}`,
              `C ${startX + bend} ${sourceY0}, ${endX - bend} ${targetY0}, ${endX} ${targetY0}`,
              `L ${endX} ${targetY1}`,
              `C ${endX - bend} ${targetY1}, ${startX + bend} ${sourceY1}, ${startX} ${sourceY1}`,
              "Z",
            ].join(" "),
          };
        });

        return (
          <>
            <defs>
              {ribbons.map(
                (ribbon) =>
                  ribbon && (
                    <linearGradient
                      key={ribbon.gradientId}
                      id={ribbon.gradientId}
                      gradientUnits="userSpaceOnUse"
                      x1={ribbon.source.x + block.chart.sankeyNodeWidth}
                      x2={ribbon.target.x}
                      y1="0"
                      y2="0"
                    >
                      <stop offset="0%" stopColor={ribbon.startColor} />
                      <stop offset="100%" stopColor={ribbon.endColor} />
                    </linearGradient>
                  ),
              )}
            </defs>
            {(block.chart.sankeyShowStageHeaders ?? true) &&
              columns.map((column, level) => {
                const x =
                  topology.maxLevel === 0
                    ? width / 2
                    : plotLeft +
                      (level / topology.maxLevel) * (plotRight - plotLeft);
                const configuredLabel =
                  block.chart.sankeyStageLabels?.[level]?.trim();
                const stageLabel = configuredLabel
                  ? configuredLabel.toLocaleUpperCase()
                  : flowStageLabel(level, topology.maxLevel, column.length);
                return (
                  <g key={`stage-${level}`}>
                    <line
                      className="sankey-stage-rule"
                      x1={x + block.chart.sankeyNodeWidth / 2 - 18}
                      x2={x + block.chart.sankeyNodeWidth / 2 + 18}
                      y1="29"
                      y2="29"
                    />
                    <text
                      className="sankey-stage-label"
                      x={x + block.chart.sankeyNodeWidth / 2}
                      y="18"
                      textAnchor="middle"
                    >
                      {`${column.length} ${stageLabel}`}
                    </text>
                  </g>
                );
              })}
            {ribbons.map((ribbon) => {
              if (!ribbon) return null;
              const { link } = ribbon;
              const strong =
                highlighted.has(link.source) ||
                highlighted.has(link.target) ||
                nodeOverrides.get(link.source)?.highlighted === true ||
                nodeOverrides.get(link.target)?.highlighted === true ||
                ribbon.override?.highlighted === true;
              const baseOpacity =
                ribbon.override?.opacity ?? block.chart.sankeyLinkOpacity;
              return (
                <path
                  key={`${link.source}-${link.target}-${ribbon.index}`}
                  className={`sankey-link${strong ? " is-highlighted" : ""}`}
                  data-link={`${link.source}→${link.target}`}
                  data-value={link.value}
                  data-thickness={ribbon.thickness}
                  data-highlighted={String(strong)}
                  data-start-color={ribbon.startColor}
                  data-end-color={ribbon.endColor}
                  d={ribbon.d}
                  fill={`url(#${ribbon.gradientId})`}
                  opacity={
                    strong ? Math.min(0.92, baseOpacity + 0.18) : baseOpacity
                  }
                  tabIndex={0}
                  role="img"
                  aria-label={`${link.source} to ${link.target}, ${formatChartValue(block, link.value)}`}
                >
                  <title>{`${link.source} to ${link.target}: ${formatChartValue(block, link.value)}`}</title>
                </path>
              );
            })}
            {(block.chart.sankeyShowLinkValues ?? false) &&
              ribbons.map(
                (ribbon) =>
                  ribbon &&
                  ribbon.thickness >= 7 && (
                    <text
                      key={`link-label-${ribbon.link.source}-${ribbon.link.target}`}
                      className="sankey-link-label"
                      x={ribbon.labelX}
                      y={ribbon.labelY}
                      textAnchor="middle"
                      pointerEvents="none"
                    >
                      {formatChartValue(block, ribbon.link.value)}
                    </text>
                  ),
              )}
            {topology.nodes.map((node) => {
              const position = positions.get(node.name);
              if (!position) return null;
              const nodeOverride = nodeOverrides.get(node.name);
              const isHighlighted =
                highlighted.has(node.name) ||
                nodeOverride?.highlighted === true;
              const isFirst = node.level === 0;
              const isLast = node.level === topology.maxLevel;
              const downstreamCount = links.filter(
                (link) => link.source === node.name,
              ).length;
              // Middle stages count what they feed, named by the next
              // stage's own label ("· 8 stores"), or "links" when unnamed.
              const nextStage = block.chart.sankeyStageLabels[node.level + 1];
              const downstreamNoun = nextStage
                ? nextStage.trim().toLowerCase()
                : `link${downstreamCount === 1 ? "" : "s"}`;
              const labelName =
                nodeOverride?.label ??
                (!isFirst && !isLast && downstreamCount
                  ? `${node.name} · ${downstreamCount} ${downstreamNoun}`
                  : node.name);
              const labelX = isFirst
                ? position.x - 8
                : isLast
                  ? position.x + block.chart.sankeyNodeWidth + 8
                  : position.x - 14;
              const nodeValue = Math.max(node.inbound, node.outbound);
              const labelValue = block.chart.showValues
                ? [
                    formatChartValue(block, nodeValue),
                    (block.chart.sankeyShowShares ?? true)
                      ? `${Math.round((nodeValue / totalFlow) * 100)}%`
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "";
              const labelY = position.y - (labelValue ? 4 : 0);
              const displayLabel = truncate(labelName, isLast ? 13 : 28);
              return (
                <g
                  key={node.name}
                  className={`network-node${isHighlighted ? " is-highlighted" : ""}`}
                  data-node={node.name}
                  data-layer={node.level}
                  tabIndex={0}
                  role="img"
                  aria-label={`${node.name}, ${formatChartValue(block, Math.max(node.inbound, node.outbound))} routed`}
                >
                  <rect
                    className="sankey-node"
                    x={position.x}
                    y={position.y0}
                    width={block.chart.sankeyNodeWidth}
                    height={position.height}
                    rx="1.5"
                    fill={nodeColors.get(node.name) ?? palette[0]}
                    data-color={nodeColors.get(node.name) ?? palette[0]}
                  />
                  {(block.chart.sankeyShowNodeLabels ?? true) && (
                    <text
                      className="sankey-label"
                      x={labelX}
                      y={labelY}
                      textAnchor={isLast ? "start" : "end"}
                    >
                      <tspan className="sankey-label-name" x={labelX} dy="0">
                        {displayLabel}
                      </tspan>
                      {labelValue && (
                        <tspan
                          className="sankey-label-value"
                          x={labelX}
                          dy="11"
                        >
                          {labelValue}
                        </tspan>
                      )}
                    </text>
                  )}
                </g>
              );
            })}
          </>
        );
      }}
    </ResponsiveChart>
  );
}

function flowLinks(block: DashboardBlock, table: DataTable): FlowLink[] {
  const sourceIndex = table.columns.indexOf(block.categoryField ?? "");
  const targetIndex = table.columns.indexOf(block.targetField ?? "");
  const valueIndex = table.columns.indexOf(
    block.valueField ?? block.valueFields[0] ?? "",
  );
  if (sourceIndex < 0 || targetIndex < 0 || valueIndex < 0) return [];
  const rows = table.rows
    .map((row) => ({
      source: String(row[sourceIndex] ?? ""),
      target: String(row[targetIndex] ?? ""),
      value:
        typeof row[valueIndex] === "number"
          ? row[valueIndex]
          : Number(row[valueIndex]) || 0,
    }))
    .filter((link) => link.source && link.target && link.value > 0);
  const aggregated = new Map<string, FlowLink>();
  rows.forEach((link) => {
    const key = `${link.source}\u0000${link.target}`;
    const current = aggregated.get(key);
    aggregated.set(key, {
      ...link,
      value: link.value + (current?.value ?? 0),
    });
  });
  return [...aggregated.values()];
}

function flowTopology(links: FlowLink[]) {
  const names = [
    ...new Set(links.flatMap((link) => [link.source, link.target])),
  ];
  const levels = new Map(names.map((name) => [name, 0]));
  for (let pass = 0; pass < names.length; pass += 1) {
    let changed = false;
    links.forEach((link) => {
      const next = Math.min(
        names.length - 1,
        (levels.get(link.source) ?? 0) + 1,
      );
      if (next > (levels.get(link.target) ?? 0)) {
        levels.set(link.target, next);
        changed = true;
      }
    });
    if (!changed) break;
  }
  const inbound = new Map(names.map((name) => [name, 0]));
  const outbound = new Map(names.map((name) => [name, 0]));
  links.forEach((link) => {
    inbound.set(link.target, (inbound.get(link.target) ?? 0) + link.value);
    outbound.set(link.source, (outbound.get(link.source) ?? 0) + link.value);
  });
  const nodes: FlowNode[] = names.map((name) => ({
    name,
    level: levels.get(name) ?? 0,
    inbound: inbound.get(name) ?? 0,
    outbound: outbound.get(name) ?? 0,
  }));
  const maxLevel = Math.max(...nodes.map((node) => node.level), 0);
  const columns = Array.from({ length: maxLevel + 1 }, (_, level) =>
    nodes
      .filter((node) => node.level === level)
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      ),
  );
  return { nodes, columns, maxLevel };
}

function flowStageLabel(level: number, maxLevel: number, count: number) {
  const plural = (single: string) => `${single}${count === 1 ? "" : "S"}`;
  if (level === 0) return plural("SOURCE");
  if (level === maxLevel) return plural("DESTINATION");
  return `STAGE ${level + 1}`;
}

function sankeyPalette(block: DashboardBlock) {
  const configured = block.chart.colors
    .map((color) => color.toLowerCase())
    .filter((color) => /^#[0-9a-f]{6}$/.test(color));
  return configured.length ? configured : [...DEFAULT_SANKEY_COLORS];
}

function prepare(table: DataTable | undefined, block: DashboardBlock) {
  if (!table) return { labels: [], rowIndexes: [], series: [] as Series[] };
  const category = table.columns.indexOf(
    block.categoryField ?? table.columns[0],
  );
  const fields = block.valueFields.length
    ? block.valueFields
    : block.valueField
      ? [block.valueField]
      : [];
  const fieldIndexes = fields.map((field) => table.columns.indexOf(field));
  const rowIndexes = table.rows
    .map((_, index) => index)
    .filter((rowIndex) =>
      fieldIndexes.some(
        (column) =>
          column >= 0 && numericValue(table.rows[rowIndex][column]) !== null,
      ),
    );
  const entries = rowIndexes.map((rowIndex) => ({
    rowIndex,
    label: String(table.rows[rowIndex][category] ?? rowIndex + 1),
  }));
  if (
    block.chart.sortOrder !== "source" &&
    !["line", "sankey", "scatter"].includes(block.type)
  ) {
    entries.sort((a, b) => {
      const rowScore = (rowIndex: number) => {
        const values = fieldIndexes
          .map((column) =>
            column < 0 ? null : numericValue(table.rows[rowIndex][column]),
          )
          .filter((value): value is number => value !== null);
        return values.length
          ? values.reduce((sum, value) => sum + value, 0) / values.length
          : 0;
      };
      const left = rowScore(a.rowIndex);
      const right = rowScore(b.rowIndex);
      return block.chart.sortOrder === "ascending"
        ? left - right
        : right - left;
    });
  }
  const labels = entries.map((entry) => entry.label);
  const preparedRowIndexes = entries.map((entry) => entry.rowIndex);
  const series = fields
    .map((field, index) => {
      const column = table.columns.indexOf(field);
      if (column < 0) return null;
      return {
        field,
        color: chartColor(block, index),
        values: entries.map(({ rowIndex }) => {
          const value = numericValue(table.rows[rowIndex][column]);
          return value ?? 0;
        }),
        missing: entries.map(
          ({ rowIndex }) => numericValue(table.rows[rowIndex][column]) === null,
        ),
      };
    })
    .filter((item): item is Series => item !== null);
  return { labels, rowIndexes: preparedRowIndexes, series };
}

function numericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function referenceLines(block: DashboardBlock, values: number[]) {
  if (!values.length) return [];
  const lines: Array<{ label: string; value: number }> = [];
  if (block.chart.showAverageLine)
    lines.push({
      label: "Average",
      value: values.reduce((sum, value) => sum + value, 0) / values.length,
    });
  if (block.chart.showMinLine)
    lines.push({ label: "Minimum", value: Math.min(...values) });
  if (block.chart.showMaxLine)
    lines.push({ label: "Maximum", value: Math.max(...values) });
  if (block.chart.showReferenceLine && block.chart.referenceValue !== undefined)
    lines.push({
      label: block.chart.referenceLabel || "Reference",
      value: block.chart.referenceValue,
    });
  return lines;
}

function positionReferenceLabels(
  references: Array<{ label: string; value: number }>,
  y: (value: number) => number,
  plotTop: number,
  plotBottom: number,
  plotWidth: number,
  block: DashboardBlock,
) {
  const positioned = references
    .map((line) => {
      const text = `${line.label} · ${formatChartValue(block, line.value)}`;
      const lineY = y(line.value);
      return {
        ...line,
        text,
        lineY,
        labelY: clamp(lineY - 5, plotTop + 12, plotBottom - 4),
        labelWidth: Math.min(plotWidth, Math.max(48, text.length * 5.8 + 12)),
      };
    })
    .sort((left, right) => left.lineY - right.lineY);

  positioned.forEach((line, index) => {
    if (index > 0)
      line.labelY = Math.max(line.labelY, positioned[index - 1].labelY + 16);
  });
  const overflow = Math.max(
    0,
    (positioned.at(-1)?.labelY ?? plotBottom) - (plotBottom - 4),
  );
  if (overflow)
    positioned.forEach((line) => {
      line.labelY -= overflow;
    });
  return positioned;
}

function formatChartValue(block: DashboardBlock, value: number) {
  return formatValue(value, block.chart.valueFormat, block.chart.decimalPlaces);
}

function compactAxisLabels(labels: string[]) {
  const dates = labels.map((label) => /^(\d{4})-(\d{2})-(\d{2})$/.exec(label));
  if (!dates.every(Boolean)) return labels;
  const years = new Set(dates.map((match) => match?.[1]));
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return dates.map((match) => {
    const year = match?.[1] ?? "";
    const month = months[Math.max(0, Number(match?.[2] ?? 1) - 1)];
    return years.size > 1 ? `${month} ’${year.slice(2)}` : month;
  });
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

interface LineCoordinate {
  x: number;
  y: number;
  index: number;
  value: number;
}

function lineSegments(
  points: Array<LineCoordinate | null>,
  connectNulls: boolean,
) {
  if (connectNulls) return [points.filter((point) => point !== null)];
  return points.reduce<LineCoordinate[][]>((segments, point) => {
    if (!point) return segments;
    const previousMissing =
      point.index === 0 || points[point.index - 1] === null;
    if (previousMissing) segments.push([]);
    segments.at(-1)?.push(point);
    return segments;
  }, []);
}

function linePath(
  points: LineCoordinate[],
  curve: DashboardBlock["chart"]["curve"],
) {
  if (curve === "smooth") return smoothPath(points);
  if (curve === "step") return stepPath(points);
  if (!points.length) return "";
  return points
    .slice(1)
    .reduce(
      (path, point) => `${path} L ${point.x} ${point.y}`,
      `M ${points[0].x} ${points[0].y}`,
    );
}

function areaPath(
  points: LineCoordinate[],
  baseline: number,
  curve: DashboardBlock["chart"]["curve"],
) {
  if (!points.length) return "";
  const stroke = linePath(points, curve);
  return `${stroke} L ${points.at(-1)!.x} ${baseline} L ${points[0].x} ${baseline} Z`;
}

function stepPath(points: Array<{ x: number; y: number }>) {
  if (!points.length) return "";
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index];
    const midpoint = (previous.x + point.x) / 2;
    return `${path} H ${midpoint} V ${point.y} H ${point.x}`;
  }, `M ${points[0].x} ${points[0].y}`);
}

function lineDashArray(value: "solid" | "dashed" | "dotted") {
  if (value === "dashed") return "8 5";
  if (value === "dotted") return "2 5";
  return undefined;
}

function smoothPath(points: Array<{ x: number; y: number }>) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index];
    const midpoint = (previous.x + point.x) / 2;
    return `${path} C ${midpoint} ${previous.y}, ${midpoint} ${point.y}, ${point.x} ${point.y}`;
  }, `M ${points[0].x} ${points[0].y}`);
}

function gradientId(block: DashboardBlock, field: string) {
  return `chart-gradient-${block.id.replace(/[^a-z0-9]/gi, "-")}-${field.replace(/[^a-z0-9]/gi, "-")}`;
}

function chartColor(block: DashboardBlock, index: number) {
  const fallback =
    BLUE_CHART_PALETTE[Math.abs(index) % BLUE_CHART_PALETTE.length];
  if (!block.chart.colors.length) return fallback;
  const configured =
    block.chart.colors[
      Math.abs(index) % block.chart.colors.length
    ]?.toLowerCase();
  if (configured && /^#[0-9a-f]{6}$/.test(configured)) return configured;
  return fallback;
}

function validChartColor(value: string | undefined) {
  return value && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : undefined;
}

function lineSeriesColor(
  block: DashboardBlock,
  series: string,
  fallback: string,
) {
  const override = (block.chart.lineSeriesStyles ?? []).find(
    (style) => style.series === series,
  );
  return validChartColor(override?.color) ?? fallback;
}

function barColor(
  block: DashboardBlock,
  category: string,
  series: string,
  fallback: string,
) {
  const overrides = block.chart.barColorOverrides ?? [];
  const matched =
    overrides.find(
      (override) =>
        override.category === category && override.series === series,
    ) ??
    overrides.find(
      (override) =>
        override.category === category && override.series === undefined,
    );
  return matched && /^#[0-9a-f]{6}$/i.test(matched.color)
    ? matched.color.toLowerCase()
    : fallback;
}

function heatmapDomain(block: DashboardBlock, values: number[]) {
  const finite = values.filter(Number.isFinite);
  const naturalMin = finite.length ? Math.min(...finite) : 0;
  const naturalMax = finite.length ? Math.max(...finite) : 1;
  const min = block.chart.heatmapMinValue ?? naturalMin;
  const max = block.chart.heatmapMaxValue ?? naturalMax;
  return max > min ? { min, max } : { min, max: min + 1 };
}

function heatmapColor(
  block: DashboardBlock,
  value: number,
  domain: { min: number; max: number },
) {
  const low = block.chart.heatmapReverse
    ? (block.chart.heatmapMaxColor ?? "#1c2b4a")
    : (block.chart.heatmapMinColor ?? "#edf4fb");
  const high = block.chart.heatmapReverse
    ? (block.chart.heatmapMinColor ?? "#edf4fb")
    : (block.chart.heatmapMaxColor ?? "#1c2b4a");
  if (block.chart.heatmapScaleType !== "diverging") {
    const ratio = clamp((value - domain.min) / (domain.max - domain.min), 0, 1);
    return interpolateHex(low, high, ratio);
  }
  const midpoint = clamp(
    block.chart.heatmapMidpoint ?? (domain.min + domain.max) / 2,
    domain.min,
    domain.max,
  );
  if (value <= midpoint) {
    const ratio =
      midpoint === domain.min
        ? 1
        : clamp((value - domain.min) / (midpoint - domain.min), 0, 1);
    return interpolateHex(low, block.chart.heatmapMidColor ?? "#7897c4", ratio);
  }
  const ratio =
    midpoint === domain.max
      ? 1
      : clamp((value - midpoint) / (domain.max - midpoint), 0, 1);
  return interpolateHex(block.chart.heatmapMidColor ?? "#7897c4", high, ratio);
}

function heatmapCellStyle(
  block: DashboardBlock,
  rowLabel: string,
  rowIndex: number,
  column: string,
) {
  const styles = block.chart.heatmapCellStyles ?? [];
  return (
    styles.find(
      (style) => style.column === column && style.rowIndex === rowIndex,
    ) ??
    styles.find(
      (style) =>
        style.column === column &&
        style.rowIndex === undefined &&
        style.rowLabel === rowLabel,
    )
  );
}

function interpolateHex(start: string, end: string, ratio: number) {
  const left = hexToRgb(start) ?? [237, 244, 251];
  const right = hexToRgb(end) ?? [28, 43, 74];
  const channel = (index: number) =>
    Math.round(left[index] + (right[index] - left[index]) * ratio)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

function chartTextColor(fill: string, opacity = 1) {
  const rgb = hexToRgb(fill);
  if (!rgb) return "#1c2b4a";
  const alpha = clamp(opacity, 0, 1);
  const composite = rgb.map((channel) => channel * alpha + 255 * (1 - alpha));
  const fillLuminance = relativeLuminance(composite);
  const whiteContrast = 1.05 / (fillLuminance + 0.05);
  const navyContrast =
    (fillLuminance + 0.05) /
    (relativeLuminance(hexToRgb("#1c2b4a") ?? [28, 43, 74]) + 0.05);
  return whiteContrast >= 4.5 && whiteContrast >= navyContrast
    ? "#ffffff"
    : "#1c2b4a";
}

function hexToRgb(color: string) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  return match
    ? [
        Number.parseInt(match[1], 16),
        Number.parseInt(match[2], 16),
        Number.parseInt(match[3], 16),
      ]
    : null;
}

function relativeLuminance(rgb: number[]) {
  const [red, green, blue] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function polarPoint(cx: number, cy: number, radius: number, angle: number) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

interface TreemapEntry {
  label: string;
  value: number;
  color: string;
  textColor?: string;
  opacity: number;
}

interface TreemapRect extends TreemapEntry {
  x: number;
  y: number;
  width: number;
  height: number;
}

function layoutTreemap(
  entries: TreemapEntry[],
  x: number,
  y: number,
  width: number,
  height: number,
): TreemapRect[] {
  if (!entries.length) return [];
  if (entries.length === 1) return [{ ...entries[0], x, y, width, height }];
  const total = entries.reduce((sum, entry) => sum + entry.value, 0);
  let subtotal = 0;
  let split = 1;
  for (; split < entries.length; split += 1) {
    const next = subtotal + entries[split - 1].value;
    if (next >= total / 2) {
      subtotal = next;
      break;
    }
    subtotal = next;
  }
  split = Math.max(1, Math.min(entries.length - 1, split));
  subtotal = entries
    .slice(0, split)
    .reduce((sum, entry) => sum + entry.value, 0);
  const ratio = subtotal / Math.max(total, 0.000001);
  if (width >= height) {
    const firstWidth = width * ratio;
    return [
      ...layoutTreemap(entries.slice(0, split), x, y, firstWidth, height),
      ...layoutTreemap(
        entries.slice(split),
        x + firstWidth,
        y,
        width - firstWidth,
        height,
      ),
    ];
  }
  const firstHeight = height * ratio;
  return [
    ...layoutTreemap(entries.slice(0, split), x, y, width, firstHeight),
    ...layoutTreemap(
      entries.slice(split),
      x,
      y + firstHeight,
      width,
      height - firstHeight,
    ),
  ];
}
