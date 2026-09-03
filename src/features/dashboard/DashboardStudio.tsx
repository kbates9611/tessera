import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  AlignLeft,
  ArrowLeft,
  ArrowRight,
  Bot,
  ChartScatter,
  Check,
  Copy,
  Database,
  Gauge,
  GripHorizontal,
  Heading1,
  Image as ImageIcon,
  LayoutGrid,
  LineChart,
  PanelTop,
  Pencil,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Table2,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import type { CommandBus } from "../../domain/commands";
import { KIT_LIST, kitFor } from "../../domain/kits";
import {
  dashboardSeriesName,
  dashboardsForPeriod,
  reportingPeriodLabel,
} from "../../domain/dashboardPeriods";
import {
  CANVAS_COLUMNS,
  CHART_TYPES,
  MIN_BLOCK_WIDTH,
  dashboardRows,
  fillStackRows,
  setCellWidth,
  shareColumns,
  stackRows,
  type DashboardCell,
} from "../../domain/layout";
import { selectedReadyMonth } from "../../domain/selectors";
import {
  BLOCK_LABELS,
  type BlockType,
  type Dashboard,
  type DashboardBlock,
  type TesseraProject,
} from "../../domain/types";
import { BlockRenderer } from "./BlockRenderer";
import { AgentHint } from "../agent/AgentHint";
import { suggestedPrompts } from "../agent/prompts";
import { BlockInspector } from "./Inspector";
import {
  DonutChartIcon,
  GroupedBarChartIcon,
  HeatmapChartIcon,
  HorizontalBarChartIcon,
  KpiChartIcon,
  SankeyChartIcon,
  TreemapChartIcon,
  VerticalBarChartIcon,
} from "./blockChartIcons";

const BLOCK_ICONS = {
  sectionHeader: PanelTop,
  heading: Heading1,
  text: AlignLeft,
  illustration: ImageIcon,
  kpi: KpiChartIcon,
  table: Table2,
  bar: VerticalBarChartIcon,
  horizontalBar: HorizontalBarChartIcon,
  groupedBar: GroupedBarChartIcon,
  line: LineChart,
  donut: DonutChartIcon,
  sankey: SankeyChartIcon,
  gauge: Gauge,
  scatter: ChartScatter,
  treemap: TreemapChartIcon,
  heatmap: HeatmapChartIcon,
} satisfies Record<BlockType, LucideIcon>;

const COPY: Record<BlockType, string> = {
  sectionHeader: "Editorial divider",
  heading: "Display title",
  text: "Narrative copy",
  illustration: "Large editable line art",
  kpi: "Single key measure",
  table: "Detailed rows",
  bar: "Category comparison",
  horizontalBar: "Ranked comparison",
  groupedBar: "Multi-series comparison",
  line: "Trend over time",
  donut: "Part-to-whole",
  sankey: "Flow between stages",
  gauge: "Actual against target",
  scatter: "Relationship between metrics",
  treemap: "Composition with many parts",
  heatmap: "Two-dimensional intensity",
};

const verticalCardPadding = (padding: number) => Math.round(padding * 0.65);

const CONTENT_BLOCKS: BlockType[] = [
  "sectionHeader",
  "heading",
  "text",
  "illustration",
];
const CORE_DATA_BLOCKS: BlockType[] = [
  "kpi",
  "table",
  "bar",
  "horizontalBar",
  "groupedBar",
  "line",
  "donut",
  "sankey",
];
const ADVANCED_BLOCKS: BlockType[] = ["gauge", "scatter", "treemap", "heatmap"];
type DragPayload =
  { kind: "block"; id: string } | { kind: "new"; type: BlockType };

type DropTarget =
  | { kind: "row"; index: number }
  | {
      kind: "beside";
      targetId: string;
      side: "before" | "after";
    }
  | {
      kind: "stack";
      targetId: string;
      position: "above" | "below";
    };

type EditableHeaderField = "eyebrow" | "name" | "description";

const MAX_BLOCKS_PER_ROW = CANVAS_COLUMNS / MIN_BLOCK_WIDTH;
const STACK_GAP = 16;
const MIN_STACK_ITEM_HEIGHT = 72;
const MAX_STACK_ITEM_HEIGHT = 900;
const KPI_BAND_MIN_HEIGHT = 120;

export function DashboardStudio({
  project,
  dashboard,
  bus,
  agentConnected,
  selectedBlockId,
  onSelectBlock,
  onNewDashboard,
  reportingPeriod,
  onOpenAgent,
  onOpenWarehouse,
}: {
  project: TesseraProject;
  dashboard: Dashboard;
  bus: CommandBus;
  agentConnected: boolean;
  selectedBlockId?: string;
  onSelectBlock: (id?: string) => void;
  onNewDashboard: () => void;
  reportingPeriod: string;
  onOpenAgent: () => void;
  onOpenWarehouse: (datasetId: string, period?: string) => void;
}) {
  const visibleDashboards = dashboardsForPeriod(project, reportingPeriod);
  const [drag, setDrag] = useState<DragPayload | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [headerEditor, setHeaderEditor] = useState<{
    field: EditableHeaderField;
    value: string;
  } | null>(null);
  const selected = dashboard.blocks.find(
    (block) => block.id === selectedBlockId,
  );
  const selectedIndex = selected
    ? dashboard.blocks.findIndex((block) => block.id === selected.id)
    : -1;
  const sectionLinks = dashboardSections(dashboard);
  const [activeSectionId, setActiveSectionId] = useState<string | undefined>(
    sectionLinks[0]?.id,
  );
  const reportPeriod = reportingPeriod
    ? reportingPeriodLabel(reportingPeriod)
    : "Current period";
  const defaultHeaderEyebrow = `${project.name} · Monthly business review · ${reportPeriod}`;
  const headerEyebrow = dashboard.headerEyebrow || defaultHeaderEyebrow;
  const canvasRows = dashboardRows(dashboard.blocks);
  const kit = kitFor(dashboard);
  const kitStyle = {
    "--kit-band-start": kit.band[0],
    "--kit-band-mid": kit.band[1],
    "--kit-band-end": kit.band[2],
    "--kit-ink": kit.ink,
    "--kit-accent": kit.accent,
    "--kit-soft": kit.soft,
  } as React.CSSProperties;

  useEffect(() => {
    setActiveSectionId(sectionLinks[0]?.id);
    setHeaderEditor(null);
  }, [dashboard.id]);

  const resizeSessionRef = useRef<AbortController | null>(null);
  const abortResizeSession = () => {
    resizeSessionRef.current?.abort();
    resizeSessionRef.current = null;
  };
  useEffect(() => abortResizeSession, [dashboard.id]);

  const startHeaderEdit = (field: EditableHeaderField, value: string) => {
    setHeaderEditor({ field, value });
  };

  const commitHeaderEdit = async () => {
    if (!headerEditor) return;

    const { field } = headerEditor;
    const fallback =
      field === "eyebrow"
        ? headerEyebrow
        : field === "name"
          ? dashboard.name
          : dashboard.description;
    const value = headerEditor.value.trim() || fallback;
    const key = field === "eyebrow" ? "headerEyebrow" : field;

    setHeaderEditor(null);
    await bus.execute(
      "update_dashboard",
      { dashboardId: dashboard.id, [key]: value },
      "human",
    );
  };

  const handleHeaderEditorKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setHeaderEditor(null);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.blur();
    }
  };

  const updateActiveSectionFromScroll = (scroller: HTMLElement) => {
    if (!sectionLinks.length) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const activationLine =
      scrollerRect.top + Math.min(160, scrollerRect.height * 0.28);
    let nextSectionId = sectionLinks[0].id;

    for (const section of sectionLinks) {
      const target = scroller.querySelector<HTMLElement>(
        `[data-block-id="${section.id}"]`,
      );
      if (!target || target.getBoundingClientRect().top > activationLine) break;
      nextSectionId = section.id;
    }

    const reachedBottom =
      scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
    if (reachedBottom) nextSectionId = sectionLinks.at(-1)!.id;
    setActiveSectionId((current) =>
      current === nextSectionId ? current : nextSectionId,
    );
  };

  const createBlock = async (type: BlockType, historyGroup?: string) => {
    if (type === "illustration")
      return (await bus.execute(
        "add_illustration_card",
        {
          title: "People at desks",
          altText: "Two colleagues working side by side at office desks.",
          preset: "people-at-desks",
          width: 6,
          minHeight: 310,
        },
        "human",
        { historyGroup },
      )) as DashboardBlock;
    const result = (await bus.execute(
      "add_tile_placeholder",
      {
        type,
        mode: "agent",
        width: CANVAS_COLUMNS,
      },
      "human",
      { historyGroup },
    )) as DashboardBlock;
    return result;
  };

  const applyDropLayout = async (
    movingId: string,
    target: DropTarget,
    addedBlock?: DashboardBlock,
    historyGroup?: string,
  ) => {
    const source = dashboard.blocks.some((block) => block.id === movingId)
      ? dashboard.blocks
      : addedBlock
        ? [...dashboard.blocks, addedBlock]
        : dashboard.blocks;
    const arranged = arrangeBlocksForDrop(source, movingId, target);
    await bus.execute(
      "set_dashboard_layout",
      {
        placements: arranged.map((block) => ({
          blockId: block.id,
          width: block.layout.width,
          minHeight: block.layout.minHeight,
          stackId: block.layout.stackId ?? "",
        })),
      },
      "human",
      { historyGroup },
    );
  };

  const addBlock = async (type: BlockType) => {
    const historyGroup = crypto.randomUUID();
    const result = await createBlock(type, historyGroup);
    await applyDropLayout(
      result.id,
      { kind: "row", index: dashboardRows(dashboard.blocks).length },
      result,
      historyGroup,
    );
    onSelectBlock(type === "illustration" ? result.id : undefined);
  };

  const canvasStyle = useMemo(
    () => ({ "--canvas-columns": CANVAS_COLUMNS }) as React.CSSProperties,
    [],
  );

  const completeDrop = async (
    target?: DropTarget,
    payload: DragPayload | null = drag,
  ) => {
    if (!payload) return;
    const destination = target ??
      dropTarget ?? {
        kind: "row" as const,
        index: dashboardRows(dashboard.blocks).length,
      };
    try {
      if (payload.kind === "new") {
        const historyGroup = crypto.randomUUID();
        const result = await createBlock(payload.type, historyGroup);
        await applyDropLayout(result.id, destination, result, historyGroup);
        onSelectBlock(payload.type === "illustration" ? result.id : undefined);
      } else {
        await applyDropLayout(payload.id, destination);
        onSelectBlock(payload.id);
      }
    } finally {
      setDrag(null);
      setDropTarget(null);
    }
  };

  const resizeWidth = (
    event: React.PointerEvent<HTMLDivElement>,
    row: DashboardCell[],
    cellIndex: number,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const grid = event.currentTarget.closest<HTMLElement>(".dashboard-grid");
    const cellElements = Array.from(
      grid?.querySelectorAll<HTMLElement>("[data-cell-id]") ?? [],
    );
    const elements = row.map((cell) =>
      cellElements.find((element) => element.dataset.cellId === cell.id),
    );
    const leftElement = elements[cellIndex];
    if (!grid || !leftElement || elements.some((element) => !element)) return;
    const startX = event.clientX;
    const startWidths = row.map((cell) => cell.width);
    const others = row.map((_, index) => index).filter((i) => i !== cellIndex);
    const gap = Number.parseFloat(getComputedStyle(grid).columnGap) || 0;
    const columnPitch = Math.max(
      1,
      (grid.clientWidth - (CANVAS_COLUMNS - 1) * gap) / CANVAS_COLUMNS + gap,
    );
    let nextWidths = [...startWidths];
    abortResizeSession();
    const controller = new AbortController();
    resizeSessionRef.current = controller;
    leftElement.classList.add("is-resizing");
    others.forEach((index) =>
      elements[index]!.classList.add("is-resizing-partner"),
    );
    const move = (pointer: PointerEvent) => {
      const raw = Math.round(
        startWidths[cellIndex] + (pointer.clientX - startX) / columnPitch,
      );
      const leftWidth = clampLayoutWidth(
        raw,
        MIN_BLOCK_WIDTH,
        CANVAS_COLUMNS - MIN_BLOCK_WIDTH * others.length,
      );
      const shared = shareColumns(
        others.map((index) => startWidths[index]),
        CANVAS_COLUMNS - leftWidth,
      );
      nextWidths = startWidths.map((_, index) =>
        index === cellIndex ? leftWidth : shared[others.indexOf(index)],
      );
      row.forEach((_, index) => {
        elements[index]!.style.gridColumn = `span ${nextWidths[index]}`;
      });
      leftElement.dataset.resizeLabel = `${nextWidths.join(" / ")} columns`;
    };
    let finished = false;
    const finish = (commit: boolean) => {
      if (finished) return;
      finished = true;
      if (resizeSessionRef.current === controller)
        resizeSessionRef.current = null;
      controller.abort();
      leftElement.classList.remove("is-resizing");
      others.forEach((index) =>
        elements[index]!.classList.remove("is-resizing-partner"),
      );
      delete leftElement.dataset.resizeLabel;
      if (!commit) {
        row.forEach((_, index) => {
          elements[index]!.style.gridColumn = `span ${startWidths[index]}`;
        });
        return;
      }
      const copies = row.map((cell) => ({
        ...cell,
        blocks: cell.blocks.map((block) => ({
          ...block,
          layout: { ...block.layout },
        })),
      }));
      copies.forEach((cell, index) =>
        setCellWidth(cell, nextWidths[index] as DashboardCell["width"]),
      );
      void bus.execute("set_dashboard_layout", {
        placements: copies.flatMap((cell) =>
          cell.blocks.map((block) => ({
            blockId: block.id,
            width: block.layout.width,
          })),
        ),
      });
    };
    const { signal } = controller;
    signal.addEventListener("abort", () => finish(false));
    window.addEventListener("pointermove", move, { signal });
    window.addEventListener("pointerup", () => finish(true), { signal });
    window.addEventListener("pointercancel", () => finish(false), { signal });
  };

  const resizeStackWidth = (
    event: React.PointerEvent<HTMLDivElement>,
    cell: DashboardCell,
    left: DashboardBlock,
    right: DashboardBlock,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const leftElement =
      event.currentTarget.closest<HTMLElement>(".canvas-block");
    const stackElement = leftElement?.closest<HTMLElement>(".canvas-stack");
    const rightElement = stackElement?.querySelector<HTMLElement>(
      `[data-block-id="${right.id}"]`,
    );
    if (!leftElement || !stackElement || !rightElement) return;
    const startX = event.clientX;
    const startLeft = left.layout.width;
    const pairWidth = startLeft + right.layout.width;
    const gap =
      Number.parseFloat(getComputedStyle(stackElement).columnGap) || 0;
    const columnPitch = Math.max(
      1,
      (stackElement.clientWidth - (cell.width - 1) * gap) / cell.width + gap,
    );
    let nextLeft = startLeft;
    let nextRight = right.layout.width;
    abortResizeSession();
    const controller = new AbortController();
    resizeSessionRef.current = controller;
    leftElement.classList.add("is-resizing");
    rightElement.classList.add("is-resizing-partner");
    const move = (pointer: PointerEvent) => {
      const raw = Math.round(
        startLeft + (pointer.clientX - startX) / columnPitch,
      );
      nextLeft = clampLayoutWidth(
        raw,
        MIN_BLOCK_WIDTH,
        pairWidth - MIN_BLOCK_WIDTH,
      );
      nextRight = (pairWidth - nextLeft) as DashboardBlock["layout"]["width"];
      leftElement.style.gridColumn = `span ${nextLeft}`;
      rightElement.style.gridColumn = `span ${nextRight}`;
      leftElement.dataset.resizeLabel = `${nextLeft} / ${nextRight} columns`;
    };
    let finished = false;
    const finish = (commit: boolean) => {
      if (finished) return;
      finished = true;
      if (resizeSessionRef.current === controller)
        resizeSessionRef.current = null;
      controller.abort();
      leftElement.classList.remove("is-resizing");
      rightElement.classList.remove("is-resizing-partner");
      delete leftElement.dataset.resizeLabel;
      if (!commit) {
        leftElement.style.gridColumn = `span ${startLeft}`;
        rightElement.style.gridColumn = `span ${right.layout.width}`;
        return;
      }
      void bus.execute("set_dashboard_layout", {
        placements: [
          { blockId: left.id, width: nextLeft },
          { blockId: right.id, width: nextRight },
        ],
      });
    };
    const { signal } = controller;
    signal.addEventListener("abort", () => finish(false));
    window.addEventListener("pointermove", move, { signal });
    window.addEventListener("pointerup", () => finish(true), { signal });
    window.addEventListener("pointercancel", () => finish(false), { signal });
  };

  const resizeHeight = (
    event: React.PointerEvent<HTMLDivElement>,
    block: DashboardBlock,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const card = event.currentTarget.closest<HTMLElement>(".canvas-block");
    if (!card) return;
    const rowInfo = dashboardRowForIndex(
      dashboard.blocks,
      dashboard.blocks.findIndex((candidate) => candidate.id === block.id),
    );
    const ownCell = rowInfo.row[rowInfo.position];
    const startY = event.clientY;
    const startHeight = card.getBoundingClientRect().height;
    let nextHeight = Math.round(startHeight);
    abortResizeSession();
    const controller = new AbortController();
    resizeSessionRef.current = controller;
    card.classList.add("is-resizing");
    const move = (pointer: PointerEvent) => {
      nextHeight = Math.max(
        72,
        Math.min(
          900,
          Math.round((startHeight + pointer.clientY - startY) / 8) * 8,
        ),
      );
      card.style.minHeight = `${nextHeight}px`;
      card.dataset.resizeLabel = `${nextHeight}px high`;
    };
    let finished = false;
    const finish = (commit: boolean) => {
      if (finished) return;
      finished = true;
      if (resizeSessionRef.current === controller)
        resizeSessionRef.current = null;
      controller.abort();
      card.classList.remove("is-resizing");
      delete card.dataset.resizeLabel;
      if (!commit) {
        card.style.minHeight = `${block.layout.minHeight}px`;
        return;
      }
      const placements: Array<{ blockId: string; minHeight: number }> = [];
      const ownRows = ownCell ? stackRows(ownCell) : [[block]];
      const subRow = ownRows.find((candidates) =>
        candidates.some((candidate) => candidate.id === block.id),
      ) ?? [block];
      subRow.forEach((partner) =>
        placements.push({ blockId: partner.id, minHeight: nextHeight }),
      );
      const shrinking = nextHeight < Math.round(startHeight) - 4;
      if (shrinking && ownCell) {
        const cellHeight =
          ownRows.reduce(
            (sum, candidates) =>
              sum +
              (candidates === subRow
                ? nextHeight
                : Math.max(...candidates.map((b) => b.layout.minHeight))),
            0,
          ) +
          STACK_GAP * Math.max(0, ownRows.length - 1);
        rowInfo.row.forEach((cell) => {
          if (cell === ownCell) return;
          const rows = stackRows(cell);
          const share = Math.max(
            MIN_STACK_ITEM_HEIGHT,
            Math.floor(
              (cellHeight - STACK_GAP * (rows.length - 1)) / rows.length,
            ),
          );
          rows.forEach((candidates) =>
            candidates.forEach((partner) => {
              if (partner.layout.minHeight > share)
                placements.push({ blockId: partner.id, minHeight: share });
            }),
          );
        });
      }
      void bus.execute("set_dashboard_layout", { placements });
    };
    const { signal } = controller;
    signal.addEventListener("abort", () => finish(false));
    window.addEventListener("pointermove", move, { signal });
    window.addEventListener("pointerup", () => finish(true), { signal });
    window.addEventListener("pointercancel", () => finish(false), { signal });
  };

  const renderCanvasBlock = (
    block: DashboardBlock,
    cell: DashboardCell,
    row: DashboardCell[],
    cellIndex: number,
    stacked: boolean,
  ) => {
    const index = dashboard.blocks.findIndex(
      (candidate) => candidate.id === block.id,
    );
    const rightCell = row[cellIndex + 1];
    const composition = blockComposition(dashboard.blocks, index);
    const subRow = stacked
      ? stackRows(cell).find((candidates) =>
          candidates.some((candidate) => candidate.id === block.id),
        )
      : undefined;
    const subRowPartner = subRow
      ? subRow[subRow.findIndex((candidate) => candidate.id === block.id) + 1]
      : undefined;
    const dropClass =
      dropTarget?.kind === "beside" && dropTarget.targetId === block.id
        ? ` is-drop-beside-${dropTarget.side}`
        : dropTarget?.kind === "stack" && dropTarget.targetId === block.id
          ? ` is-drop-stack-${dropTarget.position}`
          : "";
    return (
      <div
        key={block.id}
        data-block-id={block.id}
        data-block-type={block.type}
        data-layout-width={block.layout.width}
        data-stack-id={block.layout.stackId}
        data-cell-id={stacked ? undefined : cell.id}
        data-composition={composition.kind}
        data-band-position={composition.position}
        className={`canvas-block block-type-${block.type}${stacked ? " is-stacked" : ""}${composition.kind ? ` is-${composition.kind}` : ""}${selectedBlockId === block.id ? " is-selected" : ""}${drag?.kind === "block" && drag.id === block.id ? " is-being-dragged" : ""}${dropClass}`}
        style={
          {
            gridColumn: `span ${
              stacked ? Math.min(block.layout.width, cell.width) : cell.width
            }`,
            minHeight:
              composition.kind === "kpi-band"
                ? Math.max(block.layout.minHeight, KPI_BAND_MIN_HEIGHT)
                : block.layout.minHeight,
            color: block.style.textColor,
            paddingBlock: verticalCardPadding(block.style.padding),
            paddingInline: block.style.padding,
            borderRadius: block.style.cornerRadius,
            borderColor: block.style.border ? "var(--line)" : "transparent",
            boxShadow:
              block.style.shadow === "raised"
                ? "var(--shadow-raised)"
                : block.style.shadow === "soft"
                  ? "var(--shadow-soft)"
                  : "none",
            textAlign: block.style.alignH,
            alignItems:
              block.style.alignV === "middle"
                ? "center"
                : block.style.alignV === "bottom"
                  ? "flex-end"
                  : "stretch",
            fontSize: `${block.style.fontScale}%`,
            "--block-accent": block.style.accent,
            "--block-radius": `${block.style.cornerRadius}px`,
          } as React.CSSProperties
        }
        tabIndex={0}
        role="button"
        aria-label={block.title || block.type}
        onClick={(event) => {
          event.stopPropagation();
          onSelectBlock(block.id);
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          onSelectBlock(block.id);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDropTarget(
            dropTargetForBlock(
              dashboard.blocks,
              index,
              event.currentTarget.getBoundingClientRect(),
              event.clientX,
              event.clientY,
            ),
          );
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const destination = dropTargetForBlock(
            dashboard.blocks,
            index,
            event.currentTarget.getBoundingClientRect(),
            event.clientX,
            event.clientY,
          );
          void completeDrop(
            destination,
            dragPayloadFromTransfer(event.dataTransfer) ?? drag,
          );
        }}
      >
        <div
          className="canvas-block__drop-stack canvas-block__drop-stack--above"
          aria-hidden="true"
          style={{
            height: Math.max(36, Math.min(120, block.layout.minHeight * 0.3)),
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setDropTarget({
              kind: "stack",
              targetId: block.id,
              position: "above",
            });
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void completeDrop(
              { kind: "stack", targetId: block.id, position: "above" },
              dragPayloadFromTransfer(event.dataTransfer) ?? drag,
            );
          }}
        />
        <div
          className="canvas-block__drop-stack canvas-block__drop-stack--below"
          aria-hidden="true"
          style={{
            height: Math.max(36, Math.min(120, block.layout.minHeight * 0.3)),
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setDropTarget({
              kind: "stack",
              targetId: block.id,
              position: "below",
            });
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void completeDrop(
              { kind: "stack", targetId: block.id, position: "below" },
              dragPayloadFromTransfer(event.dataTransfer) ?? drag,
            );
          }}
        />
        <div
          className="canvas-block__drag"
          draggable
          title="Drag to move"
          onDragStart={(event) => {
            event.stopPropagation();
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", `move:${block.id}`);
            setDrag({ kind: "block", id: block.id });
            onSelectBlock(block.id);
          }}
          onDragEnd={() => {
            setDrag(null);
            setDropTarget(null);
          }}
        >
          <GripHorizontal size={15} />
        </div>
        {selectedBlockId === block.id && (
          <button
            className="canvas-block__delete"
            aria-label="Delete block"
            onClick={(event) => {
              event.stopPropagation();
              void bus.execute("remove_block", { blockId: block.id });
              onSelectBlock(undefined);
            }}
          >
            ×
          </button>
        )}
        {block.buildState === "placeholder" ? (
          <TilePlaceholder
            block={block}
            bus={bus}
            onManual={() => onSelectBlock(block.id)}
          />
        ) : (
          <BlockRenderer block={block} project={project} />
        )}
        {selectedBlockId === block.id && (
          <>
            {!stacked && rightCell && (
              <div
                className="canvas-block__resize-x"
                role="separator"
                aria-label="Resize block width"
                aria-valuetext={`${cell.width} of ${CANVAS_COLUMNS} columns; ${row.length - 1} other card${row.length === 2 ? "" : "s"} share the rest`}
                title="Drag the divider—the other cards in this row share the remaining width"
                onPointerDown={(event) => resizeWidth(event, row, cellIndex)}
              />
            )}
            {stacked &&
              subRowPartner &&
              block.layout.width + subRowPartner.layout.width >
                MIN_BLOCK_WIDTH * 2 && (
                <div
                  className="canvas-block__resize-x"
                  role="separator"
                  aria-label="Resize block width"
                  aria-valuetext={`${block.layout.width} columns; card to the right ${subRowPartner.layout.width} columns`}
                  title="Drag the divider—one card grows as its partner shrinks"
                  onPointerDown={(event) =>
                    resizeStackWidth(event, cell, block, subRowPartner)
                  }
                />
              )}
            <div
              className="canvas-block__resize-y"
              role="separator"
              aria-label="Resize block height"
              onPointerDown={(event) => resizeHeight(event, block)}
            />
          </>
        )}
      </div>
    );
  };

  return (
    <main className="studio has-inspector">
      <header className="studio-toolbar">
        <div className="dashboard-tabs" role="tablist" aria-label="Dashboards">
          <select
            className="sr-only"
            aria-label="Current dashboard"
            value={dashboard.id}
            onChange={(event) => {
              void bus.execute("activate_dashboard", {
                dashboardId: event.target.value,
              });
              onSelectBlock(undefined);
            }}
          >
            {visibleDashboards.map((item) => (
              <option key={item.id} value={item.id}>
                {dashboardSeriesName(project, item)}
              </option>
            ))}
          </select>
          {visibleDashboards.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={item.id === dashboard.id}
              className={item.id === dashboard.id ? "is-active" : ""}
              onClick={() => {
                void bus.execute("activate_dashboard", {
                  dashboardId: item.id,
                });
                onSelectBlock(undefined);
              }}
            >
              <span>{dashboardSeriesName(project, item)}</span>
              {item.edition?.status === "draft" && (
                <small className="dashboard-tab__status">Draft</small>
              )}
            </button>
          ))}
          <button
            className="dashboard-tabs__add"
            onClick={onNewDashboard}
            aria-label="New dashboard"
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="studio-toolbar__context">
          <LayoutGrid size={14} />
          <span>{dashboard.blocks.length} blocks</span>
          <i />
          <Database size={14} />
          <span>{project.warehouse.length} datasets</span>
        </div>
      </header>

      <nav className="dashboard-subnav" aria-label="On this dashboard">
        <span>On this dashboard</span>
        {sectionLinks.map((section) => (
          <button
            key={section.id}
            className={section.id === activeSectionId ? "is-active" : ""}
            aria-current={
              section.id === activeSectionId ? "location" : undefined
            }
            onClick={() => {
              setActiveSectionId(section.id);
              const target = document.querySelector<HTMLElement>(
                `[data-block-id="${section.id}"]`,
              );
              target?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            {section.label}
          </button>
        ))}
        <i />
        <strong>
          <span /> Every block reads a clean table · {reportPeriod}
        </strong>
      </nav>

      <aside className="block-library">
        <PaletteGroup
          label="Layout"
          types={CONTENT_BLOCKS}
          onAdd={addBlock}
          onDrag={(payload) => {
            setDrag(payload);
            if (!payload) setDropTarget(null);
          }}
        />
        <PaletteGroup
          label="Data"
          types={CORE_DATA_BLOCKS}
          onAdd={addBlock}
          onDrag={(payload) => {
            setDrag(payload);
            if (!payload) setDropTarget(null);
          }}
        />
        <PaletteGroup
          label="Advanced"
          types={ADVANCED_BLOCKS}
          onAdd={addBlock}
          onDrag={(payload) => {
            setDrag(payload);
            if (!payload) setDropTarget(null);
          }}
        />
        <div className="webmcp-note">
          <Sparkles size={15} />
          <div>
            <strong>WebMCP native</strong>
            <span>Every visible block has its own tool.</span>
          </div>
        </div>
      </aside>

      <section
        className={`canvas-scroll${drag ? " is-dragging" : ""}`}
        onScroll={(event) => updateActiveSectionFromScroll(event.currentTarget)}
        onClick={() => onSelectBlock(undefined)}
        onDragOver={(event) => {
          event.preventDefault();
          if (event.target === event.currentTarget) {
            setDropTarget({ kind: "row", index: canvasRows.length });
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          void completeDrop(
            dropTarget ?? { kind: "row", index: canvasRows.length },
            dragPayloadFromTransfer(event.dataTransfer) ?? drag,
          );
        }}
      >
        <div className="dashboard-paper" data-kit={kit.id} style={kitStyle}>
          <header
            className={`dashboard-page-band dashboard-page-band--editable${headerEditor ? " is-editing" : ""}`}
            onClick={(event) => event.stopPropagation()}
          >
            {headerEditor?.field === "eyebrow" ? (
              <input
                autoFocus
                aria-label="Edit dashboard header label"
                className="dashboard-page-band__editor dashboard-page-band__editor--eyebrow"
                value={headerEditor.value}
                onBlur={() => void commitHeaderEdit()}
                onChange={(event) =>
                  setHeaderEditor({
                    field: "eyebrow",
                    value: event.target.value,
                  })
                }
                onKeyDown={handleHeaderEditorKeyDown}
              />
            ) : (
              <button
                aria-label="Edit dashboard header label"
                className="dashboard-page-band__eyebrow dashboard-page-band__field"
                title="Click to edit"
                type="button"
                onClick={() => startHeaderEdit("eyebrow", headerEyebrow)}
              >
                <span>{headerEyebrow}</span>
                <Pencil aria-hidden="true" size={12} />
              </button>
            )}
            <h1>
              {headerEditor?.field === "name" ? (
                <input
                  autoFocus
                  aria-label="Edit dashboard title"
                  className="dashboard-page-band__editor dashboard-page-band__editor--title"
                  value={headerEditor.value}
                  onBlur={() => void commitHeaderEdit()}
                  onChange={(event) =>
                    setHeaderEditor({
                      field: "name",
                      value: event.target.value,
                    })
                  }
                  onKeyDown={handleHeaderEditorKeyDown}
                />
              ) : (
                <button
                  aria-label="Edit dashboard title"
                  className="dashboard-page-band__field dashboard-page-band__field--title"
                  title="Click to edit"
                  type="button"
                  onClick={() => startHeaderEdit("name", dashboard.name)}
                >
                  <span>{dashboard.name}</span>
                  <Pencil aria-hidden="true" size={18} />
                </button>
              )}
            </h1>
            <p>
              {headerEditor?.field === "description" ? (
                <textarea
                  autoFocus
                  aria-label="Edit dashboard description"
                  className="dashboard-page-band__editor dashboard-page-band__editor--description"
                  rows={2}
                  value={headerEditor.value}
                  onBlur={() => void commitHeaderEdit()}
                  onChange={(event) =>
                    setHeaderEditor({
                      field: "description",
                      value: event.target.value,
                    })
                  }
                  onKeyDown={handleHeaderEditorKeyDown}
                />
              ) : (
                <button
                  aria-label="Edit dashboard description"
                  className="dashboard-page-band__field dashboard-page-band__field--description"
                  title="Click to edit"
                  type="button"
                  onClick={() =>
                    startHeaderEdit(
                      "description",
                      dashboard.description ||
                        "A focused operating view built from this dashboard group’s cleaned data.",
                    )
                  }
                >
                  <span>
                    {dashboard.description ||
                      "A focused operating view built from this dashboard group’s cleaned data."}
                  </span>
                  <Pencil aria-hidden="true" size={13} />
                </button>
              )}
            </p>
          </header>

          {!dashboard.blocks.length ? (
            <section
              className="warm-empty canvas-empty"
              data-testid="canvas-empty"
            >
              <span className="empty-icon">
                <LayoutGrid size={23} />
              </span>
              <span className="eyebrow">BLANK CANVAS</span>
              <h2>Your first story starts here.</h2>
              <p>
                Drag in a block or connect a chart after bringing data into this
                project’s warehouse.
              </p>
              <div>
                <button
                  className="primary-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void addBlock("sectionHeader");
                  }}
                >
                  <Plus size={15} /> Add section header
                </button>
                <button
                  className="secondary-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void addBlock("kpi");
                  }}
                >
                  Add KPI
                </button>
              </div>
            </section>
          ) : (
            <div
              className="dashboard-grid"
              style={canvasStyle}
              onDragOver={(event) => {
                event.preventDefault();
                if (event.target === event.currentTarget) {
                  setDropTarget(
                    rowDropTargetFromPointer(
                      event.currentTarget,
                      canvasRows,
                      event.clientY,
                    ),
                  );
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void completeDrop(
                  dropTarget ?? { kind: "row", index: canvasRows.length },
                  dragPayloadFromTransfer(event.dataTransfer) ?? drag,
                );
              }}
            >
              {canvasRows.map((row, rowIndex) => (
                <Fragment key={row.map((cell) => cell.id).join(":")}>
                  {drag &&
                    dropTarget?.kind === "row" &&
                    dropTarget.index === rowIndex && (
                      <div
                        className="canvas-drop-row"
                        data-drop-row={rowIndex}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setDropTarget({ kind: "row", index: rowIndex });
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void completeDrop(
                            { kind: "row", index: rowIndex },
                            dragPayloadFromTransfer(event.dataTransfer) ?? drag,
                          );
                        }}
                      >
                        Drop into a new row
                      </div>
                    )}
                  {row.map((cell, cellIndex) => {
                    const rightCell = row[cellIndex + 1];
                    if (cell.blocks.length === 1)
                      return renderCanvasBlock(
                        cell.blocks[0],
                        cell,
                        row,
                        cellIndex,
                        false,
                      );
                    const selectedInStack = cell.blocks.some(
                      (block) => block.id === selectedBlockId,
                    );
                    return (
                      <div
                        key={cell.id}
                        className={`canvas-stack${selectedInStack ? " has-selection" : ""}`}
                        data-cell-id={cell.id}
                        data-stack-id={cell.id}
                        data-layout-width={cell.width}
                        style={
                          {
                            gridColumn: `span ${cell.width}`,
                            "--stack-columns": cell.width,
                          } as React.CSSProperties
                        }
                      >
                        {cell.blocks.map((block) =>
                          renderCanvasBlock(block, cell, row, cellIndex, true),
                        )}
                        {selectedInStack && rightCell && (
                          <div
                            className="canvas-block__resize-x"
                            role="separator"
                            aria-label="Resize block width"
                            aria-valuetext={`${cell.width} of ${CANVAS_COLUMNS} columns; ${row.length - 1} other card${row.length === 2 ? "" : "s"} share the rest`}
                            title="Drag the divider—the other cards in this row share the remaining width"
                            onPointerDown={(event) =>
                              resizeWidth(event, row, cellIndex)
                            }
                          />
                        )}
                      </div>
                    );
                  })}
                </Fragment>
              ))}
              {drag &&
                dropTarget?.kind === "row" &&
                dropTarget.index === canvasRows.length && (
                  <div
                    className="canvas-drop-row canvas-drop-end"
                    data-drop-row={canvasRows.length}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void completeDrop(
                        {
                          kind: "row",
                          index: canvasRows.length,
                        },
                        dragPayloadFromTransfer(event.dataTransfer) ?? drag,
                      );
                    }}
                  >
                    Drop to add a new row
                  </div>
                )}
            </div>
          )}
        </div>
      </section>

      {selected ? (
        <BlockInspector
          block={selected}
          project={project}
          bus={bus}
          onClose={() => onSelectBlock(undefined)}
          onOpenWarehouse={onOpenWarehouse}
        />
      ) : (
        <CanvasSettings
          dashboard={dashboard}
          project={project}
          bus={bus}
          agentConnected={agentConnected}
          reportingPeriod={reportingPeriod}
          onOpenAgent={onOpenAgent}
        />
      )}

      {selected && (
        <div className="selection-toolbar" aria-label="Selected block actions">
          <strong>1 selected</strong>
          <button
            disabled={selectedIndex <= 0}
            onClick={() =>
              void bus.execute("move_block", {
                blockId: selected.id,
                index: selectedIndex - 1,
              })
            }
          >
            <ArrowLeft size={13} /> Earlier
          </button>
          <button
            disabled={selectedIndex >= dashboard.blocks.length - 1}
            onClick={() =>
              void bus.execute("move_block", {
                blockId: selected.id,
                index: selectedIndex + 1,
              })
            }
          >
            Later <ArrowRight size={13} />
          </button>
          <button
            onClick={() =>
              void bus
                .execute("duplicate_block", { blockId: selected.id })
                .then((copy) => onSelectBlock((copy as DashboardBlock).id))
            }
          >
            <Copy size={13} /> Duplicate
          </button>
          <span />
          <button
            className="is-danger"
            onClick={() => {
              void bus.execute("remove_block", { blockId: selected.id });
              onSelectBlock(undefined);
            }}
          >
            <Trash2 size={13} /> Delete
          </button>
        </div>
      )}
    </main>
  );
}

function TilePlaceholder({
  block,
  bus,
  onManual,
}: {
  block: DashboardBlock;
  bus: CommandBus;
  onManual: () => void;
}) {
  const Icon = BLOCK_ICONS[block.type];
  const [intent, setIntent] = useState(block.intent);
  const [message, setMessage] = useState("");

  const savedIntentRef = useRef(block.intent);

  useEffect(() => {
    setIntent(block.intent);
    savedIntentRef.current = block.intent;
  }, [block.id, block.intent]);

  const saveIntent = async () => {
    if (intent !== savedIntentRef.current) {
      const previous = savedIntentRef.current;
      savedIntentRef.current = intent;
      try {
        await bus.execute("update_tile_placeholder", {
          blockId: block.id,
          intent,
          mode: "agent",
        });
      } catch (error) {
        savedIntentRef.current = previous;
        throw error;
      }
    }
    setMessage(
      intent.trim()
        ? "Saved. Ask your agent to build out the tile placeholders you added."
        : "Add a short brief so your agent knows what belongs here.",
    );
  };

  const setMode = async (mode: "agent" | "manual") => {
    savedIntentRef.current = intent;
    await bus.execute("update_tile_placeholder", {
      blockId: block.id,
      mode,
      intent,
    });
    setMessage("");
    if (mode === "manual") onManual();
  };

  const finishManual = async () => {
    try {
      await bus.execute("complete_tile_placeholder", { blockId: block.id });
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Finish the required settings first.",
      );
    }
  };

  return (
    <article
      className="tile-placeholder"
      onClick={(event) => event.stopPropagation()}
    >
      <header>
        <span className="tile-placeholder__icon" aria-hidden="true">
          <Icon size={15} />
        </span>
        <strong>{BLOCK_LABELS[block.type]} tile</strong>
        <em>EMPTY</em>
        <button
          className="tile-placeholder__manual"
          type="button"
          onClick={() =>
            void setMode(block.buildMode === "manual" ? "agent" : "manual")
          }
        >
          {block.buildMode === "manual" ? "Use agent" : "Manual"}
        </button>
      </header>
      {block.buildMode === "agent" ? (
        <>
          <div className="tile-placeholder__prompt">
            <Bot size={17} aria-hidden="true" />
            <textarea
              aria-label={`Describe the ${BLOCK_LABELS[block.type]} tile`}
              rows={2}
              placeholder="Tell your agent what this should show…"
              value={intent}
              onChange={(event) => setIntent(event.target.value)}
              onBlur={() => void saveIntent()}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter")
                  void saveIntent();
              }}
            />
            <button type="button" onClick={() => void saveIntent()}>
              Save brief
            </button>
          </div>
          <p>
            Describe the outcome, not the settings. Your agent can inspect the
            clean tables, choose the fields, and fill this exact tile without
            moving it.
          </p>
        </>
      ) : (
        <div className="tile-placeholder__manual-body">
          <div>
            <SlidersHorizontal size={18} aria-hidden="true" />
            <span>
              Tune the Data, Block, and Kit settings in the side panel. This
              tile stays blank until you finish setup.
            </span>
          </div>
          <button type="button" onClick={() => void finishManual()}>
            Finish manual setup
          </button>
        </div>
      )}
      {message && <small role="status">{message}</small>}
    </article>
  );
}

function PaletteGroup({
  label,
  types,
  onAdd,
  onDrag,
}: {
  label: string;
  types: BlockType[];
  onAdd: (type: BlockType) => Promise<void>;
  onDrag: (payload: DragPayload | null) => void;
}) {
  return (
    <div className="block-library__group">
      <span>{label}</span>
      {types.map((type) => (
        <PaletteButton key={type} type={type} onAdd={onAdd} onDrag={onDrag} />
      ))}
    </div>
  );
}

function PaletteButton({
  type,
  onAdd,
  onDrag,
}: {
  type: BlockType;
  onAdd: (type: BlockType) => Promise<void>;
  onDrag: (payload: DragPayload | null) => void;
}) {
  const Icon = BLOCK_ICONS[type];
  return (
    <button
      draggable
      aria-label={`Add ${BLOCK_LABELS[type]}`}
      onClick={() => void onAdd(type)}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("text/plain", `new:${type}`);
        onDrag({ kind: "new", type });
      }}
      onDragEnd={() => onDrag(null)}
    >
      <span>
        <Icon size={16} />
      </span>
      <div>
        <strong>{BLOCK_LABELS[type]}</strong>
        <small>{COPY[type]}</small>
      </div>
      <Plus size={14} />
    </button>
  );
}

function CanvasSettings({
  dashboard,
  project,
  bus,
  agentConnected,
  reportingPeriod,
  onOpenAgent,
}: {
  dashboard: Dashboard;
  project: TesseraProject;
  bus: CommandBus;
  agentConnected: boolean;
  reportingPeriod: string;
  onOpenAgent: () => void;
}) {
  const activeKit = kitFor(dashboard);
  const [tab, setTab] = useState<"agent" | "data" | "block" | "kit">("agent");
  const prompts = useMemo(
    () => suggestedPrompts(project, { view: "dashboard" }),
    [project],
  );
  const boundAssets = project.warehouse.filter((asset) =>
    dashboard.blocks.some((block) => block.datasetId === asset.id),
  );
  const dashboardPeriodLabel = reportingPeriod
    ? reportingPeriodLabel(reportingPeriod)
    : "current month";
  const recent = project.activity
    .filter((entry) => entry.source === "webmcp")
    .slice(0, 3);
  return (
    <aside
      className={`inspector inspector--canvas inspector--${tab}`}
      aria-label="Canvas settings"
    >
      <div className="inspector-workspace-tabs" role="tablist">
        {(["agent", "data", "block", "kit"] as const).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            className={tab === item ? "is-active" : ""}
            onClick={() => setTab(item)}
          >
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>
      <header className="inspector__header">
        <span>
          {tab === "agent" ? (
            <Bot size={15} />
          ) : (
            <SlidersHorizontal size={15} />
          )}
        </span>
        <div>
          <small>{tab === "agent" ? "WEBMCP" : "DASHBOARD"}</small>
          <strong>
            {tab === "agent"
              ? "Your agent"
              : tab === "data"
                ? "Clean data"
                : tab === "block"
                  ? "Block settings"
                  : "Brand kit"}
          </strong>
        </div>
      </header>
      <div className="inspector__body inspector-canvas-body">
        {tab === "agent" && (
          <>
            <div
              className={`agent-status-card${agentConnected ? " is-live" : ""}`}
            >
              <span>
                <i /> {agentConnected ? "Connected" : "Ready to connect"}
              </span>
              <p>
                {agentConnected
                  ? "Your agent can read this dashboard and change any block through the same validated commands the editor uses."
                  : "Open this page in a WebMCP-capable browser and the tools register on their own."}
              </p>
              <button
                type="button"
                className="link-button"
                onClick={onOpenAgent}
              >
                Everything the agent can do
              </button>
            </div>
            <div className="agent-metrics">
              <span>
                <b>{dashboard.blocks.length}</b> blocks
              </span>
              <span>
                <b>{project.warehouse.length}</b> datasets
              </span>
            </div>
            <div className="agent-prompt-list">
              <span className="eyebrow">Try asking</span>
              {prompts.map((prompt) => (
                <AgentHint
                  key={prompt.title}
                  title={prompt.title}
                  prompt={prompt.text}
                  connected={agentConnected}
                />
              ))}
            </div>
            {recent.length > 0 && (
              <div className="agent-tool-feed">
                <span className="eyebrow">Recent agent actions</span>
                {recent.map((entry) => (
                  <div key={entry.id}>
                    <Check size={12} /> <span>{entry.summary}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {tab === "data" && (
          <div className="agent-data-list">
            <span className="eyebrow">Bound clean tables</span>
            {boundAssets.map((asset) => {
              const month = selectedReadyMonth(asset, reportingPeriod);
              return (
                <div key={asset.id}>
                  <i />
                  <span>
                    <strong>{asset.name}</strong>
                    <small>
                      {month
                        ? `${month.cleaned.rows.length} row${month.cleaned.rows.length === 1 ? "" : "s"} · ${month.cleaned.columns.length} fields · ${month.label}`
                        : `No approved ${dashboardPeriodLabel} table`}
                    </small>
                  </span>
                </div>
              );
            })}
            {!boundAssets.length && (
              <p className="inspector-hint">
                This dashboard is not bound to a dataset yet. Add or bind a card
                to a clean table in the Data Warehouse.
              </p>
            )}
          </div>
        )}
        {tab === "block" && (
          <div className="canvas-help-card">
            <GripHorizontal size={18} />
            <strong>Select a block on the page</strong>
            <p>
              Its content, data binding, chart controls, style, and layout will
              appear here.
            </p>
          </div>
        )}
        {tab === "kit" && (
          <div
            className="brand-kit-list"
            role="radiogroup"
            aria-label="Brand kit"
          >
            {KIT_LIST.map((candidate) => {
              const active = candidate.id === activeKit.id;
              return (
                <button
                  key={candidate.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`brand-kit-card${active ? " is-active" : ""}`}
                  onClick={() => {
                    if (active) return;
                    void bus.execute("set_dashboard_kit", {
                      dashboardId: dashboard.id,
                      kit: candidate.id,
                    });
                  }}
                >
                  <span className="eyebrow">{candidate.name}</span>
                  <h3>{candidate.tagline}</h3>
                  <div>
                    {[0, 1, 2, 3, 5].map((step) => (
                      <i
                        key={step}
                        style={{ background: candidate.palette[step] }}
                      />
                    ))}
                  </div>
                  <p>
                    {active
                      ? "Applied to this dashboard."
                      : "Recolours every default on this dashboard. Emphasis and hand-set colours keep their values."}
                  </p>
                </button>
              );
            })}
            <p className="brand-kit-note">
              Georgia for decision headlines. System sans for evidence.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}

function dragPayloadFromTransfer(
  dataTransfer: DataTransfer,
): DragPayload | null {
  const value = dataTransfer.getData("text/plain");
  if (value.startsWith("new:")) {
    const type = value.slice(4);
    return Object.prototype.hasOwnProperty.call(BLOCK_LABELS, type)
      ? { kind: "new", type: type as BlockType }
      : null;
  }
  if (value.startsWith("move:")) {
    const id = value.slice(5);
    return id ? { kind: "block", id } : null;
  }
  return null;
}

function dashboardRowForIndex(blocks: DashboardBlock[], index: number) {
  const rows = dashboardRows(blocks);
  const block = blocks[index];
  const rowIndex = rows.findIndex((row) =>
    row.some((cell) =>
      cell.blocks.some((candidate) => candidate.id === block?.id),
    ),
  );
  const row =
    rows[rowIndex] ??
    (block
      ? [{ id: block.id, blocks: [block], width: block.layout.width }]
      : []);
  return {
    row,
    rowIndex: Math.max(0, rowIndex),
    position: row.findIndex((cell) =>
      cell.blocks.some((candidate) => candidate.id === block?.id),
    ),
  };
}

function dropTargetForBlock(
  blocks: DashboardBlock[],
  index: number,
  rect: DOMRect,
  clientX: number,
  clientY: number,
): DropTarget {
  const verticalPosition = (clientY - rect.top) / Math.max(1, rect.height);
  if (verticalPosition <= 0.3)
    return {
      kind: "stack",
      targetId: blocks[index].id,
      position: "above",
    };
  if (verticalPosition >= 0.7)
    return {
      kind: "stack",
      targetId: blocks[index].id,
      position: "below",
    };
  return {
    kind: "beside",
    targetId: blocks[index].id,
    side: clientX < rect.left + rect.width / 2 ? "before" : "after",
  };
}

function rowDropTargetFromPointer(
  grid: HTMLElement,
  rows: DashboardCell[][],
  clientY: number,
): DropTarget {
  const cards = Array.from(
    grid.querySelectorAll<HTMLElement>(".canvas-block[data-block-id]"),
  );
  for (let index = 0; index < rows.length; index += 1) {
    const firstId = rows[index][0]?.blocks[0]?.id;
    const firstCard = cards.find((card) => card.dataset.blockId === firstId);
    if (!firstCard) continue;
    const rect = firstCard.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return { kind: "row", index };
  }
  return { kind: "row", index: rows.length };
}

function arrangeBlocksForDrop(
  blocks: DashboardBlock[],
  movingId: string,
  target: DropTarget,
): DashboardBlock[] {
  if (target.kind !== "row" && target.targetId === movingId) return blocks;
  const copies = blocks.map((block) => ({
    ...block,
    layout: { ...block.layout },
  }));
  const rows = dashboardRows(copies);
  const sourceRowIndex = rows.findIndex((row) =>
    row.some((cell) => cell.blocks.some((block) => block.id === movingId)),
  );
  if (sourceRowIndex < 0) return blocks;
  const sourceRow = rows[sourceRowIndex];
  const sourceCellIndex = sourceRow.findIndex((cell) =>
    cell.blocks.some((block) => block.id === movingId),
  );
  const sourceCell = sourceRow[sourceCellIndex];
  const sourceCellWasWhole = sourceCell.blocks.length === 1;
  const sourceCellHeight = stackCellHeight(sourceCell);
  const movingIndex = sourceCell.blocks.findIndex(
    (block) => block.id === movingId,
  );
  const [moving] = sourceCell.blocks.splice(movingIndex, 1);
  const targetStartedInSourceRow =
    target.kind !== "row" &&
    sourceRow.some((cell) =>
      cell.blocks.some((block) => block.id === target.targetId),
    );
  if (!sourceCell.blocks.length) sourceRow.splice(sourceCellIndex, 1);
  else normalizeStackCell(sourceCell, sourceCellHeight);
  const sourceRowEmptied = sourceRow.length === 0;
  if (sourceRowEmptied) rows.splice(sourceRowIndex, 1);
  else if (!targetStartedInSourceRow) normalizeRowWidths(sourceRow);

  if (target.kind === "beside") {
    const targetRowIndex = rows.findIndex((row) =>
      row.some((cell) =>
        cell.blocks.some((block) => block.id === target.targetId),
      ),
    );
    const besideCell = rows[targetRowIndex]?.find((cell) =>
      cell.blocks.some((block) => block.id === target.targetId),
    );
    if (
      besideCell &&
      (besideCell.blocks.length > 1 || besideCell === sourceCell) &&
      joinStackSubRow(besideCell, target.targetId, moving, target.side)
    ) {
      return rows.flatMap((row) => row.flatMap((cell) => cell.blocks));
    }
    clearStack(moving);
    if (targetRowIndex < 0) {
      moving.layout.width = CANVAS_COLUMNS;
      rows.push([cellForBlock(moving)]);
    } else {
      const targetRow = rows[targetRowIndex];
      if (targetRow.length >= MAX_BLOCKS_PER_ROW) {
        moving.layout.width = CANVAS_COLUMNS;
        rows.splice(targetRowIndex + 1, 0, [cellForBlock(moving)]);
      } else {
        const targetPosition = targetRow.findIndex((cell) =>
          cell.blocks.some((block) => block.id === target.targetId),
        );
        targetRow.splice(
          targetPosition + (target.side === "after" ? 1 : 0),
          0,
          cellForBlock(moving),
        );
        if (!(targetStartedInSourceRow && sourceCellWasWhole))
          evenRowWidths(targetRow);
      }
    }
  } else if (target.kind === "stack") {
    const targetRowIndex = rows.findIndex((row) =>
      row.some((cell) =>
        cell.blocks.some((block) => block.id === target.targetId),
      ),
    );
    const targetRow = rows[targetRowIndex];
    const targetCell = targetRow?.find((cell) =>
      cell.blocks.some((block) => block.id === target.targetId),
    );
    if (!targetCell) {
      clearStack(moving);
      moving.layout.width = CANVAS_COLUMNS;
      rows.push([cellForBlock(moving)]);
    } else {
      const targetHeight =
        targetStartedInSourceRow && targetCell.id === sourceCell.id
          ? sourceCellHeight
          : stackCellHeight(targetCell);
      const stackId =
        targetCell.blocks[0].layout.stackId ||
        `stack:${targetCell.blocks[0].id}:${moving.id}`;
      targetCell.blocks.forEach((block) => {
        block.layout.stackId = stackId;
      });
      moving.layout.stackId = stackId;
      moving.layout.width = targetCell.width;
      const targetPosition = targetCell.blocks.findIndex(
        (block) => block.id === target.targetId,
      );
      targetCell.blocks.splice(
        targetPosition + (target.position === "below" ? 1 : 0),
        0,
        moving,
      );
      targetCell.id = stackId;
      normalizeStackCell(targetCell, targetHeight);
      if (
        targetStartedInSourceRow &&
        sourceCellWasWhole &&
        targetCell !== sourceCell
      )
        normalizeRowWidths(targetRow);
    }
  } else {
    const adjustedIndex =
      target.index -
      (sourceRowEmptied && sourceRowIndex < target.index ? 1 : 0);
    const rowIndex = Math.max(0, Math.min(adjustedIndex, rows.length));
    clearStack(moving);
    moving.layout.width = CANVAS_COLUMNS;
    rows.splice(rowIndex, 0, [cellForBlock(moving)]);
  }

  return rows.flatMap((row) => row.flatMap((cell) => cell.blocks));
}

function cellForBlock(block: DashboardBlock): DashboardCell {
  return { id: block.id, blocks: [block], width: block.layout.width };
}

function clearStack(block: DashboardBlock) {
  delete block.layout.stackId;
}

function stackCellHeight(cell: DashboardCell) {
  const rows = stackRows(cell);
  return (
    rows.reduce(
      (sum, row) =>
        sum + Math.max(...row.map((block) => block.layout.minHeight)),
      0,
    ) +
    STACK_GAP * Math.max(0, rows.length - 1)
  );
}

function joinStackSubRow(
  cell: DashboardCell,
  targetId: string,
  moving: DashboardBlock,
  side: "before" | "after",
) {
  const target = cell.blocks.find((block) => block.id === targetId);
  if (!target) return false;
  const subRow = stackRows(cell).find((row) =>
    row.some((block) => block.id === targetId),
  ) ?? [target];
  const used = subRow.reduce(
    (sum, block) => sum + Math.min(block.layout.width, cell.width),
    0,
  );
  const free = cell.width - used;
  if (free >= MIN_BLOCK_WIDTH) {
    moving.layout.width = free as DashboardBlock["layout"]["width"];
  } else {
    const half = Math.floor(target.layout.width / 2);
    if (half < MIN_BLOCK_WIDTH) return false;
    moving.layout.width = half as DashboardBlock["layout"]["width"];
    target.layout.width = (target.layout.width -
      half) as DashboardBlock["layout"]["width"];
  }
  const stackId =
    cell.blocks[0].layout.stackId || `stack:${cell.blocks[0].id}:${moving.id}`;
  cell.blocks.forEach((block) => {
    block.layout.stackId = stackId;
  });
  moving.layout.stackId = stackId;
  moving.layout.minHeight = target.layout.minHeight;
  const at = cell.blocks.findIndex((block) => block.id === targetId);
  cell.blocks.splice(at + (side === "after" ? 1 : 0), 0, moving);
  cell.id = stackId;
  return true;
}

function normalizeStackCell(cell: DashboardCell, requestedHeight: number) {
  if (cell.blocks.length === 1) {
    clearStack(cell.blocks[0]);
    cell.blocks[0].layout.minHeight = Math.min(
      MAX_STACK_ITEM_HEIGHT,
      Math.max(MIN_STACK_ITEM_HEIGHT, requestedHeight),
    );
    cell.id = cell.blocks[0].id;
    cell.blocks[0].layout.width = cell.width;
    return;
  }
  const stackId =
    cell.blocks[0].layout.stackId ||
    `stack:${cell.blocks[0].id}:${cell.blocks[1].id}`;
  cell.blocks.forEach((block) => {
    block.layout.stackId = stackId;
  });
  fillStackRows(cell);
  const rows = stackRows(cell);
  const available = Math.min(
    MAX_STACK_ITEM_HEIGHT * rows.length,
    Math.max(
      MIN_STACK_ITEM_HEIGHT * rows.length,
      requestedHeight - STACK_GAP * (rows.length - 1),
    ),
  );
  const baseHeight = Math.floor(available / rows.length);
  let remainder = Math.round(available - baseHeight * rows.length);
  rows.forEach((row) => {
    const height = baseHeight + (remainder > 0 ? 1 : 0);
    remainder -= remainder > 0 ? 1 : 0;
    row.forEach((block) => {
      block.layout.minHeight = height;
    });
  });
  cell.id = stackId;
}

function evenRowWidths(row: DashboardCell[]) {
  const width = CANVAS_COLUMNS / row.length;
  row.forEach((cell) => {
    setCellWidth(cell, clampLayoutWidth(width));
  });
}

function normalizeRowWidths(row: DashboardCell[]) {
  if (row.length === 1) {
    setCellWidth(row[0], CANVAS_COLUMNS);
    return;
  }
  const total = row.reduce((sum, cell) => sum + cell.width, 0);
  const ideals = row.map((cell) =>
    Math.max(MIN_BLOCK_WIDTH, (CANVAS_COLUMNS * cell.width) / total),
  );
  const widths = ideals.map((ideal) =>
    Math.max(MIN_BLOCK_WIDTH, Math.floor(ideal)),
  );
  let allocated = widths.reduce((sum, width) => sum + width, 0);
  while (allocated < CANVAS_COLUMNS) {
    let best = 0;
    for (let index = 1; index < widths.length; index += 1) {
      if (ideals[index] - widths[index] > ideals[best] - widths[best])
        best = index;
    }
    widths[best] += 1;
    allocated += 1;
  }
  while (allocated > CANVAS_COLUMNS) {
    let best = -1;
    for (let index = 0; index < widths.length; index += 1) {
      if (widths[index] <= MIN_BLOCK_WIDTH) continue;
      if (
        best < 0 ||
        widths[index] - ideals[index] > widths[best] - ideals[best]
      )
        best = index;
    }
    if (best < 0) break;
    widths[best] -= 1;
    allocated -= 1;
  }
  row.forEach((cell, index) => {
    setCellWidth(cell, clampLayoutWidth(widths[index]));
  });
}

function clampLayoutWidth(
  value: number,
  minimum = MIN_BLOCK_WIDTH,
  maximum = CANVAS_COLUMNS,
): DashboardBlock["layout"]["width"] {
  return Math.max(
    minimum,
    Math.min(maximum, Math.round(value)),
  ) as DashboardBlock["layout"]["width"];
}

function blockComposition(blocks: DashboardBlock[], index: number) {
  const row = dashboardRowForIndex(blocks, index);
  const rowCells = row.row;
  const currentCell = rowCells[row.position];
  if (!currentCell || currentCell.blocks.length > 1)
    return { kind: undefined, position: undefined };
  const positionIndex = row.position;
  if (
    rowCells.length >= 2 &&
    rowCells.every(
      (cell) =>
        cell.blocks.length === 1 &&
        cell.blocks[0].type === "kpi" &&
        cell.width === 3,
    )
  ) {
    return {
      kind: "kpi-band",
      position:
        positionIndex === 0
          ? "start"
          : positionIndex === rowCells.length - 1
            ? "end"
            : "middle",
    };
  }
  const isChartAndCommentaryPair =
    rowCells.length === 2 &&
    rowCells.every((cell) => cell.blocks.length === 1) &&
    rowCells.some((cell) => CHART_TYPES.includes(cell.blocks[0].type)) &&
    rowCells.some((cell) => cell.blocks[0].type === "text");
  if (isChartAndCommentaryPair) {
    const isCommentary = currentCell.blocks[0].type === "text";
    return {
      kind: isCommentary ? "commentary-rail" : "evidence-primary",
      position: positionIndex === 0 ? "start" : "end",
    };
  }
  return { kind: undefined, position: undefined };
}

function dashboardSections(dashboard: Dashboard) {
  const sections = dashboard.blocks
    .filter((block) => block.type === "sectionHeader")
    .map((block) => ({
      id: block.id,
      label:
        block.chip ||
        block.eyebrow.split("·").at(-1)?.trim() ||
        block.title.split(/[—:]/)[0].trim(),
    }));
  if (sections.length) return sections;
  const fallback = dashboard.blocks.find((block) =>
    CHART_TYPES.includes(block.type),
  );
  return fallback ? [{ id: fallback.id, label: "Drivers" }] : [];
}
