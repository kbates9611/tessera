import {
  Check,
  ChevronDown,
  Copy,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { CommandBus } from "../../domain/commands";
import {
  DEFAULT_SANKEY_COLORS,
  defaultGaugeSettings,
  defaultTableSettings,
} from "../../domain/defaults";
import type { KpiIconName } from "../../domain/kpiIcons";
import { ILLUSTRATION_PRESETS } from "../../domain/illustrations";
import {
  combineAssetMonths,
  findAsset,
  numericColumns,
  selectedReadyMonth,
  textColumns,
} from "../../domain/selectors";
import {
  BLOCK_LABELS,
  type DataTable,
  type DashboardBlock,
  type TableSortRule,
  type TesseraProject,
  type ValueFormat,
} from "../../domain/types";
import { KPI_ICON_LIBRARY } from "./kpiIcons";
import { IllustrationArtwork } from "./IllustrationCard";
import {
  reportingPeriodLabel,
  throughPeriodCutoff,
} from "../../domain/dashboardPeriods";

const FORMATS: Array<{ value: ValueFormat; label: string }> = [
  { value: "auto", label: "Automatic" },
  { value: "number", label: "Number" },
  { value: "compact", label: "Compact" },
  { value: "percent", label: "Percent" },
  { value: "currency", label: "Currency" },
];

const BLUE_CHART_PALETTE = [
  "#1c2b4a",
  "#355f9d",
  "#4d76b3",
  "#7897c4",
  "#b7c9e2",
  "#dbe6f3",
] as const;

const BLOCK_GUIDES: Record<
  string,
  { headline: string; question: string; tip: string }
> = {
  illustration: {
    headline: "Flat faceless monoline art",
    question: "What simple scene should make the dashboard memorable?",
    tip: "Choose an approved scene or ask an image-capable agent for a custom pixel-masked scene, then tint it with any RGB color.",
  },
  kpi: {
    headline: "Compact headline metric",
    question: "What should an executive know first?",
    tip: "Keep the title short. Add a comparison or target only when it changes the decision.",
  },
  table: {
    headline: "Evidence and appendix",
    question: "What records support the story above?",
    tip: "Keep only decision-useful columns visible; enable search for long lists.",
  },
  bar: {
    headline: "Rank categories",
    question: "Which categories are largest or smallest?",
    tip: "Sort by value and keep labels on when the set is short.",
  },
  horizontalBar: {
    headline: "Rank long labels",
    question: "How do named items compare?",
    tip: "Best for facilities, suppliers, and any labels too long for an x-axis.",
  },
  groupedBar: {
    headline: "Compare series",
    question: "Where do two or more measures diverge?",
    tip: "Use two or three series with a visible legend; avoid crowded groups.",
  },
  line: {
    headline: "Show movement",
    question: "How is performance changing over time?",
    tip: "Keep source order, add a target line, and label only the points that matter.",
  },
  donut: {
    headline: "Explain composition",
    question: "What makes up the whole?",
    tip: "Use a few meaningful slices and a center label that names the total.",
  },
  sankey: {
    headline: "Trace flow",
    question: "Where does volume originate and end?",
    tip: "Use branch colors and value labels to make volume and concentration visible at a glance.",
  },
  gauge: {
    headline: "Frame a target",
    question: "How close is one measure to plan?",
    tip: "Set honest minimum and maximum bounds so progress is not exaggerated.",
  },
  scatter: {
    headline: "Find relationships",
    question: "Do two measures move together—and which records are outliers?",
    tip: "Use value labels to identify points, then set clear axis titles.",
  },
  treemap: {
    headline: "Map contribution",
    question: "Which contributors dominate a large mix?",
    tip: "Use when there are more categories than a donut can comfortably hold.",
  },
  heatmap: {
    headline: "Scan a matrix",
    question: "Where are the hot and cold spots across several measures?",
    tip: "Choose measures with comparable units and keep values visible for precision.",
  },
};

export function BlockInspector({
  block,
  project,
  bus,
  onClose,
  onOpenWarehouse,
}: {
  block: DashboardBlock;
  project: TesseraProject;
  bus: CommandBus;
  onClose: () => void;
  /** Jump to the warehouse table this block reads from. */
  onOpenWarehouse: (datasetId: string, period?: string) => void;
}) {
  const asset = findAsset(project, block.datasetId);
  const through = throughPeriodCutoff(block.period);
  const month = selectedReadyMonth(asset, through ?? block.period);
  const provenanceMonth =
    month ?? (block.period === "all" ? selectedReadyMonth(asset) : undefined);
  const table =
    (block.period === "all" || through) && asset
      ? combineAssetMonths(asset, through)
      : month?.cleaned;
  const gaugeDefaults = defaultGaugeSettings();
  const gauge = {
    ...gaugeDefaults,
    ...block.gauge,
    colors: { ...gaugeDefaults.colors, ...block.gauge?.colors },
    ranges: block.gauge?.ranges ?? gaugeDefaults.ranges,
  };
  const tableSettings = { ...defaultTableSettings(), ...block.table };
  const tableSortRules = tableSettings.sortRules.length
    ? tableSettings.sortRules
    : tableSettings.sortColumn && tableSettings.sortDirection !== "none"
      ? [
          {
            column: tableSettings.sortColumn,
            direction: tableSettings.sortDirection,
          },
        ]
      : [];
  const allColumns = table?.columns ?? [];
  const numbers = numericColumns(table);
  const text = textColumns(table);
  const categoryIndex = table?.columns.indexOf(block.categoryField ?? "") ?? -1;
  const categoryValues = useMemo(
    () =>
      categoryIndex < 0
        ? []
        : [
            ...new Set(
              table?.rows
                .map((row) => String(row[categoryIndex] ?? ""))
                .filter(Boolean),
            ),
          ],
    [table, categoryIndex],
  );
  const scatterLabelIndex =
    table?.columns.indexOf(block.labelField ?? "") ?? -1;
  const scatterPointLabels =
    scatterLabelIndex < 0
      ? []
      : [
          ...new Set(
            table?.rows
              .map((row) => String(row[scatterLabelIndex] ?? ""))
              .filter(Boolean),
          ),
        ];
  const isChart = [
    "bar",
    "horizontalBar",
    "groupedBar",
    "line",
    "donut",
    "sankey",
    "gauge",
    "scatter",
    "treemap",
    "heatmap",
  ].includes(block.type);
  const supportsLegend =
    block.type === "donut" ||
    block.type === "heatmap" ||
    (block.type === "scatter" && Boolean(block.seriesField)) ||
    (["groupedBar", "line"].includes(block.type) &&
      block.valueFields.length > 1);
  const supportsValueLabels = !["gauge", "donut"].includes(block.type);
  const supportsCartesianControls = [
    "bar",
    "groupedBar",
    "line",
    "scatter",
  ].includes(block.type);
  const supportsGuideLines = ["bar", "groupedBar", "line"].includes(block.type);
  const supportsSort = [
    "bar",
    "horizontalBar",
    "groupedBar",
    "donut",
    "heatmap",
  ].includes(block.type);
  const chartColorIndexes = (() => {
    if (block.type === "gauge") {
      return [];
    }
    if (["bar", "horizontalBar"].includes(block.type)) return [0];
    if (block.type === "scatter") {
      const seriesIndex = table?.columns.indexOf(block.seriesField ?? "") ?? -1;
      const seriesCount =
        seriesIndex < 0
          ? 1
          : new Set(table?.rows.map((row) => String(row[seriesIndex] ?? "")))
              .size;
      return Array.from(
        {
          length: Math.min(block.chart.colors.length, Math.max(1, seriesCount)),
        },
        (_, index) => index,
      );
    }
    if (["groupedBar", "line"].includes(block.type)) {
      return Array.from(
        {
          length: Math.min(
            block.chart.colors.length,
            Math.max(1, block.valueFields.length),
          ),
        },
        (_, index) => index,
      );
    }
    return block.chart.colors.map((_, index) => index);
  })();
  const guide = BLOCK_GUIDES[block.type];
  const [activePanel, setActivePanel] = useState<"Data" | "Block" | "Kit">(
    "Block",
  );
  const [scatterPointSelection, setScatterPointSelection] = useState("");
  const [completionError, setCompletionError] = useState("");
  const [patchError, setPatchError] = useState("");

  // Every inspector edit goes through the same validated command the agent
  // uses; a refused edit is shown instead of silently dropped.
  const patch = (value: Partial<DashboardBlock>) =>
    void bus
      .execute("update_block", {
        blockId: block.id,
        patch: compactInspectorPatch(block, value),
      })
      .then(() => setPatchError(""))
      .catch((error: unknown) =>
        setPatchError(error instanceof Error ? error.message : String(error)),
      );
  const focusSection = (panel: "Data" | "Block" | "Kit") => {
    setActivePanel(panel);
    const title =
      panel === "Data"
        ? "Data binding"
        : panel === "Kit"
          ? "Block style"
          : "Content";
    const section = document.querySelector<HTMLDetailsElement>(
      `.inspector-section[data-section="${title}"]`,
    );
    if (section) {
      section.open = true;
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <aside
      className="inspector"
      aria-label={`${BLOCK_LABELS[block.type]} settings`}
      data-settings-type={block.type}
    >
      <div className="inspector-workspace-tabs">
        <button onClick={onClose}>Agent</button>
        <button
          className={activePanel === "Data" ? "is-active" : ""}
          onClick={() => focusSection("Data")}
        >
          Data
        </button>
        <button
          className={activePanel === "Block" ? "is-active" : ""}
          onClick={() => focusSection("Block")}
        >
          Block
        </button>
        <button
          className={activePanel === "Kit" ? "is-active" : ""}
          onClick={() => focusSection("Kit")}
        >
          Kit
        </button>
      </div>
      {patchError && (
        <p className="inspector-error" role="alert">
          {patchError}
        </p>
      )}
      <header className="inspector__header">
        <span>
          <SlidersHorizontal size={15} />
        </span>
        <div>
          <small>BLOCK SETTINGS</small>
          <strong>{BLOCK_LABELS[block.type]}</strong>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close settings"
        >
          <X size={16} />
        </button>
      </header>
      <div className="inspector__body">
        {guide && (
          <section className="inspector-context-card">
            <span>{guide.headline}</span>
            <strong>{guide.question}</strong>
            <p>{guide.tip}</p>
            {(asset || block.valueField || block.valueFields.length > 0) && (
              <div>
                {asset && <b>{asset.name}</b>}
                {block.categoryField && <b>{block.categoryField}</b>}
                {(block.valueFields.length
                  ? block.valueFields
                  : block.valueField
                    ? [block.valueField]
                    : []
                ).map((field) => (
                  <b key={field}>{field}</b>
                ))}
              </div>
            )}
          </section>
        )}
        <InspectorSection title="Content" open>
          {block.type === "illustration" && (
            <>
              <Toggle
                label="Show caption"
                checked={block.illustration.showCaption === true}
                onChange={(showCaption) =>
                  patch({
                    illustration: {
                      ...block.illustration,
                      showCaption,
                    },
                  })
                }
              />
              {block.illustration.showCaption === true && (
                <>
                  <Field label="Title">
                    <input
                      value={block.title}
                      onChange={(e) => patch({ title: e.target.value })}
                    />
                  </Field>
                  <Field label="Subtitle">
                    <textarea
                      rows={2}
                      value={block.subtitle}
                      onChange={(e) => patch({ subtitle: e.target.value })}
                    />
                  </Field>
                </>
              )}
            </>
          )}
          {block.type !== "text" && block.type !== "illustration" && (
            <Field label="Title">
              <input
                value={block.title}
                onChange={(e) => patch({ title: e.target.value })}
              />
            </Field>
          )}
          {block.type === "text" && (
            <>
              <Field label="Optional heading">
                <input
                  value={block.title}
                  onChange={(e) => patch({ title: e.target.value })}
                />
              </Field>
              <Field label="Body">
                <textarea
                  rows={7}
                  value={block.body}
                  onChange={(e) => patch({ body: e.target.value })}
                />
              </Field>
            </>
          )}
          {![
            "text",
            "illustration",
            "kpi",
            "table",
            "bar",
            "horizontalBar",
            "groupedBar",
            "line",
            "donut",
            "sankey",
            "gauge",
            "scatter",
            "treemap",
            "heatmap",
            "sectionHeader",
            "heading",
          ].includes(block.type)
            ? null
            : block.type !== "text" &&
              block.type !== "illustration" && (
                <Field label="Subtitle">
                  <textarea
                    rows={2}
                    value={block.subtitle}
                    onChange={(e) => patch({ subtitle: e.target.value })}
                  />
                </Field>
              )}
          {block.type === "sectionHeader" && (
            <div className="field-grid two">
              <Field label="Eyebrow">
                <input
                  value={block.eyebrow}
                  onChange={(e) => patch({ eyebrow: e.target.value })}
                />
              </Field>
              <Field label="Chip">
                <input
                  value={block.chip}
                  onChange={(e) => patch({ chip: e.target.value })}
                />
              </Field>
            </div>
          )}
          {block.type === "kpi" && (
            <Field label="Category label">
              <input
                value={block.eyebrow}
                placeholder="Operating measure"
                onChange={(e) => patch({ eyebrow: e.target.value })}
              />
            </Field>
          )}
          {block.type === "heading" && (
            <Segmented
              label="Heading level"
              value={String(block.headingLevel)}
              options={[
                { value: "1", label: "H1" },
                { value: "2", label: "H2" },
                { value: "3", label: "H3" },
              ]}
              onChange={(value) =>
                patch({ headingLevel: Number(value) as 1 | 2 | 3 })
              }
            />
          )}
        </InspectorSection>

        {block.type === "illustration" && (
          <InspectorSection title="Illustration" open>
            <div className="illustration-library-heading">
              <strong>Generated library</strong>
              <span>{(project.generatedIllustrations ?? []).length} saved</span>
            </div>
            {(project.generatedIllustrations ?? []).length ? (
              <div
                className="generated-illustration-grid"
                role="radiogroup"
                aria-label="Generated illustration library"
              >
                {(project.generatedIllustrations ?? []).map((asset) => {
                  const selected =
                    block.illustration.libraryAssetId === asset.id;
                  const previewBlock = {
                    ...block,
                    illustration: {
                      ...block.illustration,
                      preset: "custom" as const,
                      libraryAssetId: asset.id,
                      bitmapMask: asset.bitmapMask,
                      altText: asset.altText,
                      elements: [],
                    },
                  };
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={asset.name}
                      className={selected ? "is-selected" : ""}
                      onClick={() =>
                        patch({
                          title: asset.name,
                          illustration: {
                            ...block.illustration,
                            preset: "custom",
                            libraryAssetId: asset.id,
                            bitmapMask: structuredClone(asset.bitmapMask),
                            altText: asset.altText,
                          },
                        })
                      }
                    >
                      <IllustrationArtwork block={previewBlock} preview />
                      <span>{asset.name}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="illustration-library-empty">
                Generated scenes will be saved here automatically for reuse.
              </p>
            )}
            <div className="illustration-library-heading">
              <strong>Built-in library</strong>
              <span>10 included</span>
            </div>
            <div
              className="illustration-preset-grid"
              role="radiogroup"
              aria-label="Illustration preset"
            >
              {ILLUSTRATION_PRESETS.map((preset) => {
                const selected = block.illustration.preset === preset.value;
                const previewBlock = {
                  ...block,
                  illustration: {
                    ...block.illustration,
                    preset: preset.value,
                    elements: [],
                  },
                };
                return (
                  <button
                    key={preset.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={preset.label}
                    className={selected ? "is-selected" : ""}
                    onClick={() =>
                      patch({
                        illustration: {
                          ...block.illustration,
                          preset: preset.value,
                          libraryAssetId: "",
                          bitmapMask: null,
                          altText: preset.description,
                        },
                      })
                    }
                  >
                    <IllustrationArtwork block={previewBlock} preview />
                    <span>{preset.label}</span>
                  </button>
                );
              })}
            </div>
            {block.illustration.preset === "custom" &&
              block.illustration.bitmapMask && (
                <div className="illustration-custom-status">
                  <strong>Custom generated scene</strong>
                  <span>
                    {block.illustration.bitmapMask.width} ×{" "}
                    {block.illustration.bitmapMask.height}{" "}
                    {block.illustration.bitmapMask.encoding ===
                    "alpha-png-base64-v1"
                      ? "smooth alpha mask"
                      : "on/off pixel mask"}
                  </span>
                </div>
              )}
            <div className="illustration-webmcp-callout">
              <strong>An image-capable agent can create a new scene.</strong>
              <span>
                It generates blank-faced, minimal monoline artwork, rejects
                dense or detailed results, converts the accepted scene to a
                compact smooth transparency mask, and sends that mask through
                WebMCP. Tessera saves every accepted scene in the generated
                library, stores no white background, and makes the result fully
                RGB-recolorable—without an image API or vectors.
              </span>
            </div>
            <Field label="Accessible description">
              <textarea
                rows={3}
                value={block.illustration.altText}
                onChange={(event) =>
                  patch({
                    illustration: {
                      ...block.illustration,
                      altText: event.target.value,
                    },
                  })
                }
              />
            </Field>
            <div className="illustration-rgb-grid">
              <RgbColorField
                label="Illustration color"
                value={block.illustration.primaryColor}
                onChange={(primaryColor) =>
                  patch({
                    illustration: { ...block.illustration, primaryColor },
                  })
                }
              />
            </div>
          </InspectorSection>
        )}

        {!["sectionHeader", "heading", "text", "illustration"].includes(
          block.type,
        ) && (
          <InspectorSection title="Data binding" open>
            <Field label="Dataset">
              <select
                value={block.datasetId ?? ""}
                onChange={(e) =>
                  patch(
                    defaultBindingPatch(
                      project,
                      block,
                      e.target.value || undefined,
                    ),
                  )
                }
              >
                <option value="">Choose dataset…</option>
                {project.warehouse.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Month">
              <select
                value={block.period}
                disabled={!asset}
                onChange={(e) => patch({ period: e.target.value })}
              >
                <option value="latest">Latest available</option>
                <option value="all">All months</option>
                {through && (
                  <option value={block.period}>
                    Through {reportingPeriodLabel(through)} (snapshot)
                  </option>
                )}
                {asset?.months
                  .filter((item) => item.status !== "pending")
                  .map((item) => (
                    <option key={item.id} value={item.period}>
                      {item.label}
                    </option>
                  ))}
              </select>
            </Field>
            {asset && (
              <div
                className="inspector-provenance"
                data-testid="block-provenance"
              >
                <div>
                  <b>
                    {through
                      ? `Through ${reportingPeriodLabel(through)} · ${asset.name}`
                      : block.period === "all"
                        ? `All approved months · ${asset.name}`
                        : provenanceMonth
                          ? `${provenanceMonth.label} · ${asset.name}`
                          : `${asset.name} · no approved month yet`}
                  </b>
                  <small>
                    {provenanceMonth
                      ? `Cleaned table from ${provenanceMonth.sourceName}`
                      : "Approve a month in the Data Warehouse to bind values"}
                  </small>
                </div>
                <button
                  type="button"
                  className="link-button"
                  onClick={() =>
                    onOpenWarehouse(asset.id, provenanceMonth?.period)
                  }
                >
                  Open in warehouse
                </button>
              </div>
            )}
            {!project.warehouse.length && (
              <p className="inspector-hint">
                Add a dataset in this project’s Data Warehouse first.
              </p>
            )}
            {block.type === "table" && (
              <ColumnChecks
                columns={allColumns}
                selected={block.table.visibleColumns}
                emptyMeansAll
                onChange={(visibleColumns) =>
                  patch({ table: { ...block.table, visibleColumns } })
                }
              />
            )}
            {block.type === "kpi" && (
              <Field label="Value field">
                <SelectColumn
                  value={block.valueField}
                  columns={numbers}
                  onChange={(valueField) => patch({ valueField })}
                />
              </Field>
            )}
            {block.type === "gauge" && (
              <>
                <Field label="Actual value field">
                  <SelectColumn
                    value={block.valueField}
                    columns={numbers}
                    onChange={(valueField) =>
                      patch({
                        valueField,
                        valueFields: valueField ? [valueField] : [],
                      })
                    }
                  />
                </Field>
                <Field label="Target field (optional)">
                  <SelectColumn
                    value={block.targetField}
                    columns={numbers}
                    onChange={(targetField) => patch({ targetField })}
                  />
                </Field>
              </>
            )}
            {block.type === "scatter" && (
              <>
                <Field label="X-axis metric">
                  <SelectColumn
                    value={block.categoryField}
                    columns={numbers}
                    onChange={(categoryField) => patch({ categoryField })}
                  />
                </Field>
                <Field label="Y-axis metric">
                  <SelectColumn
                    value={block.valueField ?? block.valueFields[0]}
                    columns={numbers}
                    onChange={(valueField) =>
                      patch({
                        valueField,
                        valueFields: valueField ? [valueField] : [],
                      })
                    }
                  />
                </Field>
                <Field label="Point label">
                  <SelectColumn
                    value={block.labelField}
                    columns={allColumns}
                    onChange={(labelField) => patch({ labelField })}
                  />
                </Field>
                <Field label="Color grouping">
                  <SelectColumn
                    value={block.seriesField}
                    columns={text}
                    onChange={(seriesField) => patch({ seriesField })}
                  />
                </Field>
                <p className="inspector-hint">
                  Point labels make tooltips and one-point edits stable. Add a
                  color grouping only when the categories carry meaning.
                </p>
              </>
            )}
            {isChart &&
              !["sankey", "gauge", "scatter"].includes(block.type) && (
                <>
                  <Field
                    label={block.type === "line" ? "X-axis" : "Category field"}
                  >
                    <SelectColumn
                      value={block.categoryField}
                      columns={text.length ? text : allColumns}
                      onChange={(categoryField) => patch({ categoryField })}
                    />
                  </Field>
                  {["groupedBar", "line", "heatmap"].includes(block.type) ? (
                    <ColumnChecks
                      label={
                        block.type === "heatmap"
                          ? "Heatmap columns"
                          : "Value series"
                      }
                      columns={numbers}
                      selected={block.valueFields}
                      onChange={(valueFields) =>
                        patch({ valueFields, valueField: valueFields[0] })
                      }
                    />
                  ) : (
                    <Field label="Value field">
                      <SelectColumn
                        value={block.valueField ?? block.valueFields[0]}
                        columns={numbers}
                        onChange={(valueField) =>
                          patch({
                            valueField,
                            valueFields: valueField ? [valueField] : [],
                          })
                        }
                      />
                    </Field>
                  )}
                </>
              )}
            {block.type === "sankey" && (
              <>
                <Field label="Source field">
                  <SelectColumn
                    value={block.categoryField}
                    columns={text.length ? text : allColumns}
                    onChange={(categoryField) => patch({ categoryField })}
                  />
                </Field>
                <Field label="Target field">
                  <SelectColumn
                    value={block.targetField}
                    columns={text.length ? text : allColumns}
                    onChange={(targetField) => patch({ targetField })}
                  />
                </Field>
                <Field label="Flow value">
                  <SelectColumn
                    value={block.valueField}
                    columns={numbers}
                    onChange={(valueField) => patch({ valueField })}
                  />
                </Field>
              </>
            )}
          </InspectorSection>
        )}

        {block.type === "kpi" && (
          <InspectorSection title="KPI appearance" open>
            <div className="field-grid two">
              <ColorField
                label="Metric"
                value={block.style.textColor}
                onChange={(textColor) =>
                  patch({ style: { ...block.style, textColor } })
                }
              />
              <ColorField
                label="Icon"
                value={block.style.accent}
                onChange={(accent) =>
                  patch({ style: { ...block.style, accent } })
                }
              />
            </div>
            <KpiIconField
              value={block.kpi.icon ?? "auto"}
              onChange={(icon) => patch({ kpi: { ...block.kpi, icon } })}
            />
          </InspectorSection>
        )}

        {block.type === "kpi" && (
          <InspectorSection title="KPI calculation" open>
            <Field label="Aggregation">
              <select
                value={block.kpi.aggregation}
                onChange={(e) =>
                  patch({
                    kpi: {
                      ...block.kpi,
                      aggregation: e.target
                        .value as DashboardBlock["kpi"]["aggregation"],
                    },
                  })
                }
              >
                {[
                  "sum",
                  "average",
                  "count",
                  "minimum",
                  "maximum",
                  "first",
                  "last",
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </Field>
            <FormatFields
              format={block.kpi.valueFormat}
              decimals={block.kpi.decimalPlaces}
              onFormat={(valueFormat) =>
                patch({ kpi: { ...block.kpi, valueFormat } })
              }
              onDecimals={(decimalPlaces) =>
                patch({ kpi: { ...block.kpi, decimalPlaces } })
              }
            />
            <div className="field-grid two">
              <Field label="Prefix">
                <input
                  value={block.kpi.prefix}
                  onChange={(e) =>
                    patch({ kpi: { ...block.kpi, prefix: e.target.value } })
                  }
                />
              </Field>
              <Field label="Suffix">
                <input
                  value={block.kpi.suffix}
                  onChange={(e) =>
                    patch({ kpi: { ...block.kpi, suffix: e.target.value } })
                  }
                />
              </Field>
            </div>
            <Field label="Comparison label">
              <input
                value={block.kpi.comparisonLabel}
                placeholder="vs plan"
                onChange={(e) =>
                  patch({
                    kpi: { ...block.kpi, comparisonLabel: e.target.value },
                  })
                }
              />
            </Field>
            <NumberField
              label="Comparison"
              value={block.kpi.comparisonValue}
              onChange={(comparisonValue) =>
                patch({ kpi: { ...block.kpi, comparisonValue } })
              }
            />
            <NumberField
              label="Target"
              value={block.kpi.targetValue}
              onChange={(targetValue) =>
                patch({ kpi: { ...block.kpi, targetValue } })
              }
            />
            <Toggle
              label="Show target badge"
              checked={block.kpi.showProgress}
              onChange={(showProgress) =>
                patch({ kpi: { ...block.kpi, showProgress } })
              }
            />
            <Segmented
              label="Positive direction"
              value={block.kpi.positiveDirection}
              options={[
                { value: "up", label: "Higher" },
                { value: "down", label: "Lower" },
              ]}
              onChange={(positiveDirection) =>
                patch({
                  kpi: {
                    ...block.kpi,
                    positiveDirection: positiveDirection as "up" | "down",
                  },
                })
              }
            />
          </InspectorSection>
        )}

        {block.type === "table" && (
          <InspectorSection title="Table presentation" open>
            <NumberField
              label="Maximum rows"
              value={tableSettings.rowLimit}
              min={1}
              max={500}
              onChange={(rowLimit) =>
                patch({ table: { ...block.table, rowLimit: rowLimit ?? 20 } })
              }
            />
            <FormatFields
              format={tableSettings.numberFormat}
              decimals={tableSettings.decimalPlaces}
              onFormat={(numberFormat) =>
                patch({ table: { ...block.table, numberFormat } })
              }
              onDecimals={(decimalPlaces) =>
                patch({ table: { ...block.table, decimalPlaces } })
              }
            />
            <TableSortEditor
              columns={allColumns}
              rules={tableSortRules}
              onChange={(sortRules) =>
                patch({
                  table: {
                    ...block.table,
                    sortColumn: "",
                    sortDirection: "none",
                    sortRules,
                  },
                })
              }
            />
            <Field label="Color rows by group">
              <select
                value={tableSettings.colorByColumn}
                onChange={(event) =>
                  patch({
                    table: {
                      ...block.table,
                      colorByColumn: event.target.value,
                      groupColors:
                        event.target.value === tableSettings.colorByColumn
                          ? tableSettings.groupColors
                          : [],
                    },
                  })
                }
              >
                <option value="">Off</option>
                {allColumns.map((column) => (
                  <option key={column} value={column}>
                    {column}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Blank cells">
              <input
                value={tableSettings.nullDisplay}
                placeholder="Leave empty"
                onChange={(event) =>
                  patch({
                    table: {
                      ...block.table,
                      nullDisplay: event.target.value,
                    },
                  })
                }
              />
            </Field>
            <SettingsGroup
              title="Table structure"
              description="Density, lines, and fixed reading anchors"
            >
              <Toggle
                label="Striped rows"
                checked={tableSettings.striped}
                onChange={(striped) =>
                  patch({ table: { ...block.table, striped } })
                }
              />
              <Toggle
                label="Compact density"
                checked={tableSettings.compact}
                onChange={(compact) =>
                  patch({ table: { ...block.table, compact } })
                }
              />
              <Toggle
                label="Column gridlines"
                checked={tableSettings.columnGridlines}
                onChange={(columnGridlines) =>
                  patch({ table: { ...block.table, columnGridlines } })
                }
              />
              <Toggle
                label="Row gridlines"
                checked={tableSettings.rowGridlines}
                onChange={(rowGridlines) =>
                  patch({ table: { ...block.table, rowGridlines } })
                }
              />
              <Toggle
                label="Sticky header"
                checked={tableSettings.stickyHeader}
                onChange={(stickyHeader) =>
                  patch({ table: { ...block.table, stickyHeader } })
                }
              />
              <Toggle
                label="Freeze first column"
                checked={tableSettings.freezeFirstColumn}
                onChange={(freezeFirstColumn) =>
                  patch({ table: { ...block.table, freezeFirstColumn } })
                }
              />
              <Toggle
                label="Wrap text"
                checked={tableSettings.wrapText}
                onChange={(wrapText) =>
                  patch({ table: { ...block.table, wrapText } })
                }
              />
            </SettingsGroup>
            <SettingsGroup
              title="Reader tools"
              description="Headers, search, and table context"
            >
              <Toggle
                label="Column headers"
                checked={tableSettings.showColumnHeaders}
                onChange={(showColumnHeaders) =>
                  patch({ table: { ...block.table, showColumnHeaders } })
                }
              />
              <Toggle
                label="Enable search"
                checked={tableSettings.showSearch}
                onChange={(showSearch) =>
                  patch({ table: { ...block.table, showSearch } })
                }
              />
              <Toggle
                label="Dataset name"
                checked={tableSettings.showDatasetName}
                onChange={(showDatasetName) =>
                  patch({ table: { ...block.table, showDatasetName } })
                }
              />
              <Toggle
                label="Row count"
                checked={tableSettings.showRowCount}
                onChange={(showRowCount) =>
                  patch({ table: { ...block.table, showRowCount } })
                }
              />
              <Toggle
                label="Row numbers"
                checked={tableSettings.showRowNumbers}
                onChange={(showRowNumbers) =>
                  patch({ table: { ...block.table, showRowNumbers } })
                }
              />
            </SettingsGroup>
            <SettingsGroup
              title="Summary rows"
              description="Totals and closing emphasis"
            >
              <Toggle
                label="Totals row"
                checked={tableSettings.showTotals}
                onChange={(showTotals) =>
                  patch({ table: { ...block.table, showTotals } })
                }
              />
              <Toggle
                label="Bold last row"
                checked={tableSettings.boldLastRow}
                onChange={(boldLastRow) =>
                  patch({ table: { ...block.table, boldLastRow } })
                }
              />
            </SettingsGroup>
            <SettingsGroup
              title="Numeric emphasis"
              description="Negative values and magnitude cues"
            >
              <Toggle
                label="Negative in parentheses"
                checked={tableSettings.negativeParens}
                onChange={(negativeParens) =>
                  patch({ table: { ...block.table, negativeParens } })
                }
              />
              <Toggle
                label="Negative in red"
                checked={tableSettings.negativeRed}
                onChange={(negativeRed) =>
                  patch({ table: { ...block.table, negativeRed } })
                }
              />
              <Toggle
                label="Cell heatmap"
                checked={tableSettings.heatmap}
                onChange={(heatmap) =>
                  patch({ table: { ...block.table, heatmap } })
                }
              />
            </SettingsGroup>
            {tableSettings.showTotals && (
              <Field label="Totals label">
                <input
                  value={tableSettings.totalsLabel}
                  onChange={(event) =>
                    patch({
                      table: {
                        ...block.table,
                        totalsLabel: event.target.value,
                      },
                    })
                  }
                />
              </Field>
            )}
            {tableSettings.heatmap && (
              <PaletteField
                label="Heatmap color"
                value={tableSettings.heatmapColor}
                fallbackIndex={2}
                palette={BLUE_CHART_PALETTE}
                onChange={(heatmapColor) =>
                  patch({ table: { ...block.table, heatmapColor } })
                }
              />
            )}
          </InspectorSection>
        )}

        {isChart && (
          <>
            {block.type !== "sankey" && (
              <InspectorSection title="Chart presentation" open>
                <div className="toggle-grid" aria-label="Chart visibility">
                  {supportsLegend && (
                    <Toggle
                      label="Legend"
                      checked={block.chart.showLegend}
                      onChange={(showLegend) =>
                        patch({ chart: { ...block.chart, showLegend } })
                      }
                    />
                  )}
                  {supportsValueLabels && (
                    <Toggle
                      label="Value labels"
                      checked={block.chart.showValues}
                      onChange={(showValues) =>
                        patch({ chart: { ...block.chart, showValues } })
                      }
                    />
                  )}
                  {(supportsCartesianControls || block.type === "heatmap") && (
                    <>
                      <Toggle
                        label="Gridlines"
                        checked={block.chart.showGridlines}
                        onChange={(showGridlines) =>
                          patch({ chart: { ...block.chart, showGridlines } })
                        }
                      />
                      <Toggle
                        label="X axis"
                        checked={block.chart.showXAxis}
                        onChange={(showXAxis) =>
                          patch({ chart: { ...block.chart, showXAxis } })
                        }
                      />
                      <Toggle
                        label="Y axis"
                        checked={block.chart.showYAxis}
                        onChange={(showYAxis) =>
                          patch({ chart: { ...block.chart, showYAxis } })
                        }
                      />
                    </>
                  )}
                  {block.type === "line" && (
                    <Toggle
                      label="Point markers"
                      checked={block.chart.showPoints}
                      onChange={(showPoints) =>
                        patch({ chart: { ...block.chart, showPoints } })
                      }
                    />
                  )}
                </div>
                {supportsLegend &&
                  block.type !== "heatmap" &&
                  block.chart.showLegend && (
                    <Segmented
                      label="Legend position"
                      value={block.chart.legendPosition}
                      options={[
                        { value: "top", label: "Top" },
                        { value: "bottom", label: "Bottom" },
                        { value: "right", label: "Right" },
                      ]}
                      onChange={(legendPosition) =>
                        patch({
                          chart: {
                            ...block.chart,
                            legendPosition:
                              legendPosition as DashboardBlock["chart"]["legendPosition"],
                          },
                        })
                      }
                    />
                  )}
                {block.type === "donut" && block.chart.showLegend && (
                  <Segmented
                    label="Legend values"
                    value={block.chart.showValues ? "percent" : "value"}
                    options={[
                      { value: "value", label: "Value" },
                      { value: "percent", label: "Percent" },
                    ]}
                    onChange={(value) =>
                      patch({
                        chart: {
                          ...block.chart,
                          showValues: value === "percent",
                        },
                      })
                    }
                  />
                )}
                {supportsSort && (
                  <Field label="Sort">
                    <select
                      value={block.chart.sortOrder}
                      onChange={(e) =>
                        patch({
                          chart: {
                            ...block.chart,
                            sortOrder: e.target
                              .value as DashboardBlock["chart"]["sortOrder"],
                          },
                        })
                      }
                    >
                      <option value="source">Source order</option>
                      <option value="ascending">Ascending</option>
                      <option value="descending">Descending</option>
                    </select>
                  </Field>
                )}
                <FormatFields
                  format={block.chart.valueFormat}
                  decimals={block.chart.decimalPlaces}
                  onFormat={(valueFormat) =>
                    patch({ chart: { ...block.chart, valueFormat } })
                  }
                  onDecimals={(decimalPlaces) =>
                    patch({ chart: { ...block.chart, decimalPlaces } })
                  }
                />
                {block.type === "gauge" && (
                  <>
                    <Field label="Calculation">
                      <select
                        value={gauge.aggregation}
                        onChange={(e) =>
                          patch({
                            gauge: {
                              ...gauge,
                              aggregation: e.target
                                .value as DashboardBlock["gauge"]["aggregation"],
                            },
                          })
                        }
                      >
                        <option value="average">Average</option>
                        <option value="sum">Sum</option>
                        <option value="minimum">Minimum</option>
                        <option value="maximum">Maximum</option>
                        <option value="count">Count</option>
                        <option value="first">First</option>
                        <option value="last">Last</option>
                      </select>
                    </Field>
                    <Segmented
                      label="Display"
                      value={gauge.display}
                      options={[
                        { value: "progress", label: "Progress" },
                        { value: "dial", label: "Dial" },
                      ]}
                      onChange={(display) =>
                        patch({
                          gauge: {
                            ...gauge,
                            display:
                              display as DashboardBlock["gauge"]["display"],
                          },
                        })
                      }
                    />
                    <div className="toggle-grid" aria-label="Gauge labels">
                      <Toggle
                        label="Actual value"
                        checked={gauge.showValue}
                        onChange={(showValue) =>
                          patch({ gauge: { ...gauge, showValue } })
                        }
                      />
                      <Toggle
                        label="Target marker"
                        checked={gauge.showTarget}
                        onChange={(showTarget) =>
                          patch({ gauge: { ...gauge, showTarget } })
                        }
                      />
                      <Toggle
                        label="Scale labels"
                        checked={gauge.showScaleLabels}
                        onChange={(showScaleLabels) =>
                          patch({ gauge: { ...gauge, showScaleLabels } })
                        }
                      />
                      <Toggle
                        label="Percent of target"
                        checked={gauge.showPercentOfTarget}
                        onChange={(showPercentOfTarget) =>
                          patch({ gauge: { ...gauge, showPercentOfTarget } })
                        }
                      />
                    </div>
                    <Field label="Value label">
                      <input
                        value={gauge.valueLabel}
                        placeholder={block.valueField || "Actual"}
                        onChange={(e) =>
                          patch({
                            gauge: { ...gauge, valueLabel: e.target.value },
                          })
                        }
                      />
                    </Field>
                    <Field label="Target label">
                      <input
                        value={gauge.targetLabel}
                        onChange={(e) =>
                          patch({
                            gauge: { ...gauge, targetLabel: e.target.value },
                          })
                        }
                      />
                    </Field>
                  </>
                )}
              </InspectorSection>
            )}
            {block.type === "sankey" && (
              <InspectorSection title="Labels & stages" open>
                <div className="toggle-grid" aria-label="Sankey labels">
                  <Toggle
                    label="Stage headers"
                    checked={block.chart.sankeyShowStageHeaders ?? true}
                    onChange={(sankeyShowStageHeaders) =>
                      patch({
                        chart: { ...block.chart, sankeyShowStageHeaders },
                      })
                    }
                  />
                  <Toggle
                    label="Node labels"
                    checked={block.chart.sankeyShowNodeLabels ?? true}
                    onChange={(sankeyShowNodeLabels) =>
                      patch({
                        chart: { ...block.chart, sankeyShowNodeLabels },
                      })
                    }
                  />
                  <Toggle
                    label="Link values"
                    checked={block.chart.sankeyShowLinkValues ?? false}
                    onChange={(sankeyShowLinkValues) =>
                      patch({
                        chart: { ...block.chart, sankeyShowLinkValues },
                      })
                    }
                  />
                  <Toggle
                    label="Node values"
                    checked={block.chart.showValues}
                    onChange={(showValues) =>
                      patch({ chart: { ...block.chart, showValues } })
                    }
                  />
                  <Toggle
                    label="Share percentages"
                    checked={block.chart.sankeyShowShares ?? true}
                    onChange={(sankeyShowShares) =>
                      patch({ chart: { ...block.chart, sankeyShowShares } })
                    }
                  />
                </div>
                <Field label="Stage labels">
                  <input
                    value={(block.chart.sankeyStageLabels ?? []).join(", ")}
                    placeholder="Sources, Categories, Destinations"
                    onChange={(e) =>
                      patch({
                        chart: {
                          ...block.chart,
                          sankeyStageLabels: e.target.value
                            .split(",")
                            .map((item) => item.trim()),
                        },
                      })
                    }
                  />
                </Field>
                <FormatFields
                  format={block.chart.valueFormat}
                  decimals={block.chart.decimalPlaces}
                  onFormat={(valueFormat) =>
                    patch({ chart: { ...block.chart, valueFormat } })
                  }
                  onDecimals={(decimalPlaces) =>
                    patch({ chart: { ...block.chart, decimalPlaces } })
                  }
                />
                <p className="inspector-hint">
                  Enter one stage name per flow column, separated by commas.
                  Counts are added automatically.
                </p>
              </InspectorSection>
            )}
            <InspectorSection title="Color & emphasis">
              {block.type === "gauge" && (
                <div className="color-series">
                  {(
                    [
                      ["value", "Actual value"],
                      ["track", "Unfilled track"],
                      ["target", "Target marker"],
                      ["needle", "Dial needle"],
                    ] as const
                  ).map(([element, label], index) => (
                    <PaletteField
                      key={element}
                      label={label}
                      value={gauge.colors[element]}
                      fallbackIndex={index}
                      allowCustom
                      palette={BLUE_CHART_PALETTE}
                      onChange={(color) =>
                        patch({
                          gauge: {
                            ...gauge,
                            colors: { ...gauge.colors, [element]: color },
                          },
                        })
                      }
                    />
                  ))}
                </div>
              )}
              <div className="color-series">
                {chartColorIndexes.map((index) => (
                  <PaletteField
                    key={index}
                    label={
                      block.type === "gauge"
                        ? index === 0
                          ? "Progress"
                          : "Target marker"
                        : block.type === "sankey"
                          ? index === 0
                            ? "Origins"
                            : `Branch ${index}`
                          : ["groupedBar", "line", "heatmap"].includes(
                                block.type,
                              )
                            ? block.valueFields[index] || `Series ${index + 1}`
                            : ["bar", "horizontalBar"].includes(block.type)
                              ? "Series"
                              : `Palette ${index + 1}`
                    }
                    value={block.chart.colors[index]}
                    fallbackIndex={index}
                    allowCustom={block.type === "line"}
                    palette={
                      block.type === "sankey"
                        ? DEFAULT_SANKEY_COLORS
                        : BLUE_CHART_PALETTE
                    }
                    onChange={(next) => {
                      const colors = [...block.chart.colors];
                      colors[index] = next;
                      patch({ chart: { ...block.chart, colors } });
                    }}
                  />
                ))}
              </div>
              {block.type === "sankey" && (
                <>
                  <p className="inspector-hint">
                    The palette sets automatic stage and branch colors. Exact
                    node and link exceptions below take priority.
                  </p>
                  <Segmented
                    label="Link color"
                    value={block.chart.sankeyLinkColorMode ?? "gradient"}
                    options={[
                      { value: "gradient", label: "Gradient" },
                      { value: "source", label: "Source" },
                      { value: "target", label: "Target" },
                    ]}
                    onChange={(sankeyLinkColorMode) =>
                      patch({
                        chart: {
                          ...block.chart,
                          sankeyLinkColorMode:
                            sankeyLinkColorMode as DashboardBlock["chart"]["sankeyLinkColorMode"],
                        },
                      })
                    }
                  />
                  <Segmented
                    label="Node order"
                    value={block.chart.sankeyNodeSort ?? "auto"}
                    options={[
                      { value: "auto", label: "Flow" },
                      { value: "name", label: "Name" },
                      { value: "value", label: "Value" },
                    ]}
                    onChange={(sankeyNodeSort) =>
                      patch({
                        chart: {
                          ...block.chart,
                          sankeyNodeSort:
                            sankeyNodeSort as DashboardBlock["chart"]["sankeyNodeSort"],
                        },
                      })
                    }
                  />
                </>
              )}
              {block.type !== "sankey" && (
                <RangeField
                  label="Series opacity"
                  value={block.chart.seriesOpacity}
                  min={0.1}
                  max={1}
                  step={0.05}
                  suffix={`${Math.round(block.chart.seriesOpacity * 100)}%`}
                  onChange={(seriesOpacity) =>
                    patch({ chart: { ...block.chart, seriesOpacity } })
                  }
                />
              )}
              {block.type === "sankey" && (
                <Field label="Highlighted nodes">
                  <input
                    value={block.chart.highlightNodes.join(", ")}
                    placeholder="Warehouse A, Direct"
                    onChange={(e) =>
                      patch({
                        chart: {
                          ...block.chart,
                          highlightNodes: e.target.value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean),
                        },
                      })
                    }
                  />
                </Field>
              )}
              {block.type === "sankey" && table && (
                <SankeyElementStyleEditor
                  block={block}
                  table={table}
                  onChange={(chart) => patch({ chart })}
                />
              )}
              {block.type === "donut" && (
                <CategoryElementStyleEditor
                  noun="slice"
                  categories={categoryValues}
                  styles={block.chart.donutSliceStyles}
                  onChange={(donutSliceStyles) =>
                    patch({ chart: { ...block.chart, donutSliceStyles } })
                  }
                />
              )}
              {block.type === "treemap" && (
                <CategoryElementStyleEditor
                  noun="tile"
                  categories={categoryValues}
                  styles={block.chart.treemapTileStyles}
                  allowTextColor
                  onChange={(treemapTileStyles) =>
                    patch({ chart: { ...block.chart, treemapTileStyles } })
                  }
                />
              )}
            </InspectorSection>
            {block.type === "heatmap" && (
              <InspectorSection title="Heatmap scale" open>
                <Segmented
                  label="Scale type"
                  value={block.chart.heatmapScaleType ?? "sequential"}
                  options={[
                    { value: "sequential", label: "Sequential" },
                    { value: "diverging", label: "Diverging" },
                  ]}
                  onChange={(heatmapScaleType) =>
                    patch({
                      chart: {
                        ...block.chart,
                        heatmapScaleType: heatmapScaleType as
                          "sequential" | "diverging",
                      },
                    })
                  }
                />
                <Segmented
                  label="Compare values"
                  value={block.chart.heatmapScaleScope ?? "global"}
                  options={[
                    { value: "global", label: "All cells" },
                    { value: "row", label: "By row" },
                    { value: "column", label: "By column" },
                  ]}
                  onChange={(heatmapScaleScope) =>
                    patch({
                      chart: {
                        ...block.chart,
                        heatmapScaleScope: heatmapScaleScope as
                          "global" | "row" | "column",
                      },
                    })
                  }
                />
                <PaletteField
                  label="Low values"
                  value={block.chart.heatmapMinColor ?? "#edf4fb"}
                  fallbackIndex={5}
                  palette={BLUE_CHART_PALETTE}
                  onChange={(heatmapMinColor) =>
                    patch({ chart: { ...block.chart, heatmapMinColor } })
                  }
                />
                {block.chart.heatmapScaleType === "diverging" && (
                  <PaletteField
                    label="Midpoint"
                    value={block.chart.heatmapMidColor ?? "#7897c4"}
                    fallbackIndex={3}
                    palette={BLUE_CHART_PALETTE}
                    onChange={(heatmapMidColor) =>
                      patch({ chart: { ...block.chart, heatmapMidColor } })
                    }
                  />
                )}
                <PaletteField
                  label="High values"
                  value={block.chart.heatmapMaxColor ?? "#1c2b4a"}
                  fallbackIndex={0}
                  palette={BLUE_CHART_PALETTE}
                  onChange={(heatmapMaxColor) =>
                    patch({ chart: { ...block.chart, heatmapMaxColor } })
                  }
                />
                <PaletteField
                  label="Missing values"
                  value={block.chart.heatmapMissingColor ?? "#e8edf3"}
                  fallbackIndex={5}
                  palette={BLUE_CHART_PALETTE}
                  onChange={(heatmapMissingColor) =>
                    patch({ chart: { ...block.chart, heatmapMissingColor } })
                  }
                />
                <Toggle
                  label="Reverse low and high"
                  checked={block.chart.heatmapReverse ?? false}
                  onChange={(heatmapReverse) =>
                    patch({ chart: { ...block.chart, heatmapReverse } })
                  }
                />
                <div className="field-grid two">
                  <NumberField
                    label="Scale minimum"
                    value={block.chart.heatmapMinValue}
                    onChange={(heatmapMinValue) =>
                      patch({ chart: { ...block.chart, heatmapMinValue } })
                    }
                  />
                  <NumberField
                    label="Scale maximum"
                    value={block.chart.heatmapMaxValue}
                    onChange={(heatmapMaxValue) =>
                      patch({ chart: { ...block.chart, heatmapMaxValue } })
                    }
                  />
                </div>
                {block.chart.heatmapScaleType === "diverging" && (
                  <NumberField
                    label="Midpoint value"
                    value={block.chart.heatmapMidpoint}
                    onChange={(heatmapMidpoint) =>
                      patch({ chart: { ...block.chart, heatmapMidpoint } })
                    }
                  />
                )}
                <p className="inspector-hint">
                  Global scaling supports honest comparisons across the whole
                  matrix. Row or column scaling is best for within-group
                  patterns when measures use different ranges.
                </p>
              </InspectorSection>
            )}
            {supportsCartesianControls && (
              <InspectorSection
                title={
                  supportsGuideLines ? "Axes & guide lines" : "Axes & bounds"
                }
              >
                <Field label="X-axis title">
                  <input
                    value={block.chart.xAxisTitle}
                    onChange={(e) =>
                      patch({
                        chart: { ...block.chart, xAxisTitle: e.target.value },
                      })
                    }
                  />
                </Field>
                <Field label="Y-axis title">
                  <input
                    value={block.chart.yAxisTitle}
                    onChange={(e) =>
                      patch({
                        chart: { ...block.chart, yAxisTitle: e.target.value },
                      })
                    }
                  />
                </Field>
                {block.type === "scatter" && (
                  <>
                    <div className="field-grid two">
                      <NumberField
                        label="X minimum"
                        value={block.chart.minX}
                        onChange={(minX) =>
                          patch({ chart: { ...block.chart, minX } })
                        }
                      />
                      <NumberField
                        label="X maximum"
                        value={block.chart.maxX}
                        onChange={(maxX) =>
                          patch({ chart: { ...block.chart, maxX } })
                        }
                      />
                    </div>
                    <FormatFields
                      format={block.chart.xValueFormat ?? "auto"}
                      decimals={block.chart.xDecimalPlaces ?? 1}
                      onFormat={(xValueFormat) =>
                        patch({ chart: { ...block.chart, xValueFormat } })
                      }
                      onDecimals={(xDecimalPlaces) =>
                        patch({ chart: { ...block.chart, xDecimalPlaces } })
                      }
                    />
                  </>
                )}
                <div className="field-grid two">
                  <NumberField
                    label="Y minimum"
                    value={block.chart.minY}
                    onChange={(minY) =>
                      patch({ chart: { ...block.chart, minY } })
                    }
                  />
                  <NumberField
                    label="Y maximum"
                    value={block.chart.maxY}
                    onChange={(maxY) =>
                      patch({ chart: { ...block.chart, maxY } })
                    }
                  />
                </div>
                {block.type === "scatter" && (
                  <>
                    <div className="toggle-grid" aria-label="Scatter axes">
                      <Toggle
                        label="Include zero"
                        checked={block.chart.scatterIncludeZero ?? false}
                        onChange={(scatterIncludeZero) =>
                          patch({
                            chart: { ...block.chart, scatterIncludeZero },
                          })
                        }
                      />
                      <Toggle
                        label="Trend line"
                        checked={block.chart.scatterShowTrendLine ?? false}
                        onChange={(scatterShowTrendLine) =>
                          patch({
                            chart: { ...block.chart, scatterShowTrendLine },
                          })
                        }
                      />
                    </div>
                    <div className="field-grid two">
                      <NumberField
                        label="X reference"
                        value={block.chart.scatterXReferenceValue}
                        onChange={(scatterXReferenceValue) =>
                          patch({
                            chart: {
                              ...block.chart,
                              scatterXReferenceValue,
                            },
                          })
                        }
                      />
                      <Field label="X reference label">
                        <input
                          value={block.chart.scatterXReferenceLabel ?? ""}
                          onChange={(event) =>
                            patch({
                              chart: {
                                ...block.chart,
                                scatterXReferenceLabel: event.target.value,
                              },
                            })
                          }
                        />
                      </Field>
                      <NumberField
                        label="Y reference"
                        value={block.chart.scatterYReferenceValue}
                        onChange={(scatterYReferenceValue) =>
                          patch({
                            chart: {
                              ...block.chart,
                              scatterYReferenceValue,
                            },
                          })
                        }
                      />
                      <Field label="Y reference label">
                        <input
                          value={block.chart.scatterYReferenceLabel ?? ""}
                          onChange={(event) =>
                            patch({
                              chart: {
                                ...block.chart,
                                scatterYReferenceLabel: event.target.value,
                              },
                            })
                          }
                        />
                      </Field>
                    </div>
                  </>
                )}
                {supportsGuideLines && (
                  <>
                    <div className="toggle-grid" aria-label="Guide lines">
                      <Toggle
                        label="Average line"
                        checked={block.chart.showAverageLine}
                        onChange={(showAverageLine) =>
                          patch({ chart: { ...block.chart, showAverageLine } })
                        }
                      />
                      <Toggle
                        label="Minimum line"
                        checked={block.chart.showMinLine}
                        onChange={(showMinLine) =>
                          patch({ chart: { ...block.chart, showMinLine } })
                        }
                      />
                      <Toggle
                        label="Maximum line"
                        checked={block.chart.showMaxLine}
                        onChange={(showMaxLine) =>
                          patch({ chart: { ...block.chart, showMaxLine } })
                        }
                      />
                      <Toggle
                        label="Custom reference"
                        checked={block.chart.showReferenceLine}
                        onChange={(showReferenceLine) =>
                          patch({
                            chart: { ...block.chart, showReferenceLine },
                          })
                        }
                      />
                    </div>
                    {block.chart.showReferenceLine && (
                      <>
                        <NumberField
                          label="Reference value"
                          value={block.chart.referenceValue}
                          onChange={(referenceValue) =>
                            patch({
                              chart: { ...block.chart, referenceValue },
                            })
                          }
                        />
                        <Field label="Reference label">
                          <input
                            value={block.chart.referenceLabel}
                            onChange={(e) =>
                              patch({
                                chart: {
                                  ...block.chart,
                                  referenceLabel: e.target.value,
                                },
                              })
                            }
                          />
                        </Field>
                      </>
                    )}
                  </>
                )}
              </InspectorSection>
            )}
            <InspectorSection title="Chart geometry">
              {["bar", "horizontalBar", "groupedBar"].includes(block.type) && (
                <>
                  <RangeField
                    label="Corner radius"
                    value={block.chart.barRadius}
                    min={0}
                    max={20}
                    suffix={`${block.chart.barRadius}px`}
                    onChange={(barRadius) =>
                      patch({ chart: { ...block.chart, barRadius } })
                    }
                  />
                  <RangeField
                    label="Bar gap"
                    value={block.chart.barGap}
                    min={0}
                    max={70}
                    suffix={`${block.chart.barGap}%`}
                    onChange={(barGap) =>
                      patch({ chart: { ...block.chart, barGap } })
                    }
                  />
                </>
              )}
              {block.type === "line" && (
                <>
                  <RangeField
                    label="Line width"
                    value={block.chart.lineWidth}
                    min={1}
                    max={8}
                    suffix={`${block.chart.lineWidth}px`}
                    onChange={(lineWidth) =>
                      patch({ chart: { ...block.chart, lineWidth } })
                    }
                  />
                  <Segmented
                    label="Curve"
                    value={block.chart.curve}
                    options={[
                      { value: "straight", label: "Straight" },
                      { value: "smooth", label: "Smooth" },
                      { value: "step", label: "Step" },
                    ]}
                    onChange={(curve) =>
                      patch({
                        chart: {
                          ...block.chart,
                          curve: curve as DashboardBlock["chart"]["curve"],
                        },
                      })
                    }
                  />
                  <Segmented
                    label="Stroke"
                    value={block.chart.lineDash ?? "solid"}
                    options={[
                      { value: "solid", label: "Solid" },
                      { value: "dashed", label: "Dashed" },
                      { value: "dotted", label: "Dotted" },
                    ]}
                    onChange={(lineDash) =>
                      patch({
                        chart: {
                          ...block.chart,
                          lineDash:
                            lineDash as DashboardBlock["chart"]["lineDash"],
                        },
                      })
                    }
                  />
                  <RangeField
                    label="Point size"
                    value={block.chart.pointSize ?? 4}
                    min={1}
                    max={12}
                    suffix={`${block.chart.pointSize ?? 4}px`}
                    onChange={(pointSize) =>
                      patch({ chart: { ...block.chart, pointSize } })
                    }
                  />
                  <Segmented
                    label="Point shape"
                    value={block.chart.pointShape ?? "circle"}
                    options={[
                      { value: "circle", label: "Circle" },
                      { value: "square", label: "Square" },
                      { value: "diamond", label: "Diamond" },
                    ]}
                    onChange={(pointShape) =>
                      patch({
                        chart: {
                          ...block.chart,
                          pointShape:
                            pointShape as DashboardBlock["chart"]["pointShape"],
                        },
                      })
                    }
                  />
                  <div className="toggle-grid" aria-label="Chart options">
                    <Toggle
                      label="Connect missing values"
                      checked={block.chart.connectNulls ?? false}
                      onChange={(connectNulls) =>
                        patch({ chart: { ...block.chart, connectNulls } })
                      }
                    />
                    <Toggle
                      label="Area fill"
                      checked={block.chart.fillArea ?? false}
                      onChange={(fillArea) =>
                        patch({ chart: { ...block.chart, fillArea } })
                      }
                    />
                  </div>
                  {(block.chart.fillArea ?? false) && (
                    <RangeField
                      label="Area opacity"
                      value={block.chart.areaOpacity ?? 0.12}
                      min={0}
                      max={0.6}
                      step={0.02}
                      suffix={`${Math.round((block.chart.areaOpacity ?? 0.12) * 100)}%`}
                      onChange={(areaOpacity) =>
                        patch({ chart: { ...block.chart, areaOpacity } })
                      }
                    />
                  )}
                </>
              )}
              {block.type === "donut" && (
                <>
                  <RangeField
                    label="Donut hole"
                    value={block.chart.donutHole}
                    min={20}
                    max={82}
                    suffix={`${block.chart.donutHole}%`}
                    onChange={(donutHole) =>
                      patch({ chart: { ...block.chart, donutHole } })
                    }
                  />
                  <Field label="Center label">
                    <input
                      value={block.chart.donutCenterLabel}
                      onChange={(e) =>
                        patch({
                          chart: {
                            ...block.chart,
                            donutCenterLabel: e.target.value,
                          },
                        })
                      }
                    />
                  </Field>
                </>
              )}
              {block.type === "sankey" && (
                <>
                  <RangeField
                    label="Node width"
                    value={block.chart.sankeyNodeWidth}
                    min={8}
                    max={36}
                    suffix={`${block.chart.sankeyNodeWidth}px`}
                    onChange={(sankeyNodeWidth) =>
                      patch({ chart: { ...block.chart, sankeyNodeWidth } })
                    }
                  />
                  <RangeField
                    label="Node gap"
                    value={block.chart.sankeyNodeGap}
                    min={4}
                    max={40}
                    suffix={`${block.chart.sankeyNodeGap}px`}
                    onChange={(sankeyNodeGap) =>
                      patch({ chart: { ...block.chart, sankeyNodeGap } })
                    }
                  />
                  <RangeField
                    label="Flow density"
                    value={block.chart.sankeyLinkThickness ?? 1}
                    min={0.6}
                    max={1.8}
                    step={0.1}
                    suffix={`${(block.chart.sankeyLinkThickness ?? 1).toFixed(1)}×`}
                    onChange={(sankeyLinkThickness) =>
                      patch({
                        chart: { ...block.chart, sankeyLinkThickness },
                      })
                    }
                  />
                  <RangeField
                    label="Link opacity"
                    value={block.chart.sankeyLinkOpacity}
                    min={0.05}
                    max={1}
                    step={0.05}
                    suffix={`${Math.round(block.chart.sankeyLinkOpacity * 100)}%`}
                    onChange={(sankeyLinkOpacity) =>
                      patch({ chart: { ...block.chart, sankeyLinkOpacity } })
                    }
                  />
                </>
              )}
              {block.type === "gauge" && (
                <>
                  <div className="field-grid two">
                    <NumberField
                      label="Scale minimum"
                      value={gauge.min ?? 0}
                      onChange={(min) => patch({ gauge: { ...gauge, min } })}
                    />
                    <NumberField
                      label="Scale maximum"
                      value={gauge.max}
                      onChange={(max) => patch({ gauge: { ...gauge, max } })}
                    />
                  </div>
                  <NumberField
                    label={
                      block.targetField
                        ? "Fallback fixed target"
                        : "Fixed target"
                    }
                    value={gauge.targetValue}
                    onChange={(targetValue) =>
                      patch({ gauge: { ...gauge, targetValue } })
                    }
                  />
                  <RangeField
                    label="Arc thickness"
                    value={gauge.arcWidth}
                    min={8}
                    max={40}
                    suffix={`${gauge.arcWidth}px`}
                    onChange={(arcWidth) =>
                      patch({ gauge: { ...gauge, arcWidth } })
                    }
                  />
                  <Toggle
                    label="Rounded arc ends"
                    checked={gauge.roundedEnds}
                    onChange={(roundedEnds) =>
                      patch({ gauge: { ...gauge, roundedEnds } })
                    }
                  />
                  <div className="inspector-subsection-heading">
                    <div>
                      <strong>Qualitative ranges</strong>
                      <small>Optional risk, watch, or on-target bands</small>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const from = gauge.ranges.at(-1)?.to ?? gauge.min ?? 0;
                        const to =
                          gauge.max !== undefined && gauge.max > from
                            ? gauge.max
                            : Math.max(from + 1, from * 1.25 || 1);
                        patch({
                          gauge: {
                            ...gauge,
                            ranges: [
                              ...gauge.ranges,
                              {
                                id: nextGaugeRangeId(gauge.ranges),
                                label: "Range",
                                from,
                                to,
                                color: "#7897c4",
                              },
                            ],
                          },
                        });
                      }}
                    >
                      Add range
                    </button>
                  </div>
                  {gauge.ranges.map((range, rangeIndex) => (
                    <div className="inspector-list-card" key={range.id}>
                      <Field label="Range id">
                        <input value={range.id} readOnly />
                      </Field>
                      <Field label="Label">
                        <input
                          value={range.label}
                          onChange={(e) => {
                            const ranges = [...gauge.ranges];
                            ranges[rangeIndex] = {
                              ...range,
                              label: e.target.value,
                            };
                            patch({ gauge: { ...gauge, ranges } });
                          }}
                        />
                      </Field>
                      <div className="field-grid two">
                        <NumberField
                          label="From"
                          value={range.from}
                          onChange={(from) => {
                            if (from === undefined) return;
                            const ranges = [...gauge.ranges];
                            ranges[rangeIndex] = { ...range, from };
                            patch({ gauge: { ...gauge, ranges } });
                          }}
                        />
                        <NumberField
                          label="To"
                          value={range.to}
                          onChange={(to) => {
                            if (to === undefined) return;
                            const ranges = [...gauge.ranges];
                            ranges[rangeIndex] = { ...range, to };
                            patch({ gauge: { ...gauge, ranges } });
                          }}
                        />
                      </div>
                      <ColorField
                        label="Band color"
                        value={range.color}
                        onChange={(color) => {
                          const ranges = [...gauge.ranges];
                          ranges[rangeIndex] = { ...range, color };
                          patch({ gauge: { ...gauge, ranges } });
                        }}
                      />
                      <button
                        type="button"
                        className="danger-text-button"
                        onClick={() =>
                          patch({
                            gauge: {
                              ...gauge,
                              ranges: gauge.ranges.filter(
                                (candidate) => candidate.id !== range.id,
                              ),
                            },
                          })
                        }
                      >
                        Remove range
                      </button>
                    </div>
                  ))}
                  {gauge.ranges.length > 0 && (
                    <Toggle
                      label="Range labels"
                      checked={gauge.showRangeLabels}
                      onChange={(showRangeLabels) =>
                        patch({ gauge: { ...gauge, showRangeLabels } })
                      }
                    />
                  )}
                </>
              )}
              {block.type === "scatter" && (
                <>
                  <RangeField
                    label="Point size"
                    value={block.chart.scatterPointSize ?? 6}
                    min={2}
                    max={20}
                    suffix={`${block.chart.scatterPointSize ?? 6}px`}
                    onChange={(scatterPointSize) =>
                      patch({ chart: { ...block.chart, scatterPointSize } })
                    }
                  />
                  <Segmented
                    label="Point shape"
                    value={block.chart.scatterPointShape ?? "circle"}
                    options={[
                      { value: "circle", label: "Circle" },
                      { value: "square", label: "Square" },
                      { value: "diamond", label: "Diamond" },
                    ]}
                    onChange={(scatterPointShape) =>
                      patch({
                        chart: {
                          ...block.chart,
                          scatterPointShape:
                            scatterPointShape as DashboardBlock["chart"]["scatterPointShape"],
                        },
                      })
                    }
                  />
                  <ColorField
                    label="Point outline"
                    value={block.chart.scatterPointStroke ?? "#ffffff"}
                    onChange={(scatterPointStroke) =>
                      patch({ chart: { ...block.chart, scatterPointStroke } })
                    }
                  />
                  <RangeField
                    label="Outline width"
                    value={block.chart.scatterPointStrokeWidth ?? 2}
                    min={0}
                    max={6}
                    step={0.5}
                    suffix={`${block.chart.scatterPointStrokeWidth ?? 2}px`}
                    onChange={(scatterPointStrokeWidth) =>
                      patch({
                        chart: { ...block.chart, scatterPointStrokeWidth },
                      })
                    }
                  />
                  {block.chart.scatterShowTrendLine && (
                    <ColorField
                      label="Trend line"
                      value={block.chart.scatterTrendLineColor ?? "#1c2b4a"}
                      onChange={(scatterTrendLineColor) =>
                        patch({
                          chart: { ...block.chart, scatterTrendLineColor },
                        })
                      }
                    />
                  )}
                </>
              )}
              {block.type === "treemap" && (
                <RangeField
                  label="Tile gap"
                  value={Math.min(12, block.chart.barRadius)}
                  min={0}
                  max={12}
                  suffix={`${Math.min(12, block.chart.barRadius)}px`}
                  onChange={(barRadius) =>
                    patch({ chart: { ...block.chart, barRadius } })
                  }
                />
              )}
              {block.type === "heatmap" && (
                <>
                  <RangeField
                    label="Cell gap"
                    value={block.chart.heatmapCellGap ?? 3}
                    min={0}
                    max={12}
                    suffix={`${block.chart.heatmapCellGap ?? 3}px`}
                    onChange={(heatmapCellGap) =>
                      patch({ chart: { ...block.chart, heatmapCellGap } })
                    }
                  />
                  <RangeField
                    label="Cell corners"
                    value={block.chart.heatmapCellRadius ?? 5}
                    min={0}
                    max={16}
                    suffix={`${block.chart.heatmapCellRadius ?? 5}px`}
                    onChange={(heatmapCellRadius) =>
                      patch({ chart: { ...block.chart, heatmapCellRadius } })
                    }
                  />
                </>
              )}
            </InspectorSection>
            {block.type === "scatter" && (
              <InspectorSection title="One-point styling">
                {scatterPointLabels.length ? (
                  <>
                    <Field label="Point">
                      <select
                        value={scatterPointSelection}
                        onChange={(event) =>
                          setScatterPointSelection(event.target.value)
                        }
                      >
                        <option value="">Choose point…</option>
                        {scatterPointLabels.map((label) => (
                          <option key={label} value={label}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {scatterPointSelection &&
                      (() => {
                        const existing = (
                          block.chart.scatterPointStyles ?? []
                        ).find(
                          (style) =>
                            style.label === scatterPointSelection &&
                            style.rowIndex === undefined,
                        );
                        return (
                          <>
                            <ColorField
                              label="Point color"
                              value={
                                existing?.color ??
                                block.chart.colors[0] ??
                                "#355f9d"
                              }
                              onChange={(color) => {
                                const scatterPointStyles = [
                                  ...(
                                    block.chart.scatterPointStyles ?? []
                                  ).filter(
                                    (style) =>
                                      !(
                                        style.label === scatterPointSelection &&
                                        style.rowIndex === undefined
                                      ),
                                  ),
                                  {
                                    ...existing,
                                    label: scatterPointSelection,
                                    color,
                                  },
                                ];
                                patch({
                                  chart: { ...block.chart, scatterPointStyles },
                                });
                              }}
                            />
                            {existing && (
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() =>
                                  patch({
                                    chart: {
                                      ...block.chart,
                                      scatterPointStyles: (
                                        block.chart.scatterPointStyles ?? []
                                      ).filter(
                                        (style) =>
                                          !(
                                            style.label ===
                                              scatterPointSelection &&
                                            style.rowIndex === undefined
                                          ),
                                      ),
                                    },
                                  })
                                }
                              >
                                Reset this point
                              </button>
                            )}
                          </>
                        );
                      })()}
                  </>
                ) : (
                  <p className="inspector-hint">
                    Choose a point-label field in Data binding to style one
                    point without changing the rest.
                  </p>
                )}
              </InspectorSection>
            )}
          </>
        )}

        <InspectorSection title="Tile layout" open={block.type === "sankey"}>
          <RangeField
            label="Grid width"
            value={block.layout.width}
            min={3}
            max={12}
            suffix={`${block.layout.width} / 12`}
            onChange={(width) =>
              patch({
                layout: {
                  ...block.layout,
                  width: width as DashboardBlock["layout"]["width"],
                },
              })
            }
          />
          <NumberField
            label="Minimum height"
            value={block.layout.minHeight}
            min={60}
            max={900}
            onChange={(minHeight) =>
              patch({
                layout: {
                  ...block.layout,
                  minHeight: minHeight ?? block.layout.minHeight,
                },
              })
            }
          />
          {block.type === "sankey" && (
            <p className="inspector-hint">
              Full width and at least 520px high works best for a three-stage
              flow with more than ten destination nodes.
            </p>
          )}
        </InspectorSection>

        <InspectorSection title="Block style">
          {block.type !== "kpi" && (
            <div className="field-grid">
              <ColorField
                label="Accent"
                value={block.style.accent}
                onChange={(accent) =>
                  patch({ style: { ...block.style, accent } })
                }
              />
              <ColorField
                label="Text"
                value={block.style.textColor}
                onChange={(textColor) =>
                  patch({ style: { ...block.style, textColor } })
                }
              />
            </div>
          )}
          <Segmented
            label="Horizontal alignment"
            value={block.style.alignH}
            options={[
              { value: "left", label: "Left" },
              { value: "center", label: "Center" },
              { value: "right", label: "Right" },
            ]}
            onChange={(alignH) =>
              patch({
                style: {
                  ...block.style,
                  alignH: alignH as DashboardBlock["style"]["alignH"],
                },
              })
            }
          />
          <Segmented
            label="Vertical alignment"
            value={block.style.alignV}
            options={[
              { value: "top", label: "Top" },
              { value: "middle", label: "Middle" },
              { value: "bottom", label: "Bottom" },
            ]}
            onChange={(alignV) =>
              patch({
                style: {
                  ...block.style,
                  alignV: alignV as DashboardBlock["style"]["alignV"],
                },
              })
            }
          />
          <div className="field-grid two">
            <NumberField
              label="Padding"
              value={block.style.padding}
              min={0}
              max={64}
              onChange={(padding) =>
                patch({ style: { ...block.style, padding: padding ?? 0 } })
              }
            />
            <NumberField
              label="Corner radius"
              value={block.style.cornerRadius}
              min={0}
              max={40}
              onChange={(cornerRadius) =>
                patch({
                  style: { ...block.style, cornerRadius: cornerRadius ?? 0 },
                })
              }
            />
          </div>
          <RangeField
            label="Type scale"
            value={block.style.fontScale}
            min={75}
            max={160}
            suffix={`${block.style.fontScale}%`}
            onChange={(fontScale) =>
              patch({ style: { ...block.style, fontScale } })
            }
          />
          <Toggle
            label="Border"
            checked={block.style.border}
            onChange={(border) => patch({ style: { ...block.style, border } })}
          />
          <Segmented
            label="Shadow"
            value={block.style.shadow}
            options={[
              { value: "none", label: "None" },
              { value: "soft", label: "Soft" },
              { value: "raised", label: "Raised" },
            ]}
            onChange={(shadow) =>
              patch({
                style: {
                  ...block.style,
                  shadow: shadow as DashboardBlock["style"]["shadow"],
                },
              })
            }
          />
        </InspectorSection>
      </div>
      <footer className="inspector__footer">
        {block.buildState === "placeholder" && (
          <div className="inspector-placeholder-finish">
            <button
              className="is-primary"
              onClick={() =>
                void bus
                  .execute("complete_tile_placeholder", { blockId: block.id })
                  .then(() => setCompletionError(""))
                  .catch((error: unknown) =>
                    setCompletionError(
                      error instanceof Error
                        ? error.message
                        : "Finish the required settings first.",
                    ),
                  )
              }
            >
              <Check size={14} /> Finish setup
            </button>
            {completionError && <small>{completionError}</small>}
          </div>
        )}
        <button
          onClick={() =>
            void bus.execute("duplicate_block", { blockId: block.id })
          }
        >
          <Copy size={14} /> Duplicate
        </button>
        <button
          className="is-danger"
          onClick={() => {
            void bus.execute("remove_block", { blockId: block.id });
            onClose();
          }}
        >
          <Trash2 size={14} /> Delete
        </button>
      </footer>
    </aside>
  );
}

function InspectorSection({
  title,
  open = false,
  children,
}: {
  title: string;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="inspector-section" data-section={title} open={open}>
      <summary>
        {title}
        <ChevronDown size={14} />
      </summary>
      <div className="inspector-section__content">{children}</div>
    </details>
  );
}

function SettingsGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-group">
      <header>
        <strong>{title}</strong>
        <small>{description}</small>
      </header>
      <div className="toggle-grid">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value?: number;
  min?: number;
  max?: number;
  onChange: (value?: number) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={value ?? ""}
        min={min}
        max={max}
        onChange={(e) =>
          onChange(e.target.value === "" ? undefined : Number(e.target.value))
        }
      />
    </Field>
  );
}

function SelectColumn({
  value,
  columns,
  onChange,
}: {
  value?: string;
  columns: string[];
  onChange: (value?: string) => void;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">Choose field…</option>
      {columns.map((column) => (
        <option key={column} value={column}>
          {column}
        </option>
      ))}
    </select>
  );
}

function ColumnChecks({
  label = "Visible columns",
  columns,
  selected,
  emptyMeansAll = false,
  onChange,
}: {
  label?: string;
  columns: string[];
  selected: string[];
  emptyMeansAll?: boolean;
  onChange: (selected: string[]) => void;
}) {
  const checked = emptyMeansAll && !selected.length ? columns : selected;
  return (
    <fieldset className="column-checks">
      <legend>
        {label}
        {emptyMeansAll && !selected.length && <small>All</small>}
      </legend>
      <div>
        {columns.map((column) => (
          <label key={column}>
            <input
              type="checkbox"
              checked={checked.includes(column)}
              onChange={(e) => {
                const next = e.target.checked
                  ? [...new Set([...checked, column])]
                  : checked.filter((item) => item !== column);
                onChange(next);
              }}
            />
            <span>{column}</span>
          </label>
        ))}
      </div>
      {!columns.length && <p>No fields available for this month.</p>}
    </fieldset>
  );
}

function TableSortEditor({
  columns,
  rules,
  onChange,
}: {
  columns: string[];
  rules: TableSortRule[];
  onChange: (rules: TableSortRule[]) => void;
}) {
  const unused = columns.find(
    (column) => !rules.some((rule) => rule.column === column),
  );
  return (
    <fieldset className="table-sort-editor">
      <legend>Sort priority</legend>
      {!rules.length && <p>Source order</p>}
      {rules.map((rule, index) => (
        <div key={index}>
          <b>{index + 1}</b>
          <select
            aria-label={`Sort level ${index + 1} column`}
            value={rule.column}
            onChange={(event) =>
              onChange(
                rules.map((item, ruleIndex) =>
                  ruleIndex === index
                    ? { ...item, column: event.target.value }
                    : item,
                ),
              )
            }
          >
            {columns.map((column) => (
              <option
                key={column}
                value={column}
                disabled={rules.some(
                  (item, ruleIndex) =>
                    ruleIndex !== index && item.column === column,
                )}
              >
                {column}
              </option>
            ))}
          </select>
          <select
            aria-label={`Sort level ${index + 1} direction`}
            value={rule.direction}
            onChange={(event) =>
              onChange(
                rules.map((item, ruleIndex) =>
                  ruleIndex === index
                    ? {
                        ...item,
                        direction: event.target.value as
                          "ascending" | "descending",
                      }
                    : item,
                ),
              )
            }
          >
            <option value="ascending">Ascending</option>
            <option value="descending">Descending</option>
          </select>
          <div>
            <button
              type="button"
              aria-label={`Move sort level ${index + 1} earlier`}
              disabled={index === 0}
              onClick={() => onChange(moveItem(rules, index, index - 1))}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={`Move sort level ${index + 1} later`}
              disabled={index === rules.length - 1}
              onClick={() => onChange(moveItem(rules, index, index + 1))}
            >
              ↓
            </button>
            <button
              type="button"
              aria-label={`Remove sort level ${index + 1}`}
              onClick={() =>
                onChange(rules.filter((_, ruleIndex) => ruleIndex !== index))
              }
            >
              ×
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        disabled={!unused}
        onClick={() =>
          unused &&
          onChange([...rules, { column: unused, direction: "ascending" }])
        }
      >
        + Add sort level
      </button>
    </fieldset>
  );
}

/** Smallest unused `range_N` so deleting a middle range never yields duplicates. */
function nextGaugeRangeId(ranges: Array<{ id: string }>) {
  const used = new Set(ranges.map((range) => range.id));
  let index = 1;
  while (used.has(`range_${index}`)) index += 1;
  return `range_${index}`;
}

function moveItem<T>(items: T[], from: number, to: number) {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function FormatFields({
  format,
  decimals,
  onFormat,
  onDecimals,
}: {
  format: ValueFormat;
  decimals?: number;
  onFormat: (value: ValueFormat) => void;
  onDecimals?: (value: number) => void;
}) {
  return (
    <div className={onDecimals ? "field-grid two" : ""}>
      <Field label="Number format">
        <select
          value={format}
          onChange={(e) => onFormat(e.target.value as ValueFormat)}
        >
          {FORMATS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </Field>
      {onDecimals && (
        <NumberField
          label="Decimals"
          value={decimals}
          min={0}
          max={6}
          onChange={(value) => onDecimals(value ?? 0)}
        />
      )}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <i />
    </label>
  );
}

function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="segmented-field">
      <span>{label}</span>
      <div>
        {options.map((option) => (
          <button
            type="button"
            key={option.value}
            className={value === option.value ? "is-active" : ""}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function KpiIconField({
  value,
  onChange,
}: {
  value: KpiIconName;
  onChange: (value: KpiIconName) => void;
}) {
  const selected =
    KPI_ICON_LIBRARY.find((option) => option.value === value) ??
    KPI_ICON_LIBRARY[0];
  return (
    <fieldset className="kpi-icon-field">
      <legend>Business icon</legend>
      <div role="radiogroup" aria-label="Business icon">
        {KPI_ICON_LIBRARY.map(({ value: optionValue, label, Icon }) => (
          <label
            key={optionValue}
            className={value === optionValue ? "is-selected" : ""}
            title={label}
          >
            <input
              type="radio"
              name="kpi-business-icon"
              value={optionValue}
              checked={value === optionValue}
              aria-label={label}
              onChange={() => onChange(optionValue)}
            />
            <Icon size={17} strokeWidth={1.9} aria-hidden="true" />
          </label>
        ))}
      </div>
      <small>{selected.label}</small>
    </fieldset>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="color-field">
      <span>{label}</span>
      <div>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <code>{value}</code>
      </div>
    </label>
  );
}

function RgbColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const channels = hexToRgb(value);
  return (
    <fieldset className="rgb-color-field">
      <legend>{label}</legend>
      <div className="rgb-color-field__picker">
        <input
          type="color"
          aria-label={`${label} color picker`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <code>{value.toUpperCase()}</code>
      </div>
      <div className="rgb-color-field__channels">
        {(["r", "g", "b"] as const).map((channel) => (
          <label key={channel}>
            <span>{channel.toUpperCase()}</span>
            <input
              type="number"
              min={0}
              max={255}
              step={1}
              aria-label={`${label} ${channelName(channel)}`}
              value={channels[channel]}
              onChange={(event) =>
                onChange(
                  rgbToHex({
                    ...channels,
                    [channel]: clampRgb(Number(event.target.value)),
                  }),
                )
              }
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function hexToRgb(value: string) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (!match) return { r: 0, g: 0, b: 0 };
  return {
    r: Number.parseInt(match[1], 16),
    g: Number.parseInt(match[2], 16),
    b: Number.parseInt(match[3], 16),
  };
}

function rgbToHex({ r, g, b }: { r: number; g: number; b: number }) {
  return `#${[r, g, b]
    .map((channel) => clampRgb(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

function clampRgb(value: number) {
  return Math.min(
    255,
    Math.max(0, Math.round(Number.isFinite(value) ? value : 0)),
  );
}

function channelName(channel: "r" | "g" | "b") {
  return channel === "r" ? "red" : channel === "g" ? "green" : "blue";
}

function PaletteField({
  label,
  value,
  fallbackIndex = 0,
  allowCustom = false,
  palette,
  onChange,
}: {
  label: string;
  value: string;
  fallbackIndex?: number;
  allowCustom?: boolean;
  palette: readonly string[];
  onChange: (value: string) => void;
}) {
  const normalized = value.toLowerCase();
  const selected =
    palette.includes(normalized) ||
    (allowCustom && /^#[0-9a-f]{6}$/.test(normalized))
      ? normalized
      : palette[Math.abs(fallbackIndex) % palette.length];
  return (
    <fieldset className="palette-field">
      <legend>{label}</legend>
      <div role="radiogroup" aria-label={label}>
        {palette.map((color) => (
          <button
            key={color}
            type="button"
            className={selected === color ? "is-selected" : ""}
            aria-label={`${label}: ${color}`}
            aria-pressed={selected === color}
            title={color}
            onClick={() => onChange(color)}
          >
            <i style={{ background: color }} />
          </button>
        ))}
      </div>
      {allowCustom && (
        <input
          type="color"
          aria-label={`${label} custom color`}
          value={selected}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      <code>{selected}</code>
    </fieldset>
  );
}

function SankeyElementStyleEditor({
  block,
  table,
  onChange,
}: {
  block: DashboardBlock;
  table: DataTable;
  onChange: (chart: DashboardBlock["chart"]) => void;
}) {
  const sourceIndex = table.columns.indexOf(block.categoryField ?? "");
  const targetIndex = table.columns.indexOf(block.targetField ?? "");
  const links =
    sourceIndex < 0 || targetIndex < 0
      ? []
      : [
          ...new Map(
            table.rows
              .map((row) => ({
                source: String(row[sourceIndex] ?? "").trim(),
                target: String(row[targetIndex] ?? "").trim(),
              }))
              .filter((link) => link.source && link.target)
              .map((link) => [`${link.source}\u0000${link.target}`, link]),
          ).values(),
        ];
  const nodes = [
    ...new Set(links.flatMap((link) => [link.source, link.target])),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const [selectedNode, setSelectedNode] = useState("");
  const [selectedLink, setSelectedLink] = useState("");
  const node = nodes.includes(selectedNode) ? selectedNode : (nodes[0] ?? "");
  const linkKey = links.some(
    (link) => `${link.source}\u0000${link.target}` === selectedLink,
  )
    ? selectedLink
    : links[0]
      ? `${links[0].source}\u0000${links[0].target}`
      : "";
  const link = links.find(
    (item) => `${item.source}\u0000${item.target}` === linkKey,
  );
  const nodeOverrides = block.chart.sankeyNodeOverrides ?? [];
  const linkOverrides = block.chart.sankeyLinkOverrides ?? [];
  const nodeOverride = nodeOverrides.find((item) => item.node === node);
  const linkOverride = linkOverrides.find(
    (item) => item.source === link?.source && item.target === link?.target,
  );
  const updateNode = (patch: Partial<(typeof nodeOverrides)[number]>) => {
    if (!node) return;
    onChange({
      ...block.chart,
      sankeyNodeOverrides: [
        ...nodeOverrides.filter((item) => item.node !== node),
        { ...nodeOverride, node, ...patch },
      ],
    });
  };
  const updateLink = (patch: Partial<(typeof linkOverrides)[number]>) => {
    if (!link) return;
    onChange({
      ...block.chart,
      sankeyLinkOverrides: [
        ...linkOverrides.filter(
          (item) => item.source !== link.source || item.target !== link.target,
        ),
        { ...linkOverride, source: link.source, target: link.target, ...patch },
      ],
    });
  };

  if (!nodes.length) return null;
  return (
    <div className="sankey-element-styles">
      <strong>Individual elements</strong>
      <p className="inspector-hint">
        Pick one exact data element. These controls change only that node or
        link and leave the automatic palette untouched.
      </p>
      <Field label="Node">
        <select
          aria-label="Node style target"
          value={node}
          onChange={(event) => setSelectedNode(event.target.value)}
        >
          {nodes.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </Field>
      <div className="sankey-element-styles__controls">
        <ColorField
          label="Selected node color"
          value={nodeOverride?.color ?? DEFAULT_SANKEY_COLORS[0]}
          onChange={(color) => updateNode({ color })}
        />
        <Toggle
          label="Highlight node"
          checked={nodeOverride?.highlighted ?? false}
          onChange={(highlighted) => updateNode({ highlighted })}
        />
      </div>
      <Field label="Node display label">
        <input
          value={nodeOverride?.label ?? ""}
          placeholder={node}
          onChange={(event) => updateNode({ label: event.target.value })}
        />
      </Field>
      <button
        type="button"
        className="secondary-button"
        disabled={!nodeOverride}
        onClick={() =>
          onChange({
            ...block.chart,
            sankeyNodeOverrides: nodeOverrides.filter(
              (item) => item.node !== node,
            ),
          })
        }
      >
        Reset selected node
      </button>
      {link && (
        <>
          <Field label="Link">
            <select
              aria-label="Link style target"
              value={linkKey}
              onChange={(event) => setSelectedLink(event.target.value)}
            >
              {links.map((item) => {
                const value = `${item.source}\u0000${item.target}`;
                return (
                  <option key={value} value={value}>
                    {item.source} → {item.target}
                  </option>
                );
              })}
            </select>
          </Field>
          <div className="sankey-element-styles__controls">
            <ColorField
              label="Selected link color"
              value={linkOverride?.color ?? DEFAULT_SANKEY_COLORS[0]}
              onChange={(color) => updateLink({ color })}
            />
            <Toggle
              label="Highlight link"
              checked={linkOverride?.highlighted ?? false}
              onChange={(highlighted) => updateLink({ highlighted })}
            />
          </div>
          <RangeField
            label="Selected link opacity"
            value={
              linkOverride?.opacity ?? block.chart.sankeyLinkOpacity ?? 0.5
            }
            min={0.05}
            max={1}
            step={0.05}
            suffix={`${Math.round(
              (linkOverride?.opacity ?? block.chart.sankeyLinkOpacity ?? 0.5) *
                100,
            )}%`}
            onChange={(opacity) => updateLink({ opacity })}
          />
          <button
            type="button"
            className="secondary-button"
            disabled={!linkOverride}
            onClick={() =>
              onChange({
                ...block.chart,
                sankeyLinkOverrides: linkOverrides.filter(
                  (item) =>
                    item.source !== link.source || item.target !== link.target,
                ),
              })
            }
          >
            Reset selected link
          </button>
        </>
      )}
    </div>
  );
}

function CategoryElementStyleEditor({
  noun,
  categories,
  styles,
  allowTextColor = false,
  onChange,
}: {
  noun: "slice" | "tile";
  categories: string[];
  styles: Array<{
    category: string;
    color?: string;
    textColor?: string;
    opacity?: number;
  }>;
  allowTextColor?: boolean;
  onChange: (
    styles: Array<{
      category: string;
      color?: string;
      textColor?: string;
      opacity?: number;
    }>,
  ) => void;
}) {
  const [chosen, setChosen] = useState(categories[0] ?? "");
  // Derive the active category instead of syncing state in an effect, so a
  // fresh `categories` array never triggers a render-time effect loop.
  const selected = categories.includes(chosen) ? chosen : (categories[0] ?? "");
  const current = styles.find((style) => style.category === selected);
  const update = (next: Record<string, unknown>) => {
    if (!selected) return;
    onChange([
      ...styles.filter((style) => style.category !== selected),
      { ...current, category: selected, ...next },
    ]);
  };
  return (
    <details className="inspector-subgroup">
      <summary>
        <span>Style one {noun}</span>
        <ChevronDown size={13} />
      </summary>
      <div>
        <Field label={`Exact ${noun}`}>
          <select
            value={selected}
            onChange={(event) => setChosen(event.target.value)}
          >
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </Field>
        {selected && (
          <>
            <div className="field-grid two">
              <ColorField
                label="Fill"
                value={current?.color ?? BLUE_CHART_PALETTE[0]}
                onChange={(color) => update({ color })}
              />
              {allowTextColor && (
                <ColorField
                  label="Label"
                  value={current?.textColor ?? "#ffffff"}
                  onChange={(textColor) => update({ textColor })}
                />
              )}
            </div>
            <RangeField
              label="Opacity"
              value={current?.opacity ?? 1}
              min={0.1}
              max={1}
              step={0.05}
              suffix={`${Math.round((current?.opacity ?? 1) * 100)}%`}
              onChange={(opacity) => update({ opacity })}
            />
            <button
              type="button"
              disabled={!current}
              onClick={() =>
                onChange(styles.filter((style) => style.category !== selected))
              }
            >
              Reset {noun}
            </button>
          </>
        )}
      </div>
    </details>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="range-field">
      <span>
        {label}
        <b>{suffix}</b>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

/**
 * The binding patch for switching a block to another dataset. Fields are
 * re-pointed at sensible columns of the new table so a chart keeps rendering
 * and the command validator accepts the edit; the person then refines them.
 */
export function defaultBindingPatch(
  project: TesseraProject,
  block: DashboardBlock,
  datasetId: string | undefined,
): Partial<DashboardBlock> {
  const cleared: Partial<DashboardBlock> = {
    datasetId,
    period: block.period === "all" ? "latest" : block.period,
    categoryField: undefined,
    targetField: undefined,
    valueField: undefined,
    valueFields: [],
  };
  const table = selectedReadyMonth(findAsset(project, datasetId))?.cleaned;
  if (!datasetId || !table) return cleared;
  const numbers = numericColumns(table);
  // Period and status columns describe the row, not the thing being charted.
  const descriptive = /period|month|date|status/i;
  const allText = textColumns(table);
  const text = allText.filter((column) => !descriptive.test(column));
  const named = (pattern: RegExp) =>
    allText.find((column) => pattern.test(column));
  const category = text[0] ?? allText[0] ?? table.columns[0];
  const value = numbers[0];
  switch (block.type) {
    case "bar":
    case "horizontalBar":
    case "line":
    case "heatmap":
      return {
        ...cleared,
        categoryField: category,
        valueFields: value ? [value] : [],
      };
    case "groupedBar":
      return {
        ...cleared,
        categoryField: category,
        valueFields: numbers.slice(0, 2),
      };
    case "donut":
    case "treemap":
      return { ...cleared, categoryField: category, valueField: value };
    case "sankey": {
      const source = named(/^(source|from|origin)\b/i) ?? text[0] ?? allText[0];
      const target =
        named(/^(target|to|destination)\b/i) ??
        text.find((column) => column !== source) ??
        source;
      return {
        ...cleared,
        categoryField: source,
        targetField: target,
        valueField: value,
      };
    }
    case "scatter":
      return {
        ...cleared,
        categoryField: numbers[0],
        valueField: numbers[1] ?? numbers[0],
      };
    case "gauge":
      return {
        ...cleared,
        valueField: value,
        valueFields: value ? [value] : [],
      };
    case "kpi":
      return { ...cleared, valueField: value };
    default:
      return cleared;
  }
}

function compactInspectorPatch(
  block: DashboardBlock,
  patch: Partial<DashboardBlock>,
) {
  const result = { ...patch } as Record<string, unknown>;
  const compactObject = (
    current: Record<string, unknown>,
    next: Record<string, unknown>,
  ) =>
    Object.fromEntries(
      Object.entries(next).filter(([key, value]) => current[key] !== value),
    );
  (
    ["style", "chart", "table", "kpi", "illustration", "layout"] as const
  ).forEach((key) => {
    const next = patch[key];
    if (!next) return;
    const compact = compactObject(
      block[key] as unknown as Record<string, unknown>,
      next as unknown as Record<string, unknown>,
    );
    if (Object.keys(compact).length) result[key] = compact;
    else delete result[key];
  });
  if (patch.gauge) {
    const compact = compactObject(
      block.gauge as unknown as Record<string, unknown>,
      patch.gauge as unknown as Record<string, unknown>,
    );
    if (patch.gauge.colors) {
      const colors = compactObject(
        block.gauge.colors as unknown as Record<string, unknown>,
        patch.gauge.colors as unknown as Record<string, unknown>,
      );
      if (Object.keys(colors).length) compact.colors = colors;
      else delete compact.colors;
    }
    if (Object.keys(compact).length) result.gauge = compact;
    else delete result.gauge;
  }
  return result;
}
