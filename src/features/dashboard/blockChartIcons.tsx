import { forwardRef, type ReactNode } from "react";
import type { LucideIcon, LucideProps } from "lucide-react";

function chartIcon(name: string, drawing: ReactNode): LucideIcon {
  const Icon = forwardRef<SVGSVGElement, LucideProps>(
    (
      {
        color = "currentColor",
        size = 24,
        strokeWidth = 2,
        absoluteStrokeWidth,
        className,
        ...props
      },
      ref,
    ) => {
      const normalizedStroke =
        absoluteStrokeWidth && typeof size === "number"
          ? (Number(strokeWidth) * 24) / size
          : strokeWidth;
      return (
        <svg
          ref={ref}
          {...props}
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth={normalizedStroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`lucide lucide-${name}${className ? ` ${className}` : ""}`}
        >
          {drawing}
        </svg>
      );
    },
  );
  Icon.displayName = name;
  return Icon as LucideIcon;
}

/* A headline tile: a card with its eyebrow label and a rising sparkline
   that ends in an up-right arrow, the way a KPI card reads. */
export const KpiChartIcon = chartIcon(
  "kpi-chart",
  <>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M6.5 8.5h5" />
    <path d="m6.5 16 3.5-3.5 2.5 2 5-5" />
    <path d="M14.5 9.5h3v3" />
  </>,
);

/* Three rounded columns rising left to right on a baseline. */
export const VerticalBarChartIcon = chartIcon(
  "vertical-bar-chart",
  <>
    <path d="M3 20.5h18" />
    <rect x="5" y="13.5" width="4" height="5" rx="1" />
    <rect x="10" y="9.5" width="4" height="9" rx="1" />
    <rect x="15" y="4.5" width="4" height="14" rx="1" />
  </>,
);

/* Three ranked rows against a left axis, longest first. */
export const HorizontalBarChartIcon = chartIcon(
  "horizontal-bar-chart",
  <>
    <path d="M3.5 3v18" />
    <rect x="5.5" y="5" width="15" height="3.5" rx="1" />
    <rect x="5.5" y="10.25" width="11" height="3.5" rx="1" />
    <rect x="5.5" y="15.5" width="7" height="3.5" rx="1" />
  </>,
);

/* Two pairs of columns; the second series in each pair is solid. */
export const GroupedBarChartIcon = chartIcon(
  "grouped-bar-chart",
  <>
    <path d="M3 20.5h18" />
    <rect x="4.5" y="11.5" width="3" height="7" rx=".8" />
    <rect x="8" y="7.5" width="3" height="11" rx=".8" fill="currentColor" />
    <rect x="13" y="5.5" width="3" height="13" rx=".8" />
    <rect x="16.5" y="12.5" width="3" height="6" rx=".8" fill="currentColor" />
  </>,
);

/* A ring with one solid quarter: the outer and inner circles, and the
   highlighted segment filled so it reads at library size. */
export const DonutChartIcon = chartIcon(
  "donut-chart",
  <>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="3.5" />
    <path
      d="M12 3.5A8.5 8.5 0 0 1 20.5 12H15.5A3.5 3.5 0 0 0 12 8.5Z"
      fill="currentColor"
      stroke="none"
    />
  </>,
);

/* One source splitting into two destinations: a node bar on the left, two
   on the right, and two smooth flow bands between them. */
export const SankeyChartIcon = chartIcon(
  "sankey-chart",
  <>
    <rect x="3" y="5" width="3" height="14" rx=".7" />
    <rect x="18" y="3" width="3" height="7" rx=".7" />
    <rect x="18" y="14" width="3" height="7" rx=".7" />
    <path d="M6 9c5 0 7-2.5 12-2.5" />
    <path d="M6 15c5 0 7 2.5 12 2.5" />
  </>,
);

export const TreemapChartIcon = chartIcon(
  "treemap-chart",
  <>
    <rect x="3" y="3" width="18" height="18" rx="1.5" />
    <path d="M12 3v18M12 12h9M3 15h9M17 12v9" />
  </>,
);

/* A three-by-three matrix drawn as outlined cells, with the three hot cells
   filled solid so the pattern reads even at library size. */
const HEATMAP_CELLS: Array<[number, number, boolean]> = [
  [3, 3, false],
  [9.5, 3, false],
  [16, 3, true],
  [3, 9.5, false],
  [9.5, 9.5, true],
  [16, 9.5, true],
  [3, 16, true],
  [9.5, 16, false],
  [16, 16, false],
];

export const HeatmapChartIcon = chartIcon(
  "heatmap-chart",
  <>
    {HEATMAP_CELLS.map(([x, y, hot]) => (
      <rect
        key={`${x}-${y}`}
        x={x}
        y={y}
        width="5"
        height="5"
        rx="1"
        fill={hot ? "currentColor" : "none"}
        opacity={hot ? 1 : 0.55}
      />
    ))}
  </>,
);
