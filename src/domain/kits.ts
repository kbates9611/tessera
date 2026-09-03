import type { Dashboard, DashboardBlock, DashboardKitId } from "./types";

export interface DashboardKit {
  id: DashboardKitId;
  name: string;
  tagline: string;
  /** Darkest ink: section headers, first series, gauge targets. */
  ink: string;
  /** The working accent: KPI icons, second series, gauge values. */
  accent: string;
  /** Six-step series palette, darkest first; the last step is the soft tint. */
  palette: string[];
  /** Lightest tint: table headers, gauge tracks. */
  soft: string;
  /** Page band gradient stops. */
  band: [string, string, string];
  heatmap: { min: string; mid: string; max: string };
  table: { groupPalette: string[] };
  sankey: string[];
}

export const DEFAULT_KIT_ID: DashboardKitId = "slate-blue";

export const KITS: Record<DashboardKitId, DashboardKit> = {
  "slate-blue": {
    id: "slate-blue",
    name: "Slate blue",
    tagline: "Editorial, restrained, operational.",
    ink: "#1c2b4a",
    accent: "#355f9d",
    palette: ["#1c2b4a", "#355f9d", "#4d76b3", "#7897c4", "#b7c9e2", "#dbe6f3"],
    soft: "#dbe6f3",
    band: ["#263a60", "#1c2b4a", "#17203a"],
    heatmap: { min: "#edf4fb", mid: "#7897c4", max: "#1c2b4a" },
    table: {
      groupPalette: [
        "#eef4fb",
        "#e2edf9",
        "#f3f6fa",
        "#dbe6f3",
        "#edf1f7",
        "#e7eff8",
      ],
    },
    sankey: [
      "#1c2b4a",
      "#355f9d",
      "#4d76b3",
      "#7897c4",
      "#8a97ab",
      "#a9b6c8",
      "#b7c9e2",
      "#cfd7e2",
    ],
  },
  "burnt-orange": {
    id: "burnt-orange",
    name: "Burnt orange",
    tagline: "Warm, grounded, decisive.",
    ink: "#4a2412",
    accent: "#b8531f",
    palette: ["#4a2412", "#b8531f", "#cf6f38", "#e0955f", "#efc7a6", "#f7e5d6"],
    soft: "#f7e5d6",
    band: ["#5c2f18", "#4a2412", "#35190c"],
    heatmap: { min: "#fcf3ec", mid: "#e0955f", max: "#4a2412" },
    table: {
      groupPalette: [
        "#fbf1ea",
        "#f8e6da",
        "#fbf5f0",
        "#f7e5d6",
        "#f9efe7",
        "#f6e9df",
      ],
    },
    sankey: [
      "#4a2412",
      "#b8531f",
      "#cf6f38",
      "#e0955f",
      "#a68e7f",
      "#c3ada0",
      "#efc7a6",
      "#e6d6cb",
    ],
  },
  maroon: {
    id: "maroon",
    name: "Maroon",
    tagline: "Deep, formal, assured.",
    ink: "#3b0f1d",
    accent: "#8a2439",
    palette: ["#3b0f1d", "#8a2439", "#a63f55", "#c26f80", "#e0b3bd", "#f0dce1"],
    soft: "#f0dce1",
    band: ["#521a2b", "#3b0f1d", "#2a0a14"],
    heatmap: { min: "#fbf0f3", mid: "#c26f80", max: "#3b0f1d" },
    table: {
      groupPalette: [
        "#faeef1",
        "#f5e0e5",
        "#faf3f5",
        "#f0dce1",
        "#f7eaed",
        "#f3e3e7",
      ],
    },
    sankey: [
      "#3b0f1d",
      "#8a2439",
      "#a63f55",
      "#c26f80",
      "#9b8288",
      "#b7a3a8",
      "#e0b3bd",
      "#dccfd2",
    ],
  },
};

export const KIT_IDS = Object.keys(KITS) as DashboardKitId[];
export const KIT_LIST = KIT_IDS.map((id) => KITS[id]);

export function kitFor(dashboard: Pick<Dashboard, "kit">): DashboardKit {
  return KITS[dashboard.kit ?? DEFAULT_KIT_ID];
}

function colorMap(from: DashboardKit, to: DashboardKit) {
  const pairs: Array<[string, string]> = [
    [from.ink, to.ink],
    [from.accent, to.accent],
    [from.soft, to.soft],
    ...from.palette.map((color, index): [string, string] => [
      color,
      to.palette[index],
    ]),
    [from.heatmap.min, to.heatmap.min],
    [from.heatmap.mid, to.heatmap.mid],
    [from.heatmap.max, to.heatmap.max],
    ...from.table.groupPalette.map((color, index): [string, string] => [
      color,
      to.table.groupPalette[index],
    ]),
    ...from.sankey.map((color, index): [string, string] => [
      color,
      to.sankey[index],
    ]),
  ];
  const map = new Map<string, string>();
  pairs.forEach(([source, target]) => {
    const key = source.toLowerCase();
    if (!map.has(key)) map.set(key, target);
  });
  return map;
}

const HEX = /^#[0-9a-f]{6}$/i;

function recolorValue(value: unknown, map: Map<string, string>): unknown {
  if (typeof value === "string")
    return HEX.test(value) ? (map.get(value.toLowerCase()) ?? value) : value;
  if (Array.isArray(value)) return value.map((item) => recolorValue(item, map));
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    Object.entries(value).forEach(([key, child]) => {
      next[key] = recolorValue(child, map);
    });
    return next;
  }
  return value;
}

export function recolorBlock(
  block: DashboardBlock,
  from: DashboardKit,
  to: DashboardKit,
) {
  if (from.id === to.id) return;
  const map = colorMap(from, to);
  block.style = recolorValue(block.style, map) as DashboardBlock["style"];
  block.chart = recolorValue(block.chart, map) as DashboardBlock["chart"];
  block.gauge = recolorValue(block.gauge, map) as DashboardBlock["gauge"];
  block.table = recolorValue(block.table, map) as DashboardBlock["table"];
}
