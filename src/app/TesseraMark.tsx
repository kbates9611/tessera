import type { ReactNode } from "react";

const CARD = 132;
const GAP = 12;
const GRID = CARD * 3 + GAP * 2;
const EDGE = 2.5;
const RADIUS = 17;

const BLUE: Record<number, string> = {
  700: "#2250b4",
  600: "#2a63e8",
  500: "#5582ed",
  400: "#83a5f2",
  300: "#aac1f6",
  200: "#d2defa",
};
const EDGE_COLOR = "#6e95ef";

const c = (step: number) => BLUE[step];

function Head() {
  return <rect x="14" y="13" width="34" height="5.5" rx="2.75" fill={c(200)} />;
}

const GLYPHS: Record<string, () => ReactNode> = {
  bars: () => (
    <g>
      <Head />
      {(
        [
          [16, 26, 300],
          [33, 42, 400],
          [50, 58, 500],
          [67, 74, 600],
        ] as const
      ).map(([x, h, step]) => (
        <rect
          key={x}
          x={x}
          y={82 - h}
          width="12"
          height={h}
          rx="2"
          fill={c(step)}
        />
      ))}
    </g>
  ),
  line: () => (
    <g>
      <Head />
      <polyline
        points="15,80 30,66 46,62 61,45 84,26"
        fill="none"
        stroke={c(600)}
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {(
        [
          [30, 66],
          [61, 45],
          [84, 26],
        ] as const
      ).map(([x, y]) => (
        <circle key={x} cx={x} cy={y} r="5" fill={c(600)} />
      ))}
    </g>
  ),
  donut: () => (
    <g>
      <Head />
      <circle
        cx="50"
        cy="55"
        r="21"
        fill="none"
        stroke={c(300)}
        strokeWidth="12"
      />
      <circle
        cx="50"
        cy="55"
        r="21"
        fill="none"
        stroke={c(700)}
        strokeWidth="12"
        strokeDasharray="34.31 131.95"
        transform="rotate(-58 50 55)"
      />
    </g>
  ),
  list: () => (
    <g>
      <Head />
      {(
        [
          [42, 46],
          [59, 38],
          [76, 34],
        ] as const
      ).map(([y, w]) => (
        <g key={y}>
          <circle cx="19" cy={y + 2.75} r="4" fill={c(500)} />
          <rect x="29" y={y} width={w} height="5.5" rx="2.75" fill={c(300)} />
        </g>
      ))}
    </g>
  ),
  heat: () => (
    <g>
      <Head />
      {(
        [
          [64, 22, 700],
          [64, 37, 600],
          [64, 52, 700],
          [64, 67, 600],
          [44, 37, 400],
          [44, 52, 400],
          [44, 67, 300],
          [24, 52, 200],
          [24, 67, 200],
        ] as const
      ).map(([x, y, step]) => (
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width="16"
          height="11"
          rx="2.5"
          fill={c(step)}
        />
      ))}
    </g>
  ),
  copy: () => (
    <g>
      <Head />
      {(
        [
          [38, 66],
          [52, 44],
          [66, 58],
          [80, 34],
        ] as const
      ).map(([y, w]) => (
        <rect
          key={y}
          x="15"
          y={y}
          width={w}
          height="5.5"
          rx="2.75"
          fill={c(300)}
        />
      ))}
    </g>
  ),
  pie: () => (
    <g>
      <Head />
      <path
        d="M 46 58 L 68.25 66.99 A 24 24 0 1 1 45.16 34.01 Z"
        fill={c(400)}
      />
      <path
        d="M 46 58 L 45.16 34.01 A 24 24 0 0 1 68.25 66.99 Z"
        fill={c(500)}
        transform="translate(5,-2.5)"
      />
    </g>
  ),
  hbars: () => (
    <g>
      <Head />
      {(
        [
          [40, 20, 200],
          [53, 40, 300],
          [66, 54, 400],
          [79, 70, 500],
        ] as const
      ).map(([y, w, step]) => (
        <rect key={y} x="15" y={y} width={w} height="9" rx="3" fill={c(step)} />
      ))}
    </g>
  ),
  candles: () => (
    <g>
      <Head />
      {(
        [
          [22, 44, 84, 52, 76],
          [41, 30, 72, 36, 62],
          [60, 48, 86, 54, 78],
          [79, 26, 66, 32, 56],
        ] as const
      ).map(([x, wickTop, wickBottom, bodyTop, bodyBottom]) => (
        <g key={x}>
          <rect
            x={x - 2}
            y={wickTop}
            width="4"
            height={wickBottom - wickTop}
            rx="2"
            fill={c(400)}
          />
          <rect
            x={x - 6}
            y={bodyTop}
            width="12"
            height={bodyBottom - bodyTop}
            rx="2.5"
            fill={c(500)}
          />
        </g>
      ))}
    </g>
  ),
};

const CARDS = [
  "bars",
  "line",
  "donut",
  "list",
  "heat",
  "copy",
  "pie",
  "hbars",
  "candles",
];

export function TesseraMark({
  size = 28,
  title = "Tessera",
}: {
  size?: number;
  title?: string;
}) {
  const inner = CARD - EDGE * 2;
  return (
    <svg
      className="tessera-mark"
      width={size}
      height={size}
      viewBox={`0 0 ${GRID} ${GRID}`}
      role="img"
      aria-label={title}
    >
      {CARDS.map((kind, index) => {
        const column = index % 3;
        const row = Math.floor(index / 3);
        const x = column * (CARD + GAP);
        const y = row * (CARD + GAP);
        const Glyph = GLYPHS[kind];
        return (
          <g key={kind} transform={`translate(${x} ${y})`}>
            <rect
              x={EDGE / 2}
              y={EDGE / 2}
              width={CARD - EDGE}
              height={CARD - EDGE}
              rx={RADIUS}
              fill="#ffffff"
              stroke={EDGE_COLOR}
              strokeWidth={EDGE}
            />
            <g transform={`translate(${EDGE} ${EDGE}) scale(${inner / 100})`}>
              <Glyph />
            </g>
          </g>
        );
      })}
    </svg>
  );
}
