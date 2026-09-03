import { DEFAULT_COLORS, EMPHASIS_COLORS } from "./defaults";
import type { ToolDefinition } from "./types";

export const TESSERA_MODEL_CONTEXT_VERSION = "storytelling-v2";

export const PALETTE_RULE = `Keep the house palette. Every chart uses the dashboard's kit palette (slate blue by default; burnt orange or maroon when a kit is applied with set_dashboard_kit) and every card surface is white; never tint a card or invent a palette. Color carries meaning only: green ${EMPHASIS_COLORS.positive} for met or improving, red ${EMPHASIS_COLORS.negative} for missed or worsening, amber ${EMPHASIS_COLORS.warning} for at risk, and one brighter blue ${EMPHASIS_COLORS.focus} for the single item to emphasize.`;

export const COMMENTARY_LAYOUT_RULE =
  "A short commentary card must never sit alone beside a tall chart or table: it stretches to that height and shows empty surface. Give it a full-width row under the chart, or stack it with a second short card (a KPI or another note) in the same column so the heights match.";

export const DASHBOARD_STORYTELLING_CONTRACT = `Build a data-driven editorial dashboard that reads like a newspaper, not a pile of widgets.

1. Establish the thesis. Use the dashboard header for a specific decision-oriented title, a short eyebrow naming scope and period, and one sentence explaining the central takeaway. Write chart titles as findings, not generic labels.
2. Lead with the news. Place three or four decision KPIs together in the first content row (four at width 3 or three at width 4). Put the most important KPI first and give only that KPI, or at most two genuinely urgent KPIs, a brighter semantic accent. Keep the remaining KPI surfaces calmer so emphasis is meaningful.
3. Move from overview to explanation to evidence. After the KPI row, show the broadest comparison or trend, such as the top-performing region and the overall pattern. Next explain the contrast with a focused view of the lowest-performing region, the driver, exception, or bottleneck. End with the most granular evidence in a table.
4. Create an emphasis ombre. Visual weight should be strongest at the top, more analytical and restrained through the middle, and dense but orderly at the bottom. ${PALETTE_RULE}
5. Vary the visual grammar. Do not default to only bar charts. Use a line for time, horizontal bars for rankings or long labels, grouped bars for a small number of comparable measures, donut only for a simple part-to-whole, Sankey for additive flow, scatter for relationships/outliers, heatmap for matrix patterns, and tables for detailed evidence.
6. Compose, do not tile mechanically. Do not default every pair to 50/50. Use purposeful full-width moments and asymmetric 7/5, 8/4, or 4/8 pairings based on information density. Align related blocks in a row; start a new row when the story changes. ${COMMENTARY_LAYOUT_RULE}
7. Protect analytical integrity. Use only cleaned, approved data for dashboard blocks. Preserve exact dataset field names, units, periods, and category meaning. Do not invent values or imply causality unsupported by the data. Use comparisons and targets only when their basis is clear.
8. Finish at evidence level. Put colored tables last, at the highest useful granularity. Use restrained group or conditional color, clear number formats, and sorting that exposes the finding. Avoid decorative coloring that competes with the lead story.`;

export const SANKEY_CONSTRUCTION_GUIDE = `Use a Sankey only when the question is how a positive additive quantity moves through two or more named stages; never use it for a simple ranking, ordinary time series, or unrelated categories. Bind a long table with one source, one target, and one positive numeric value per relationship. Normalize node names before calling so the same entity is not split by spelling or casing, and make sure repeated links may be safely summed. Give every left-to-right stage a short label. Keep the visible network selective enough to trace; aggregate tiny residual paths when the source data supports an "Other" node. Use a finding-led title and a subtitle that names the quantity, period, and scope. Prefer a wide tile. Keep node labels and shares on, individual link values off when crowded, and leave the branches in the default blue-and-grey palette. Highlight only the one to three nodes or links that prove the takeaway, using the emphasis blue or a status color as an exact override rather than coloring every path. Place the Sankey after the lead KPIs or overview, where it can explain a flow, bottleneck, leakage, or concentration.`;

export const TESSERA_MODEL_CONTEXT = {
  version: TESSERA_MODEL_CONTEXT_VERSION,
  purpose:
    "Tessera turns approved warehouse data into decision-oriented editorial dashboards.",
  defaultDashboardStructure: [
    "Header: scope, period, decision title, and one-sentence thesis",
    "Lead row: three or four KPIs; one or two receive stronger semantic emphasis",
    "Overview: broad trend or top-performing segment",
    "Explanation: weakest segment, driver, exception, or bottleneck in greater detail",
    "Evidence: most granular colored table at the bottom",
  ],
  layoutRules: [
    "Use purposeful full-width and asymmetric 7/5, 8/4, or 4/8 compositions",
    "Do not default every row to two equal-width charts",
    "Keep related analysis and commentary together",
    COMMENTARY_LAYOUT_RULE,
  ],
  visualRules: [
    PALETTE_RULE,
    "Emphasis fades from top to bottom; at most one or two KPIs carry a status accent",
    "Vary chart types according to the analytical question",
    "Use finding-led titles and concise interpretation",
  ],
  palette: {
    surfaces: "white only",
    series: [...DEFAULT_COLORS],
    emphasis: { ...EMPHASIS_COLORS },
  },
  dataRules: [
    "Use cleaned and approved data only",
    "Preserve exact fields, units, periods, and category meaning",
    "Never invent values or unsupported causes",
  ],
};

const EXACT_GUIDANCE: Record<string, string> = {
  get_project_context:
    "Call first when the active project, cleaned periods, dataset IDs, or existing dashboards are unknown. Treat the returned IDs and readiness states as authoritative.",
  list_generated_illustrations:
    "Use before generating a new scene; reuse a suitable saved asset to save time and keep the visual language consistent.",
  create_project:
    "Use only for a genuinely separate body of data and dashboards. A project is a private warehouse-plus-dashboard boundary, not a dashboard tab.",
  activate_project:
    "Switch only when the user intends to change the complete warehouse and dashboard context.",
  rename_project:
    "Use for the group name only; do not use it to rename an individual dashboard.",
  create_dashboard:
    "Create the blank editorial canvas before adding blocks. Use a concise publication-style name; duplicate names reopen the existing dashboard.",
  activate_dashboard:
    "Use to open an existing dashboard without changing its content.",
  update_dashboard:
    "Use the header eyebrow for scope and period, the name for the decision-oriented headline, and the description for the one-sentence thesis.",
  set_dashboard_kit:
    "Switch the whole dashboard's default palette in one move (slate-blue, burnt-orange, or maroon) instead of recolouring cards one by one. Emphasis colours and hand-set colours survive the switch, so apply the kit first and add emphasis afterwards.",
  inspect_dashboard:
    "Inspect only when existing block IDs or bindings are needed for edits. Mutation results already include a fresh snapshot, so do not inspect again after a successful mutation.",
  build_dashboard_fast: `Default for creating a dashboard or adding two or more blocks. Follow this contract unless the user explicitly requests a different structure:\n\n${DASHBOARD_STORYTELLING_CONTRACT}\n\nOrder the operations exactly as the reader should encounter them: create/open and name the dashboard, set its header, add the KPI row, add overview analysis, add focused explanation and commentary, then add detailed evidence. Build all non-image work in this one call.`,
  get_tile_placeholders:
    "Use only when finishing an intentionally staged dashboard. Prefer direct block creation for an ordinary build.",
  add_tile_placeholder:
    "Reserve a named future story beat only when progressive construction is visible or another process will fulfill it.",
  update_tile_placeholder:
    "Refine the promised content or layout without pretending the tile is complete.",
  complete_tile_placeholder:
    "Mark complete only after the promised block has been fulfilled and its binding is valid.",
  update_dataset_recipe:
    "Use to rename canonical fields or add source headers before they arrive. Send the complete header map; the recipe is applied to every future month of that dataset.",
  create_dataset:
    "Create a stable dataset identity and grain before adding monthly source versions. Name the business subject, not the uploaded filename.",
  save_dataset_month_upload:
    "Preserve the uploaded workbook as the immutable original month. Saving does not make its tables dashboard-ready.",
  start_dataset_month_processing:
    "Begin visible outlining and profiling. For later months, prioritize finding and normalizing the fields used by the parent month and its dashboards.",
  inspect_dataset_month_source:
    "Read raw source regions and profiling evidence before proposing mappings; do not treat this inspection as cleaned data.",
  propose_dataset_month_outline:
    "Define table boundaries, headers, types, keys, and canonical fields. Surface ambiguous mappings as user questions rather than guessing.",
  answer_dataset_month_questions:
    "Apply only explicit choices submitted through the user-facing clarification dialog.",
  create_dataset_month_cleaning_draft:
    "Create a reviewable draft that preserves the original and records normalization decisions. Reuse approved parent-month variables whenever semantically equivalent.",
  approve_dataset_month:
    "Approve only after questions are resolved and the cleaned tables preserve the intended grain, variables, and units.",
  get_monthly_refresh_status:
    "Use to determine the next safe refresh step and whether the month is original, processing, draft, approved, or dashboard-ready.",
  update_cleaned_table:
    "Use for a narrow reviewed correction to a pending cleaned draft, never for altering the uploaded original. Approved months are locked.",
  analyze_table:
    "Profile one cleaned table for distributions, missingness, keys, extremes, and candidate story angles before choosing a visual.",
  analyze_dataset:
    "Use to identify the strongest cross-table dashboard story, lead KPIs, comparisons, exceptions, and available granularity.",
  clean_dataset_month:
    "Use the complete cleaning workflow when ambiguity is low; preserve lineage and pause for user choices when a consequential mapping cannot be inferred safely.",
  create_monthly_dashboard_edition:
    "Clone the established layout into a new monthly edition, then update data, findings, emphasis, commentary, and only the chart layouts the new story requires.",
  build_dashboard_from_dataset:
    "Use for a quick cleaned-data starting point; for a deliberate multi-block editorial story, prefer build_dashboard_fast.",
  add_section_header:
    "Use at a genuine shift in the story, such as Overview, What is driving it, or Detailed evidence; avoid a divider before every card.",
  add_heading:
    "Use for a short standalone headline when a full section divider would be too heavy.",
  add_text: `Write interpretation, not a transcript of the chart: state what changed, why it matters, and the decision or question it creates. Keep it adjacent to the evidence it explains. ${COMMENTARY_LAYOUT_RULE} Card surfaces stay white; do not pass a background.`,
  add_illustration_card:
    "Use approved artwork as a restrained editorial breath or thematic cue, never in place of data evidence.",
  add_generated_illustration_card:
    "Use only after non-image blocks are built and only when no approved or saved scene fits. The locked style and pixel-transfer contract are mandatory.",
  add_saved_illustration_card:
    "Prefer this over regenerating a matching scene. Recoloring is allowed; preserve the image-only default.",
  add_kpi: `Lead with three or four KPIs in one row. Put the decision-critical KPI first and keep labels, direction, period, comparison basis, and number format explicit. Leave the accent at its default blue unless the KPI carries a status: ${EMPHASIS_COLORS.negative} for a missed target, ${EMPHASIS_COLORS.warning} for at risk, ${EMPHASIS_COLORS.positive} for met, or ${EMPHASIS_COLORS.focus} for the one KPI to emphasize; the icon takes the same color. Do not pair a compact format with a unit suffix such as K.`,
  add_table:
    "Use as the final evidence layer at the highest useful grain. Show only decision-relevant columns, sort to expose the finding, format units clearly, and apply restrained group or conditional color rather than decorative striping everywhere.",
  add_bar_chart:
    "Use for a small set of short-label category comparisons. Do not use for a time trend or long ranking, and do not make it the automatic chart choice.",
  add_horizontal_bar_chart:
    "Use for ranked categories, long labels, or more than roughly eight items. Sort deliberately and emphasize only the meaningful leader, laggard, or benchmark exception.",
  add_grouped_bar_chart:
    "Use for two to four directly comparable measures across the same categories. Keep a stable series order and avoid a crowded legend or too many groups.",
  add_line_chart:
    "Use for ordered time or sequence. Preserve chronological source order, keep the scale honest, label only decisive points when crowded, and use consistent colors for recurring measures.",
  add_donut_chart:
    "Use only for one simple part-to-whole with a small number of categories that sum to a meaningful total. Prefer bars when precise ranking matters.",
  style_donut_slice:
    "Highlight at most one decision-relevant slice and preserve the part-to-whole palette; do not turn every slice into a competing callout.",
  add_gauge_chart:
    "Use for one current value against a meaningful target or bounded range. Do not use merely to decorate a KPI.",
  add_scatter_chart:
    "Use to reveal relationship, clusters, outliers, or quadrants between two numeric measures. Label only important points and avoid implying causation.",
  add_treemap_chart:
    "Use for hierarchical or many-part composition when area comparison is sufficient. Prefer bars when exact rank differences are the main question.",
  style_treemap_tile:
    "Emphasize one meaningful category or exception while preserving the treemap's area hierarchy and base palette.",
  add_heatmap_chart:
    "Use for a category-by-measure matrix, concentration, seasonality, or exception pattern. Choose sequential versus diverging color from the analytical meaning and keep the midpoint explicit when it matters.",
  add_sankey_chart: SANKEY_CONSTRUCTION_GUIDE,
  update_block:
    "Use for a focused content, binding, layout, or presentation correction. Preserve unrelated settings and the dashboard's editorial hierarchy.",
  remove_block:
    "Remove only the named block; neighboring cards automatically reclaim the available grid space.",
  duplicate_block:
    "Duplicate only when the copied structure will be rebound or compared intentionally; avoid repetitive near-identical cards.",
  move_block:
    "Move blocks to improve reading order: lead news first, explanation next, evidence last. Keep commentary beside the chart it interprets.",
  set_dashboard_layout:
    "Compose rows intentionally. Use full-width for a major overview, 3x4 or 4x3 KPI rows, and asymmetric 7/5, 8/4, or 4/8 analytical pairs instead of defaulting to 6/6.",
  style_bar:
    "Use a surgical override to call out the one category that proves the finding; preserve the chart's base palette.",
  style_scatter_point:
    "Highlight a true outlier or decision-relevant point, not every observation.",
  style_sankey_element:
    "Highlight only the node or source-target link that proves the stated flow finding; preserve the coherent base network.",
  style_line_chart_element:
    "Use for one decisive series or point, such as the current month, breach, or inflection; do not decorate every point.",
  style_gauge_element:
    "Use exact range or marker emphasis only when it changes the interpretation of target performance.",
  style_heatmap_cell:
    "Override one exceptional cell only when the global scale would otherwise hide a decision-relevant fact.",
  style_table_column:
    "Format units, alignment, width, and emphasis for one column while preserving the table-wide hierarchy.",
  style_table_cell:
    "Use for a rare exception or callout; prefer rule-based group or heatmap coloring for systematic meaning.",
  set_table_sort:
    "Sort to expose the table's intended evidence, using stable secondary rules when ties matter.",
  style_table_group:
    "Use consistent restrained color for a meaningful categorical group, not a unique color for every row.",
};

function inferredGuidance(definition: ToolDefinition) {
  if (definition.readOnly)
    return "Use this read-only result to choose the next smallest necessary operation; do not repeat it when a fresh mutation result already contains the needed state.";
  if (definition.name.startsWith("style_"))
    return "Make a sparse exact-element edit and preserve all unrelated styling, bindings, and layout.";
  if (definition.name.startsWith("add_"))
    return "Add this only when it advances the reader's next question and place it according to the editorial reading order.";
  return "Use this as a narrow, validated operation; preserve unrelated project data, dashboard structure, and prior monthly versions.";
}

export function withModelGuidance(definition: ToolDefinition): ToolDefinition {
  const guidance =
    EXACT_GUIDANCE[definition.name] ?? inferredGuidance(definition);
  return {
    ...definition,
    description: `${definition.description}\n\nMODEL GUIDANCE: ${guidance}`,
  };
}
