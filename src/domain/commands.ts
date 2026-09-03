import {
  createBlock,
  createDashboard,
  createProject,
  defaultGaugeSettings,
  defaultIllustrationSettings,
} from "./defaults";
import { KPI_ICON_NAMES } from "./kpiIcons";
import {
  decodeIllustrationMaskBits,
  ILLUSTRATION_ALPHA_MASK_ENCODING,
  ILLUSTRATION_MASK_ENCODING,
  ILLUSTRATION_MASK_ENCODINGS,
  ILLUSTRATION_PRESET_NAMES,
  ILLUSTRATION_STYLE_CONTRACT_VERSION,
  ILLUSTRATION_STYLE_PROMPT,
  illustrationMaskByteLength,
  illustrationMaskPayloadByteLength,
  illustrationMaskPixelIsOn,
} from "./illustrations";
import {
  activeProject,
  combineAssetMonths,
  numericColumns,
  projectSummary,
  selectedReadyMonth,
  tableForBlock,
} from "./selectors";
import { cleanImportedTable, periodLabel, profileTable } from "../lib/csv";
import { BLOCK_TYPES } from "./types";
import { validateInput } from "./toolValidation";
import { detectLayout, pivotMetricRows } from "../lib/reshape";
import { withModelGuidance } from "./toolGuidance";
import type {
  BlockType,
  Dashboard,
  DashboardBlock,
  DataAsset,
  DatasetCleaningQuestion,
  DataTable,
  DatasetMonth,
  DatasetMonthProcessing,
  DatasetVariableMapping,
  LinePointStyle,
  SourceWorkbook,
  LineSeriesStyle,
  TesseraProject,
  TesseraState,
  ToolDefinition,
  WorksheetRegion,
  DashboardKitId,
} from "./types";
import { layoutWarnings } from "./layout";
import { DEFAULT_KIT_ID, KIT_IDS, KITS, kitFor, recolorBlock } from "./kits";
import {
  dashboardPeriod,
  dashboardSeriesId,
  dashboardSeriesName,
  latestApprovedProjectPeriod,
  periodForDashboardVersion,
  throughPeriodCutoff,
} from "./dashboardPeriods";

export interface CommandContext {
  getState: () => TesseraState;
  setState: (
    updater: (state: TesseraState) => TesseraState,
    history?: StateHistoryOptions,
  ) => void;
  afterExecute?: (
    source: "human" | "webmcp",
    changed: boolean,
    command: { name: string; args: Record<string, unknown> },
  ) => Promise<void>;
  revealDashboardStep?: (delayMs: number) => Promise<void>;
}

export interface StateHistoryOptions {
  record: boolean;
  group?: string;
  label?: string;
}

export interface CommandExecutionOptions {
  historyGroup?: string;
}

/**
 * Commands whose effect the person should watch happen on the canvas. When
 * the agent runs one, the app switches to the Dashboards view and opens the
 * dashboard being built so the cards appear as they are made.
 */
export function revealsDashboard(name: string) {
  return (
    name.startsWith("add_") ||
    [
      "create_dashboard",
      "activate_dashboard",
      "update_dashboard",
      "build_dashboard_fast",
      "build_dashboard_from_dataset",
      "create_monthly_dashboard_edition",
      "set_dashboard_layout",
    ].includes(name)
  );
}

type Source = "human" | "webmcp";

const LAYOUT_WIDTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const CANVAS_COLUMNS = 12;
const MIN_BLOCK_WIDTH = 3;
const MAX_BLOCKS_PER_ROW = CANVAS_COLUMNS / MIN_BLOCK_WIDTH;
const MIN_BLOCK_HEIGHT = 60;
const MAX_BLOCK_HEIGHT = 900;
const FAST_DASHBOARD_OPEN_REVEAL_MS = 320;
const FAST_DASHBOARD_STEP_REVEAL_MS = 180;

const FAST_DASHBOARD_BUILD_OPERATIONS = [
  "create_dashboard",
  "update_dashboard",
  "set_dashboard_layout",
  "add_tile_placeholder",
  "add_section_header",
  "add_heading",
  "add_kpi",
  "add_text",
  "add_table",
  "add_bar_chart",
  "add_horizontal_bar_chart",
  "add_grouped_bar_chart",
  "add_line_chart",
  "add_donut_chart",
  "add_gauge_chart",
  "add_scatter_chart",
  "add_treemap_chart",
  "add_heatmap_chart",
  "add_sankey_chart",
  "add_illustration_card",
  "add_saved_illustration_card",
  "update_block",
  "move_block",
  "remove_block",
] as const;

export class CommandBus {
  readonly #context: CommandContext;
  readonly #definitions: ToolDefinition[];
  #activeCommand?: {
    args: Record<string, unknown>;
    historyGroup?: string;
  };

  constructor(context: CommandContext) {
    this.#context = context;
    this.#definitions = this.buildDefinitions();
  }

  list() {
    return this.#definitions;
  }

  async execute(
    name: string,
    args: Record<string, unknown> = {},
    source: Source = "human",
    options: CommandExecutionOptions = {},
  ) {
    const definition = this.#definitions.find((tool) => tool.name === name);
    if (!definition) throw new Error(`Unknown command: ${name}`);
    validateInput(definition.inputSchema, args);
    const stateBefore = this.#context.getState();
    this.#activeCommand = { args, historyGroup: options.historyGroup };
    let result: unknown;
    let changed = false;
    try {
      result = await definition.execute(args, source);
      changed = this.#context.getState() !== stateBefore;
    } finally {
      this.#activeCommand = undefined;
    }
    await this.#context.afterExecute?.(source, changed, { name, args });
    return result;
  }

  private buildDefinitions(): ToolDefinition[] {
    const definitions: ToolDefinition[] = [
      {
        name: "get_project_context",
        title: "Inspect active dashboard group",
        description:
          "Return the active dashboard group, its private Data Warehouse, monthly datasets, dashboards, and block counts.",
        inputSchema: objectSchema({}),
        readOnly: true,
        execute: () => projectSummary(activeProject(this.#context.getState())),
      },
      {
        name: "list_generated_illustrations",
        title: "List reusable generated illustrations",
        description:
          "List generated illustrations saved in the active project's reusable library. Payload bytes are omitted; use add_saved_illustration_card with an asset ID to place one again without regenerating it.",
        inputSchema: objectSchema({}),
        readOnly: true,
        execute: () =>
          (
            activeProject(this.#context.getState()).generatedIllustrations ?? []
          ).map((asset) => ({
            id: asset.id,
            name: asset.name,
            altText: asset.altText,
            encoding: asset.bitmapMask.encoding,
            width: asset.bitmapMask.width,
            height: asset.bitmapMask.height,
            createdAt: asset.createdAt,
          })),
      },
      {
        name: "create_project",
        title: "Create dashboard group",
        description:
          "Create and activate a dashboard group with its own empty Data Warehouse and blank dashboard.",
        inputSchema: objectSchema(
          { name: stringProp("Dashboard group name") },
          ["name"],
        ),
        readOnly: false,
        execute: (args, source) => {
          const project = createProject(String(args.name));
          this.commit(
            "create_project",
            source,
            `Created ${project.name}`,
            (state) => ({
              ...state,
              activeProjectId: project.id,
              projects: [...state.projects, project],
            }),
          );
          return projectSummary(project);
        },
      },
      {
        name: "activate_project",
        title: "Switch dashboard group",
        description:
          "Switch the entire Tessera context. The dashboard group and its private warehouse data change together.",
        inputSchema: objectSchema({ projectId: stringProp("Project ID") }, [
          "projectId",
        ]),
        readOnly: false,
        execute: (args) => {
          const state = this.#context.getState();
          const projectId = String(args.projectId);
          if (!state.projects.some((project) => project.id === projectId))
            throw new Error("Project not found.");
          this.#context.setState((current) => ({
            ...current,
            activeProjectId: projectId,
          }));
          return projectSummary(
            state.projects.find((project) => project.id === projectId)!,
          );
        },
      },
      {
        name: "rename_project",
        title: "Rename active dashboard group",
        description:
          "Rename the active dashboard group without changing its warehouse or dashboards.",
        inputSchema: objectSchema({ name: stringProp("New project name") }, [
          "name",
        ]),
        readOnly: false,
        execute: (args, source) => {
          const name = String(args.name).trim();
          this.updateActiveProject(
            "rename_project",
            source,
            `Renamed project to ${name}`,
            (project) => {
              project.name = name;
            },
          );
          return { name };
        },
      },
      {
        name: "create_dashboard",
        title: "Create dashboard",
        description:
          "Create and open a blank dashboard in the active dashboard group. Names are idempotent: if a dashboard with the same trimmed, case-insensitive name already exists, this opens and returns it instead of creating a duplicate.",
        inputSchema: objectSchema(
          {
            name: stringProp("Dashboard name"),
            description: stringProp("Optional dashboard purpose"),
            period: stringProp(
              "Reporting month in YYYY-MM format; defaults to the open dashboard month",
              "^\\d{4}-(0[1-9]|1[0-2])$",
            ),
          },
          ["name"],
        ),
        readOnly: false,
        execute: (args, source) => {
          const name = String(args.name).trim();
          if (!name) throw new TypeError("Dashboard name must not be empty.");
          const description = String(args.description ?? "");
          const currentProject = activeProject(this.#context.getState());
          const currentDashboard = currentProject.dashboards.find(
            (dashboard) => dashboard.id === currentProject.activeDashboardId,
          );
          const reportingPeriod = String(
            args.period ??
              (currentDashboard
                ? dashboardPeriod(currentProject, currentDashboard)
                : undefined) ??
              latestApprovedProjectPeriod(currentProject) ??
              "",
          );
          const existing = currentProject.dashboards.find(
            (dashboard) =>
              dashboard.name.trim().toLocaleLowerCase() ===
                name.toLocaleLowerCase() &&
              dashboardPeriod(currentProject, dashboard) === reportingPeriod,
          );
          if (existing) {
            if (
              currentProject.activeDashboardId !== existing.id ||
              (description && description !== existing.description)
            ) {
              this.updateActiveProject(
                "create_dashboard",
                source,
                `Opened existing ${existing.name}`,
                (project) => {
                  const dashboard = requiredDashboard(project, existing.id);
                  if (description) dashboard.description = description;
                  project.activeDashboardId = dashboard.id;
                },
                false,
              );
              return requiredDashboard(
                activeProject(this.#context.getState()),
                existing.id,
              );
            }
            return existing;
          }
          const dashboard = createDashboard(name, reportingPeriod || undefined);
          dashboard.description = description;
          this.updateActiveProject(
            "create_dashboard",
            source,
            `Created ${dashboard.name}`,
            (project) => {
              project.dashboards.push(dashboard);
              project.activeDashboardId = dashboard.id;
            },
          );
          return dashboard;
        },
      },
      {
        name: "activate_dashboard",
        title: "Switch dashboard",
        description: "Open another dashboard inside the active project.",
        inputSchema: objectSchema({ dashboardId: stringProp("Dashboard ID") }, [
          "dashboardId",
        ]),
        readOnly: false,
        execute: (args, source) => {
          const dashboardId = String(args.dashboardId);
          this.updateActiveProject(
            "activate_dashboard",
            source,
            "Switched dashboard",
            (project) => {
              requiredDashboard(project, dashboardId);
              project.activeDashboardId = dashboardId;
            },
            false,
          );
          return { dashboardId };
        },
      },
      {
        name: "update_dashboard",
        title: "Update dashboard details",
        description:
          "Rename a dashboard or change its header eyebrow or description.",
        inputSchema: objectSchema(
          {
            dashboardId: stringProp(
              "Dashboard ID; defaults to active dashboard",
            ),
            name: stringProp("Dashboard name"),
            headerEyebrow: stringProp("Dashboard header eyebrow"),
            description: stringProp("Dashboard description"),
          },
          [],
        ),
        readOnly: false,
        execute: (args, source) => {
          let result;
          this.updateActiveProject(
            "update_dashboard",
            source,
            "Updated dashboard",
            (project) => {
              const dashboard = requiredDashboard(
                project,
                String(args.dashboardId ?? project.activeDashboardId),
              );
              if (args.name !== undefined) dashboard.name = String(args.name);
              if (args.headerEyebrow !== undefined)
                dashboard.headerEyebrow = String(args.headerEyebrow);
              if (args.description !== undefined)
                dashboard.description = String(args.description);
              dashboard.updatedAt = new Date().toISOString();
              result = dashboard;
            },
          );
          return result;
        },
      },
      {
        name: "delete_dashboard",
        title: "Delete dashboard",
        description:
          "Human-only safety gate. Delete an entire dashboard series, including each of its monthly editions.",
        inputSchema: objectSchema(
          { dashboardId: stringProp("Dashboard ID in the series to delete") },
          ["dashboardId"],
        ),
        readOnly: false,
        execute: (args, source) => {
          if (source === "webmcp")
            throw new Error(
              "Dashboards must be deleted by the user in Tessera.",
            );
          const dashboardId = String(args.dashboardId);
          const currentProject = activeProject(this.#context.getState());
          const target = requiredDashboard(currentProject, dashboardId);
          const seriesId = dashboardSeriesId(currentProject, target);
          const seriesName = dashboardSeriesName(currentProject, target);
          const removed = currentProject.dashboards.filter(
            (candidate) =>
              dashboardSeriesId(currentProject, candidate) === seriesId,
          );
          const removedIds = new Set(removed.map((item) => item.id));
          const activeWasRemoved = removedIds.has(
            currentProject.activeDashboardId,
          );
          const activeBefore = currentProject.dashboards.find(
            (item) => item.id === currentProject.activeDashboardId,
          );
          const preferredPeriod = activeBefore
            ? dashboardPeriod(currentProject, activeBefore)
            : dashboardPeriod(currentProject, target);
          const blockCount = removed.reduce(
            (total, item) => total + item.blocks.length,
            0,
          );
          let result;

          this.updateActiveProject(
            "delete_dashboard",
            source,
            `Deleted dashboard ${seriesName}`,
            (project) => {
              project.dashboards = project.dashboards.filter(
                (candidate) => !removedIds.has(candidate.id),
              );
              project.dashboards.forEach((candidate) => {
                if (
                  candidate.edition?.sourceDashboardId &&
                  removedIds.has(candidate.edition.sourceDashboardId)
                )
                  delete candidate.edition.sourceDashboardId;
              });

              let replacementCreated = false;
              if (!project.dashboards.length) {
                const replacement = createDashboard(
                  "Dashboard 1",
                  preferredPeriod,
                );
                project.dashboards.push(replacement);
                project.activeDashboardId = replacement.id;
                replacementCreated = true;
              } else if (activeWasRemoved) {
                const next =
                  project.dashboards.find(
                    (candidate) =>
                      dashboardPeriod(project, candidate) === preferredPeriod,
                  ) ?? project.dashboards[0];
                project.activeDashboardId = next.id;
              }

              result = {
                dashboardId,
                seriesId,
                name: seriesName,
                removedDashboardIds: [...removedIds],
                removedEditionCount: removed.length,
                removedBlockCount: blockCount,
                activeDashboardId: project.activeDashboardId,
                replacementCreated,
              };
            },
          );
          return result;
        },
      },
      {
        name: "set_dashboard_kit",
        title: "Apply a brand kit",
        description:
          "Recolour a dashboard with one of the brand kits: slate-blue, burnt-orange, or maroon. Every colour still at the previous kit's default moves to the new kit; emphasis colours and colours set by hand keep their values. People switch kits from the Kit tab.",
        inputSchema: objectSchema(
          {
            dashboardId: stringProp("Dashboard ID; defaults to active"),
            kit: enumProp("Brand kit", [...KIT_IDS]),
          },
          ["kit"],
        ),
        readOnly: false,
        execute: (args, source) => {
          let result;
          this.updateActiveProject(
            "set_dashboard_kit",
            source,
            `Applied the ${String(args.kit)} kit`,
            (project) => {
              const dashboard = requiredDashboard(
                project,
                String(args.dashboardId ?? project.activeDashboardId),
              );
              const next = KITS[args.kit as DashboardKitId];
              if (!next)
                throw new TypeError(`Unknown kit: ${String(args.kit)}.`);
              const previous = kitFor(dashboard);
              dashboard.blocks.forEach((block) =>
                recolorBlock(block, previous, next),
              );
              dashboard.kit = next.id;
              dashboard.updatedAt = new Date().toISOString();
              result = {
                dashboardId: dashboard.id,
                kit: next.id,
                palette: [...next.palette],
                accent: next.accent,
              };
            },
          );
          return result;
        },
      },
      {
        name: "inspect_dashboard",
        title: "Inspect dashboard",
        description:
          "Return the dashboard with complete data bindings and only the settings relevant to each block type, including sparse exact-element overrides.",
        inputSchema: objectSchema({
          dashboardId: stringProp("Dashboard ID; defaults to active"),
        }),
        readOnly: true,
        execute: (args) => {
          const project = activeProject(this.#context.getState());
          return dashboardInspectionView(
            requiredDashboard(
              project,
              String(args.dashboardId ?? project.activeDashboardId),
            ),
          );
        },
      },
      {
        name: "build_dashboard_fast",
        title: "Build dashboard fast (one call)",
        description:
          "FAST DEFAULT for any request that creates a dashboard or adds two or more blocks. Run an ordered plan of up to 12 existing dashboard operations in one WebMCP call. Tessera first opens and names the blank dashboard, then visibly renders each later operation in order with a short presentation cadence; every operation still validates against its normal schema and appears in activity. Start with create_dashboard when needed, then omit dashboardId so later blocks use the newly active dashboard. Set widths on adjacent blocks to define their split; the first card appears full-width, then cards automatically snap, split, and reclaim space as later cards arrive. The response includes the finished dashboard summary, so do not call inspect_dashboard afterward. A brand-new generated image remains one separate add_generated_illustration_card call so Tessera can audit its pixels; approved built-in illustrations can be included here.",
        inputSchema: {
          type: "object",
          properties: {
            operations: {
              type: "array",
              description:
                "Ordered dashboard mutations. Arguments must exactly match the separately registered tool schema for that operation.",
              minItems: 1,
              maxItems: 12,
              items: {
                type: "object",
                properties: {
                  toolName: {
                    type: "string",
                    description: "Existing dashboard operation to run",
                    enum: [...FAST_DASHBOARD_BUILD_OPERATIONS],
                  },
                  arguments: {
                    type: "object",
                    description:
                      "Arguments for the selected operation; omit dashboardId after create_dashboard to target the active dashboard",
                    additionalProperties: true,
                  },
                },
                required: ["toolName", "arguments"],
                additionalProperties: false,
              },
            },
          },
          required: ["operations"],
          additionalProperties: false,
        },
        readOnly: false,
        execute: async (args, source) => {
          const operations = args.operations as Array<{
            toolName: (typeof FAST_DASHBOARD_BUILD_OPERATIONS)[number];
            arguments: Record<string, unknown>;
          }>;
          const prepared = operations.map((operation, index) => {
            const definition = this.#definitions.find(
              (candidate) => candidate.name === operation.toolName,
            );
            if (!definition)
              throw new TypeError(
                `input.operations[${index}].toolName is unavailable.`,
              );
            const normalizedArguments = normalizeFastDashboardArguments(
              operation.toolName,
              operation.arguments,
            );
            validateInput(definition.inputSchema, normalizedArguments);
            return {
              ...operation,
              arguments: normalizedArguments,
              definition,
            };
          });
          const started = performance.now();
          const historyGroup = `fast-dashboard-${crypto.randomUUID()}`;
          const results: Array<Record<string, unknown>> = [];
          const stateBeforeBuild = this.#context.getState();
          for (const [index, operation] of prepared.entries()) {
            let value: unknown;
            try {
              value = await this.execute(
                operation.toolName,
                operation.arguments,
                source,
                { historyGroup },
              );
            } catch (error) {
              // The build is all-or-nothing: roll back every earlier step so
              // the agent can correct the plan and resend it in one piece.
              this.#context.setState(() => stateBeforeBuild);
              const message =
                error instanceof Error ? error.message : String(error);
              throw new Error(
                `build_dashboard_fast stopped at operation ${index + 1} (${operation.toolName}): ${message} No changes were kept.`,
              );
            }
            results.push(summarizeFastBuildResult(operation.toolName, value));
            await waitForFastDashboardReveal(
              operation.toolName,
              index < prepared.length - 1,
              this.#context.revealDashboardStep,
            );
          }
          const project = activeProject(this.#context.getState());
          const dashboard = requiredDashboard(
            project,
            project.activeDashboardId,
          );
          return {
            operationCount: prepared.length,
            elapsedMs: Number((performance.now() - started).toFixed(1)),
            results,
            layoutWarnings: layoutWarnings(dashboard.blocks),
            dashboard: {
              id: dashboard.id,
              name: dashboard.name,
              blockCount: dashboard.blocks.length,
              blocks: dashboard.blocks.map((block, index) => ({
                index,
                id: block.id,
                type: block.type,
                title: block.title,
                buildState: block.buildState,
                layout: block.layout,
              })),
            },
          };
        },
      },
      {
        name: "get_tile_placeholders",
        title: "Inspect tile placeholders",
        description:
          "Return every unfinished tile on a dashboard with the placeholderId to pass unchanged into a type-specific add tool, plus its requested tile type, plain-language brief, mode, and preserved layout. Call this when the user asks you to find or build the placeholders they added.",
        inputSchema: objectSchema({
          dashboardId: stringProp("Dashboard ID; defaults to active"),
        }),
        readOnly: true,
        execute: (args) => {
          const project = activeProject(this.#context.getState());
          const dashboard = requiredDashboard(
            project,
            String(args.dashboardId ?? project.activeDashboardId),
          );
          return {
            dashboard: { id: dashboard.id, name: dashboard.name },
            placeholders: dashboard.blocks
              .filter((block) => block.buildState === "placeholder")
              .map((block) => ({
                placeholderId: block.id,
                blockId: block.id,
                requestedType: block.type,
                label: block.title,
                intent: block.intent,
                mode: block.buildMode,
                layout: block.layout,
              })),
          };
        },
      },
      {
        name: "add_tile_placeholder",
        title: "Add tile placeholder",
        description:
          "Add an unfinished tile that preserves a requested type, layout, and optional plain-language brief. It can later be fulfilled in place by any type-specific add tool using placeholderId.",
        inputSchema: objectSchema(
          {
            dashboardId: stringProp("Dashboard ID; defaults to active"),
            type: enumProp("Requested tile type", [...BLOCK_TYPES]),
            intent: stringProp("Optional plain-language brief"),
            mode: enumProp("Setup path", ["agent", "manual"]),
            width: enumProp(
              "Preferred grid width when snapping beside the preceding tool-added card. A card that starts a new row expands to the full 12 columns.",
              [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
            ),
          },
          ["type"],
        ),
        readOnly: false,
        execute: (args, source) => {
          let result;
          this.updateActiveProject(
            "add_tile_placeholder",
            source,
            `Added ${String(args.type)} placeholder`,
            (project) => {
              const dashboard = requiredDashboard(
                project,
                String(args.dashboardId ?? project.activeDashboardId),
              );
              const block = createBlock(
                args.type as BlockType,
                {
                  buildState: "placeholder",
                  buildMode: args.mode === "manual" ? "manual" : "agent",
                  intent: String(args.intent ?? ""),
                  datasetId: undefined,
                  categoryField: undefined,
                  labelField: undefined,
                  seriesField: undefined,
                  targetField: undefined,
                  valueField: undefined,
                  valueFields: [],
                },
                source,
              );
              recolorBlock(block, KITS[DEFAULT_KIT_ID], kitFor(dashboard));
              if (args.width)
                block.layout.width = Number(
                  args.width,
                ) as DashboardBlock["layout"]["width"];
              if (source === "webmcp")
                appendWebMCPBlock(dashboard.blocks, block, block.layout.width);
              else dashboard.blocks.push(block);
              dashboard.updatedAt = block.updatedAt;
              result = block;
            },
          );
          return result;
        },
      },
      {
        name: "update_tile_placeholder",
        title: "Update tile placeholder",
        description:
          "Change only the plain-language brief or setup mode on an unfinished tile without disturbing its type, position, or size.",
        inputSchema: objectSchema(
          {
            blockId: stringProp("Placeholder block ID"),
            intent: stringProp("Plain-language brief"),
            mode: enumProp("Setup path", ["agent", "manual"]),
          },
          ["blockId"],
        ),
        readOnly: false,
        execute: (args, source) => {
          let result;
          this.updateActiveProject(
            "update_tile_placeholder",
            source,
            "Updated tile placeholder",
            (project) => {
              const found = findBlock(project, String(args.blockId));
              if (found.block.buildState !== "placeholder")
                throw new Error("That block is already complete.");
              if (args.intent !== undefined)
                found.block.intent = String(args.intent).trim();
              if (args.mode !== undefined)
                found.block.buildMode = args.mode as "agent" | "manual";
              found.block.updatedAt = new Date().toISOString();
              found.dashboard.updatedAt = found.block.updatedAt;
              result = found.block;
            },
          );
          return result;
        },
      },
      {
        name: "complete_tile_placeholder",
        title: "Finish manually configured tile",
        description:
          "Mark one manually configured placeholder ready after validating that its required content or clean-data bindings are present. An agent should normally fulfill a placeholder through the appropriate type-specific add tool with placeholderId instead.",
        inputSchema: objectSchema(
          { blockId: stringProp("Placeholder block ID") },
          ["blockId"],
        ),
        readOnly: false,
        execute: (args, source) => {
          let result;
          this.updateActiveProject(
            "complete_tile_placeholder",
            source,
            "Completed tile placeholder manually",
            (project) => {
              const found = findBlock(project, String(args.blockId));
              if (found.block.buildState !== "placeholder")
                throw new Error("That block is already complete.");
              validatePlaceholderCompletion(project, found.block);
              found.block.buildState = "ready";
              found.block.buildMode = "manual";
              found.block.updatedAt = new Date().toISOString();
              found.dashboard.updatedAt = found.block.updatedAt;
              result = found.block;
            },
          );
          return result;
        },
      },
      {
        name: "create_dataset",
        title: "Create warehouse dataset",
        description:
          "Create a logical dataset in the active dashboard group's private Data Warehouse. Monthly source snapshots are added separately.",
        inputSchema: objectSchema(
          {
            name: stringProp("Dataset name"),
            description: stringProp("Dataset purpose or grain"),
          },
          ["name"],
        ),
        readOnly: false,
        execute: (args, source) => {
          const now = new Date().toISOString();
          const asset: DataAsset = {
            id: crypto.randomUUID(),
            name: String(args.name),
            description: String(args.description ?? ""),
            createdAt: now,
            updatedAt: now,
            recipe: {
              id: crypto.randomUUID(),
              name: `${String(args.name)} cleaning recipe`,
              headerMap: {},
              notes: [],
              updatedAt: now,
            },
            months: [],
          };
          this.updateActiveProject(
            "create_dataset",
            source,
            `Created dataset ${asset.name}`,
            (project) => {
              project.warehouse.push(asset);
            },
          );
          return asset;
        },
      },
      {
        name: "delete_dataset",
        title: "Delete warehouse dataset",
        description:
          "Human-only safety gate. Delete one dataset and all of its monthly tables while leaving dashboard cards in place with their data bindings cleared.",
        inputSchema: objectSchema(
          { datasetId: stringProp("Dataset ID to delete") },
          ["datasetId"],
        ),
        readOnly: false,
        execute: (args, source) => {
          if (source === "webmcp")
            throw new Error("Datasets must be deleted by the user in Tessera.");
          const datasetId = String(args.datasetId);
          const currentProject = activeProject(this.#context.getState());
          const target = requiredAsset(currentProject, datasetId);
          const monthCount = target.months.length;
          let result;

          this.updateActiveProject(
            "delete_dataset",
            source,
            `Deleted dataset ${target.name}`,
            (project) => {
              project.warehouse = project.warehouse.filter(
                (candidate) => candidate.id !== datasetId,
              );
              const now = new Date().toISOString();
              let disconnectedBlockCount = 0;
              project.dashboards.forEach((dashboard) => {
                let dashboardChanged = false;
                dashboard.blocks.forEach((block) => {
                  if (block.datasetId !== datasetId) return;
                  clearDatasetBinding(block, now);
                  dashboardChanged = true;
                  disconnectedBlockCount += 1;
                });
                if (dashboardChanged) dashboard.updatedAt = now;
              });
              result = {
                datasetId,
                name: target.name,
                removedMonthCount: monthCount,
                disconnectedBlockCount,
              };
            },
          );
          return result;
        },
      },
      {
        name: "update_dataset_recipe",
        title: "Edit dataset cleaning recipe",
        description:
          "Replace the saved cleaning recipe for one dataset: its name, the complete source-header to canonical-field map that is reapplied to every new month, and its notes. Omitted keys in headerMap are removed, so send the full map.",
        inputSchema: objectSchema(
          {
            datasetId: stringProp("Dataset ID"),
            name: stringProp("Recipe name"),
            headerMap: {
              type: "object",
              description:
                'Complete original-header to canonical-field map, for example { "Rev ($000)": "Revenue" }',
              additionalProperties: { type: "string" },
            },
            notes: arrayProp(
              "Cleaning notes shown beside the recipe",
              stringProp("Note"),
            ),
          },
          ["datasetId"],
        ),
        readOnly: false,
        execute: (args, source) => {
          let result;
          this.updateActiveProject(
            "update_dataset_recipe",
            source,
            "Updated cleaning recipe",
            (project) => {
              const asset = requiredAsset(project, String(args.datasetId));
              const now = new Date().toISOString();
              if (args.name !== undefined)
                asset.recipe.name =
                  String(args.name).trim() || asset.recipe.name;
              if (args.headerMap !== undefined) {
                const map = plainObject(args.headerMap, "input.headerMap");
                asset.recipe.headerMap = Object.fromEntries(
                  Object.entries(map)
                    .map(([from, to]) => [from.trim(), String(to).trim()])
                    .filter(([from, to]) => from && to),
                );
              }
              if (args.notes !== undefined)
                asset.recipe.notes = (args.notes as unknown[])
                  .map(String)
                  .filter(Boolean);
              asset.recipe.updatedAt = now;
              asset.updatedAt = now;
              result = { datasetId: asset.id, recipe: asset.recipe };
            },
          );
          return result;
        },
      },
      {
        name: "save_dataset_month_upload",
        title: "Save immutable monthly upload",
        description:
          "Persist a raw workbook as a pending monthly source. This creates no cleaned fields and makes nothing available to dashboards.",
        inputSchema: objectSchema(
          {
            datasetId: stringProp("Logical dataset ID"),
            period: stringProp(
              "Month in YYYY-MM format",
              "^\\d{4}-(0[1-9]|1[0-2])$",
            ),
            label: stringProp("Human-readable month label"),
            sourceName: stringProp("Uploaded source file name"),
            original: tableProp(
              "Raw tabular fallback retained alongside the workbook",
            ),
            workbook: sourceWorkbookProp(),
          },
          ["datasetId", "period", "original", "workbook"],
        ),
        readOnly: false,
        execute: (args, source) => {
          const now = new Date().toISOString();
          const workbook = normalizeSourceWorkbook(
            args.workbook as SourceWorkbook,
            String(args.sourceName ?? "Uploaded source"),
          );
          const month: DatasetMonth = {
            id: crypto.randomUUID(),
            period: String(args.period),
            label: String(args.label ?? periodLabel(String(args.period))),
            sourceName: String(args.sourceName ?? workbook.fileName),
            importedAt: now,
            status: "pending",
            original: args.original as DataTable,
            cleaned: { columns: [], rows: [] },
            cleaningSummary: [],
            sourceWorkbook: workbook,
            sourceWorksheet: workbook.sheets[0],
            processing: initialMonthProcessing(now),
          };
          this.updateActiveProject(
            "save_dataset_month_upload",
            source,
            `Saved raw ${month.label} upload`,
            (project) => {
              const asset = requiredAsset(project, String(args.datasetId));
              if (
                asset.months.some(
                  (candidate) => candidate.period === month.period,
                )
              )
                throw new Error(
                  "That month already exists. Keep it and add a corrected revision instead of overwriting it.",
                );
              asset.months.push(month);
              asset.months.sort((a, b) => a.period.localeCompare(b.period));
              asset.updatedAt = now;
            },
          );
          return {
            datasetId: String(args.datasetId),
            period: month.period,
            status: month.status,
            stage: month.processing!.stage,
            sourceName: month.sourceName,
            sheets: workbook.sheets.map((sheet) => ({
              name: sheet.name,
              rows: sheet.rowCount,
              columns: sheet.columnCount,
            })),
          };
        },
      },
      {
        name: "start_dataset_month_processing",
        title: "Start visible monthly processing",
        description:
          "Begin the visible outlining and variable-matching phase for a pending upload. Call this before inspecting and proposing table regions so Tessera can show live progress.",
        inputSchema: objectSchema(
          {
            datasetId: stringProp("Dataset ID"),
            period: stringProp("Month in YYYY-MM format"),
          },
          ["datasetId", "period"],
        ),
        readOnly: false,
        execute: (args, source) => {
          let result;
          this.updateActiveProject(
            "start_dataset_month_processing",
            source,
            `Started ${String(args.period)} source processing`,
            (project) => {
              const asset = requiredAsset(project, String(args.datasetId));
              const month = requiredMonth(asset, args.period);
              if (month.status !== "pending")
                throw new Error("Only pending uploads need processing.");
              const processing = ensureMonthProcessing(month);
              processing.stage = "outlining";
              processing.progress = Math.max(processing.progress, 15);
              processing.message =
                "Reading workbook structure and matching prior chart variables";
              processing.startedAt ??= new Date().toISOString();
              processing.updatedAt = new Date().toISOString();
              result = processingSnapshot(asset, month, project);
            },
          );
          return result;
        },
      },
      {
        name: "inspect_dataset_month_source",
        title: "Inspect raw month and prior variables",
        description:
          "Read a pending workbook, the last approved canonical schema, fields currently powering charts, saved mappings, prior clarification answers, and processing state. Use this before proposing outlines or a clean draft.",
        inputSchema: objectSchema(
          {
            datasetId: stringProp("Dataset ID"),
            period: stringProp("Month in YYYY-MM format"),
          },
          ["datasetId", "period"],
        ),
        readOnly: true,
        execute: (args) => {
          const project = activeProject(this.#context.getState());
          const asset = requiredAsset(project, String(args.datasetId));
          const month = requiredMonth(asset, args.period);
          return processingSnapshot(asset, month, project, true);
        },
      },
      {
        name: "propose_dataset_month_outline",
        title: "Draw table outlines and match variables",
        description:
          "Persist labelled outlines and source-to-canonical variables for a pending workbook. Outline every region the sheet contains: the table that feeds this dataset (kind table, confidence 1), any secondary tables (kind table, lower confidence), and the titles, notes, and footers people should see were deliberately skipped (kind narrative or footnote). Every region is drawn and labelled on the worksheet with its name. Prioritize exact fields already used by charts. Put every uncertain semantic choice into questions so Tessera can ask the user instead of guessing.",
        inputSchema: objectSchema(
          {
            datasetId: stringProp("Dataset ID"),
            period: stringProp("Month in YYYY-MM format"),
            regions: arrayProp(
              "Every labelled region in the workbook; at least one must be kind table",
              worksheetRegionProp(),
            ),
            variableMappings: arrayProp(
              "Source variables matched to stable canonical variables",
              datasetVariableMappingProp(),
            ),
            questions: arrayProp(
              "Ambiguous choices that require a user answer",
              datasetCleaningQuestionProp(),
            ),
          },
          ["datasetId", "period", "regions", "variableMappings"],
        ),
        readOnly: false,
        execute: (args, source) => {
          let result;
          this.updateActiveProject(
            "propose_dataset_month_outline",
            source,
            `Outlined and matched ${String(args.period)}`,
            (project) => {
              const asset = requiredAsset(project, String(args.datasetId));
              const month = requiredMonth(asset, args.period);
              if (month.status !== "pending")
                throw new Error("Approved sources cannot be re-outlined.");
              const regions = (args.regions as Array<WorksheetRegion>).map(
                normalizeWorksheetRegion,
              );
              if (!regions.some((region) => region.kind === "table"))
                throw new Error(
                  "At least one region of kind table is required; it is the table that feeds this dataset.",
                );
              applyRegionsToMonthSource(month, regions);
              const processing = ensureMonthProcessing(month);
              processing.variableMappings = (
                args.variableMappings as DatasetVariableMapping[]
              ).map(normalizeVariableMapping);
              processing.questions = Array.isArray(args.questions)
                ? (args.questions as DatasetCleaningQuestion[]).map(
                    normalizeCleaningQuestion,
                  )
                : [];
              const unanswered = processing.questions.filter(
                (question) => !question.answerChoiceId,
              );
              processing.stage = unanswered.length ? "needs_input" : "outlined";
              processing.progress = unanswered.length ? 58 : 68;
              processing.message = unanswered.length
                ? `${unanswered.length} decision${unanswered.length === 1 ? "" : "s"} need your input`
                : "Tables outlined and chart variables matched";
              processing.updatedAt = new Date().toISOString();
              result = processingSnapshot(asset, month, project);
            },
          );
          return result;
        },
      },
      {
        name: "answer_dataset_month_questions",
        title: "Submit cleaning decisions",
        description:
          "Save the user's answers to every clarification question for a pending month. This is a human confirmation step and cannot be completed by WebMCP.",
        inputSchema: objectSchema(
          {
            datasetId: stringProp("Dataset ID"),
            period: stringProp("Month in YYYY-MM format"),
            answers: arrayProp(
              "One selected choice for each question",
              objectSchema(
                {
                  questionId: stringProp("Question ID"),
                  choiceId: stringProp("Selected choice ID"),
                },
                ["questionId", "choiceId"],
              ),
            ),
          },
          ["datasetId", "period", "answers"],
        ),
        readOnly: false,
        execute: (args, source) => {
          if (source === "webmcp")
            throw new Error(
              "Cleaning questions must be answered by the user in Tessera.",
            );
          let result;
          this.updateActiveProject(
            "answer_dataset_month_questions",
            source,
            `Confirmed ${String(args.period)} cleaning decisions`,
            (project) => {
              const asset = requiredAsset(project, String(args.datasetId));
              const month = requiredMonth(asset, args.period);
              const processing = ensureMonthProcessing(month);
              const answers = args.answers as Array<{
                questionId: string;
                choiceId: string;
              }>;
              answers.forEach((answer) => {
                const question = processing.questions.find(
                  (candidate) => candidate.id === answer.questionId,
                );
                if (!question)
                  throw new Error(`Unknown question: ${answer.questionId}.`);
                if (
                  !question.choices.some(
                    (choice) => choice.id === answer.choiceId,
                  )
                )
                  throw new Error(
                    `Unknown choice for ${question.prompt}: ${answer.choiceId}.`,
                  );
                question.answerChoiceId = answer.choiceId;
              });
              const unanswered = processing.questions.filter(
                (question) => !question.answerChoiceId,
              );
              processing.stage = unanswered.length ? "needs_input" : "outlined";
              processing.progress = unanswered.length ? 60 : 70;
              processing.message = unanswered.length
                ? `${unanswered.length} decision${unanswered.length === 1 ? "" : "s"} still need your input`
                : "Your choices are saved; your agent can continue cleaning";
              processing.updatedAt = new Date().toISOString();
              result = processingSnapshot(asset, month, project);
            },
          );
          return result;
        },
      },
      {
        name: "create_dataset_month_cleaning_draft",
        title: "Create reviewable clean-month draft",
        description:
          "Create a separate cleaned-table draft from the confirmed outlines, prior canonical variables, saved recipe, and user answers. The result remains blocked from dashboards until the user approves it in Tessera.",
        inputSchema: objectSchema(
          {
            datasetId: stringProp("Dataset ID"),
            period: stringProp("Month in YYYY-MM format"),
            cleaned: tableProp(
              "Optional agent-prepared canonical table after semantic reshaping",
            ),
            cleaningSummary: arrayProp(
              "Cleaning and reconciliation decisions",
              stringProp("Decision"),
            ),
          },
          ["datasetId", "period"],
        ),
        readOnly: false,
        execute: (args, source) => {
          let result;
          this.updateActiveProject(
            "create_dataset_month_cleaning_draft",
            source,
            `Created ${String(args.period)} cleaning draft`,
            (project) => {
              const asset = requiredAsset(project, String(args.datasetId));
              const month = requiredMonth(asset, args.period);
              if (month.status !== "pending")
                throw new Error("That month is already approved.");
              const processing = ensureMonthProcessing(month);
              const unanswered = processing.questions.filter(
                (question) => !question.answerChoiceId,
              );
              if (unanswered.length)
                throw new Error(
                  `${unanswered.length} clarification decision${unanswered.length === 1 ? "" : "s"} must be answered first.`,
                );
              processing.stage = "cleaning";
              processing.progress = Math.max(processing.progress, 76);
              processing.message =
                "Applying confirmed mappings and checking the prior schema";
              const prior = latestReadyMonthBefore(asset, month.period);
              const mappingRecipe = {
                ...asset.recipe.headerMap,
                ...Object.fromEntries(
                  processing.variableMappings.map((mapping) => [
                    mapping.source,
                    mapping.canonical,
                  ]),
                ),
              };
              const sourceTable = tableFromConfirmedMonthRegion(month);
              const safe = cleanWithRecipe(
                sourceTable,
                mappingRecipe,
                prior?.cleaned.columns,
                month.period,
              );
              const prepared = args.cleaned
                ? (args.cleaned as DataTable)
                : safe.table;
              if (!prepared.columns.length || !prepared.rows.length)
                throw new Error(
                  "The cleaning draft must contain fields and publishable rows.",
                );
              const schema = schemaCompatibility(
                prior?.cleaned.columns ?? [],
                prepared.columns,
              );
              const profile = profileTable(prepared);
              processing.qualityChecks = qualityChecksForDraft(
                prior?.cleaned,
                prepared,
                schema,
                profile,
              );
              processing.stage = "review";
              processing.progress = 92;
              processing.message =
                "Clean draft ready for your final review and approval";
              processing.updatedAt = new Date().toISOString();
              month.cleaned = prepared;
              const suppliedSummary = Array.isArray(args.cleaningSummary)
                ? args.cleaningSummary.map(String)
                : [];
              month.cleaningSummary = suppliedSummary.length
                ? suppliedSummary
                : [
                    ...safe.summary,
                    `${processing.variableMappings.length} variable mapping${processing.variableMappings.length === 1 ? "" : "s"} confirmed against prior months`,
                    ...(processing.questions.length
                      ? [
                          `${processing.questions.length} user decision${processing.questions.length === 1 ? "" : "s"} applied`,
                        ]
                      : []),
                  ];
              result = processingSnapshot(asset, month, project);
            },
          );
          return result;
        },
      },
      {
        name: "approve_dataset_month",
        title: "Approve clean month for dashboards",
        description:
          "Human-only publication gate. Approve a reviewed clean draft and make that exact monthly version available to dashboard bindings.",
        inputSchema: objectSchema(
          {
            datasetId: stringProp("Dataset ID"),
            period: stringProp("Month in YYYY-MM format"),
          },
          ["datasetId", "period"],
        ),
        readOnly: false,
        execute: (args, source) => {
          if (source === "webmcp")
            throw new Error(
              "Only the user can approve a clean month for dashboards.",
            );
          let result;
          this.updateActiveProject(
            "approve_dataset_month",
            source,
            `Approved ${String(args.period)} clean month`,
            (project) => {
              const asset = requiredAsset(project, String(args.datasetId));
              const month = requiredMonth(asset, args.period);
              const processing = ensureMonthProcessing(month);
              if (processing.stage !== "review")
                throw new Error("Create and review a cleaning draft first.");
              const failures = processing.qualityChecks.filter(
                (check) => check.status === "fail",
              );
              if (failures.length)
                throw new Error(
                  `Approval blocked: ${failures.map((check) => check.label).join(", ")}.`,
                );
              if (!month.cleaned.columns.length || !month.cleaned.rows.length)
                throw new Error("The clean draft is empty.");
              const now = new Date().toISOString();
              month.status = "ready";
              processing.stage = "approved";
              processing.progress = 100;
              processing.message =
                "Approved and available to new dashboard editions";
              processing.updatedAt = now;
              processing.variableMappings.forEach(
                (mapping) => (mapping.confirmed = true),
              );
              asset.recipe.headerMap = {
                ...asset.recipe.headerMap,
                ...Object.fromEntries(
                  processing.variableMappings.map((mapping) => [
                    mapping.source,
                    mapping.canonical,
                  ]),
                ),
              };
              asset.recipe.notes = [...month.cleaningSummary];
              asset.recipe.updatedAt = now;
              asset.updatedAt = now;
              result = processingSnapshot(asset, month, project);
            },
          );
          return result;
        },
      },
      {
        name: "get_monthly_refresh_status",
        title: "Inspect reporting-month readiness",
        description:
          "Return every dataset's upload, outline, clarification, clean-draft, and approval status for one reporting month, plus whether a new dashboard edition may be created.",
        inputSchema: objectSchema(
          { period: stringProp("Reporting month in YYYY-MM format") },
          ["period"],
        ),
        readOnly: true,
        execute: (args) => {
          const project = activeProject(this.#context.getState());
          return monthlyRefreshStatus(project, String(args.period));
        },
      },
      {
        name: "update_cleaned_table",
        title: "Edit cleaned monthly table",
        description:
          "Edit the cleaned draft for one pending dataset month, for a narrow reviewed correction. Approved months are locked for agents, and every draft stays blocked from dashboards until the user approves it.",
        inputSchema: objectSchema(
          {
            datasetId: stringProp("Dataset ID"),
            period: stringProp("Month in YYYY-MM format"),
            table: tableProp("Updated cleaned table"),
          },
          ["datasetId", "period", "table"],
        ),
        readOnly: false,
        execute: (args, source) => {
          this.updateActiveProject(
            "update_cleaned_table",
            source,
            "Updated cleaned table",
            (project) => {
              const asset = requiredAsset(project, String(args.datasetId));
              const month = asset.months.find(
                (candidate) => candidate.period === String(args.period),
              );
              if (!month) throw new Error("Dataset month not found.");
              if (source === "webmcp" && month.status !== "pending")
                throw new Error(
                  "Approved months are locked for agents. Ask the user to edit the cleaned table in Tessera.",
                );
              const table = args.table as DataTable;
              if (!table.columns.length || !table.rows.length)
                throw new Error("The cleaned table cannot be empty.");
              month.cleaned = table;
              const now = new Date().toISOString();
              if (month.status === "pending") {
                const prior = latestReadyMonthBefore(asset, month.period);
                const schema = schemaCompatibility(
                  prior?.cleaned.columns ?? [],
                  table.columns,
                );
                const processing = ensureMonthProcessing(month);
                processing.stage = "review";
                processing.progress = 92;
                processing.message =
                  "Edited clean draft ready for final approval";
                processing.qualityChecks = qualityChecksForDraft(
                  prior?.cleaned,
                  table,
                  schema,
                  profileTable(table),
                );
                processing.updatedAt = now;
              }
              asset.updatedAt = now;
            },
          );
          return { updated: true };
        },
      },
      {
        name: "analyze_table",
        title: "Analyze uploaded table",
        description:
          "Profile an uploaded or pasted table before publishing it: field types, missing values, duplicates, empty structure, examples, completeness, and review items.",
        inputSchema: objectSchema({ table: tableProp("Table to analyze") }, [
          "table",
        ]),
        readOnly: true,
        execute: (args) => profileTable(args.table as DataTable),
      },
      {
        name: "analyze_dataset",
        title: "Analyze warehouse dataset",
        description:
          "Profile an original or cleaned monthly warehouse table and return its saved cleaning decisions and field mappings.",
        inputSchema: objectSchema(
          {
            datasetId: stringProp("Dataset ID"),
            period: stringProp("Month in YYYY-MM format; defaults to latest"),
            version: enumProp("Table version", ["original", "cleaned"]),
          },
          ["datasetId"],
        ),
        readOnly: true,
        execute: (args) => {
          const project = activeProject(this.#context.getState());
          const asset = requiredAsset(project, String(args.datasetId));
          const month = requiredMonth(asset, args.period);
          const version = args.version === "original" ? "original" : "cleaned";
          return {
            dataset: { id: asset.id, name: asset.name },
            period: month.period,
            version,
            profile: profileTable(month[version]),
            cleaningSummary: month.cleaningSummary,
            headerMap: asset.recipe.headerMap,
          };
        },
      },
      {
        name: "clean_dataset_month",
        title: "Clean warehouse dataset month",
        description:
          "Create a reviewable clean draft from an immutable original using deterministic safe cleaning and the saved header recipe. This never approves the month for dashboards.",
        inputSchema: objectSchema(
          {
            datasetId: stringProp("Dataset ID"),
            period: stringProp("Month in YYYY-MM format"),
            useRecipe: booleanProp("Apply saved field mappings"),
          },
          ["datasetId", "period"],
        ),
        readOnly: false,
        execute: (args, source) => {
          let result;
          this.updateActiveProject(
            "clean_dataset_month",
            source,
            `Analyzed and cleaned ${String(args.period)}`,
            (project) => {
              const asset = requiredAsset(project, String(args.datasetId));
              const month = requiredMonth(asset, args.period);
              if (month.status !== "pending")
                throw new Error("That month is already approved.");
              const prior = latestReadyMonthBefore(asset, month.period);
              const cleaned = cleanWithRecipe(
                tableFromConfirmedMonthRegion(month),
                args.useRecipe === false ? {} : asset.recipe.headerMap,
                prior?.cleaned.columns,
                month.period,
              );
              const schema = schemaCompatibility(
                prior?.cleaned.columns ?? [],
                cleaned.table.columns,
              );
              month.cleaned = cleaned.table;
              month.cleaningSummary = cleaned.summary;
              const processing = ensureMonthProcessing(month);
              const critical = chartCriticalFields(project, asset.id);
              processing.variableMappings = Object.entries(
                cleaned.headerMap,
              ).map(([sourceField, canonical]) => {
                const fromRecipe =
                  asset.recipe.headerMap[sourceField] === canonical;
                return {
                  source: sourceField,
                  canonical,
                  confidence: fromRecipe ? 1 : 0.7,
                  ...(fromRecipe ? { matchedFromPrevious: canonical } : {}),
                  ...(critical.includes(canonical)
                    ? { usedByCharts: true }
                    : {}),
                };
              });
              processing.stage = "review";
              processing.progress = 92;
              processing.message =
                "Safe clean draft ready for final review and approval";
              processing.qualityChecks = qualityChecksForDraft(
                prior?.cleaned,
                cleaned.table,
                schema,
                profileTable(cleaned.table),
              );
              processing.updatedAt = new Date().toISOString();
              asset.updatedAt = processing.updatedAt;
              result = {
                datasetId: asset.id,
                period: month.period,
                profile: profileTable(month.cleaned),
                cleaningSummary: month.cleaningSummary,
                headerMap: cleaned.headerMap,
                status: "pending_user_approval",
                qualityChecks: processing.qualityChecks,
              };
            },
          );
          return result;
        },
      },
      {
        name: "update_block",
        title: "Edit dashboard block",
        description:
          "Update content, binding, appearance, or layout on an existing block. Patches are narrow and merged. For one table column or cell, prefer style_table_column or style_table_cell so other overrides are preserved. To recolor only one gauge element, send patch.gauge.colors.value, track, target, or needle without resending the rest of the gauge. Human and WebMCP edits use this same command.",
        inputSchema: objectSchema(
          {
            dashboardId: stringProp("Dashboard ID; defaults to active"),
            blockId: stringProp("Block ID"),
            patch: dashboardBlockPatchProp(),
          },
          ["blockId", "patch"],
        ),
        readOnly: false,
        execute: (args, source) => {
          let result;
          this.updateActiveProject(
            "update_block",
            source,
            "Updated block",
            (project) => {
              const dashboard = requiredDashboard(
                project,
                String(args.dashboardId ?? project.activeDashboardId),
              );
              const block = requiredBlock(
                dashboard.blocks,
                String(args.blockId),
              );
              const patch = validateDashboardBlockPatch(args.patch);
              if (patch.chart)
                validateChartPatchForType(block.type, patch.chart);
              if (block.type === "scatter" && patch.chart)
                validateScatterBounds({ ...block.chart, ...patch.chart });
              Object.assign(block, patch, {
                style: patch.style
                  ? { ...block.style, ...patch.style }
                  : block.style,
                chart: patch.chart
                  ? { ...block.chart, ...patch.chart }
                  : block.chart,
                gauge: patch.gauge
                  ? {
                      ...(block.gauge ?? defaultGaugeSettings()),
                      ...patch.gauge,
                      colors: patch.gauge.colors
                        ? {
                            ...(block.gauge?.colors ??
                              defaultGaugeSettings().colors),
                            ...patch.gauge.colors,
                          }
                        : (block.gauge?.colors ??
                          defaultGaugeSettings().colors),
                    }
                  : (block.gauge ?? defaultGaugeSettings()),
                table: patch.table
                  ? { ...block.table, ...patch.table }
                  : block.table,
                kpi: patch.kpi ? { ...block.kpi, ...patch.kpi } : block.kpi,
                illustration: patch.illustration
                  ? {
                      ...(block.illustration ?? defaultIllustrationSettings()),
                      ...patch.illustration,
                    }
                  : (block.illustration ?? defaultIllustrationSettings()),
                layout: patch.layout
                  ? { ...block.layout, ...patch.layout }
                  : block.layout,
                updatedAt: new Date().toISOString(),
              });
              if (
                patch.illustration?.preset !== undefined &&
                patch.illustration.preset !== "custom"
              ) {
                block.illustration.bitmapMask = null;
                block.illustration.libraryAssetId = "";
              }
              if (block.type === "gauge") validateGaugeSettings(block.gauge);
              if (block.type === "table") {
                validateTablePatch(block.table);
                validateBoundTableConfiguration(project, block);
              }
              if (block.type === "line") validateLineChartConfiguration(block);
              if (block.type === "illustration")
                validateIllustrationSettings(block.illustration);
              // A placeholder is configured one field at a time by hand;
              // complete_tile_placeholder validates the whole binding at the
              // end, so a half-bound placeholder is allowed here.
              if (
                block.buildState !== "placeholder" &&
                [
                  "datasetId",
                  "period",
                  "categoryField",
                  "targetField",
                  "valueField",
                  "valueFields",
                  "labelField",
                  "seriesField",
                ].some((key) => key in patch)
              ) {
                validateBlockBinding(project, block);
                if (block.type === "kpi") validateKpiBinding(project, block);
              }
              dashboard.updatedAt = block.updatedAt;
              result = block;
            },
          );
          return result;
        },
      },
      {
        name: "style_bar",
        title: "Style one bar",
        description:
          "Change or reset the color of one exact category in a vertical, horizontal, or grouped bar chart without replacing the chart palette or any other override. For grouped bars, provide series to target only that category/series intersection; omit series to recolor the category across every series.",
        inputSchema: objectSchema(
          {
            dashboardId: stringProp("Dashboard ID; defaults to active"),
            blockId: stringProp("Bar, horizontal-bar, or grouped-bar block ID"),
            category: stringProp(
              "Exact rendered category label, matched case-sensitively",
              ".*\\S.*",
            ),
            series: stringProp(
              "Optional exact value field for one grouped bar; omit to target the category across all series",
              ".*\\S.*",
            ),
            color: stringProp("New six-digit hex color", "^#[0-9A-Fa-f]{6}$"),
            reset: booleanProp("Remove this target's custom color"),
          },
          ["blockId", "category"],
        ),
        readOnly: false,
        execute: (args, source) => {
          const category = String(args.category ?? "").trim();
          const series =
            args.series === undefined ? undefined : String(args.series).trim();
          if (!category)
            throw new TypeError("category must be a non-empty exact label.");
          if (args.series !== undefined && !series)
            throw new TypeError("series must be non-empty when provided.");
          if (args.reset && args.color !== undefined)
            throw new TypeError("Use color or reset: true, not both.");
          if (!args.reset && args.color === undefined)
            throw new TypeError("Provide color or reset: true.");
          if (args.color !== undefined) hexColor(args.color, "color");
          let result;
          this.updateActiveProject(
            "style_bar",
            source,
            `${args.reset ? "Reset" : "Styled"} bar: ${category}${series ? ` · ${series}` : ""}`,
            (project) => {
              const dashboard = requiredDashboard(
                project,
                String(args.dashboardId ?? project.activeDashboardId),
              );
              const block = requiredBlock(
                dashboard.blocks,
                String(args.blockId),
              );
              if (!["bar", "horizontalBar", "groupedBar"].includes(block.type))
                throw new TypeError(
                  "blockId must identify a vertical, horizontal, or grouped bar chart.",
                );
              const table = tableForBlock(project, block);
              const categoryIndex = table?.columns.indexOf(
                block.categoryField ?? table.columns[0],
              );
              const categories =
                table && categoryIndex !== undefined && categoryIndex >= 0
                  ? [
                      ...new Set(
                        table.rows.map((row) =>
                          String(row[categoryIndex] ?? ""),
                        ),
                      ),
                    ]
                  : [];
              if (categories.length && !categories.includes(category))
                throw new Error(
                  `Category "${category}" was not found in this chart. Available labels: ${categories.slice(0, 30).join(", ")}.`,
                );
              const availableSeries = block.valueFields.length
                ? block.valueFields
                : block.valueField
                  ? [block.valueField]
                  : [];
              if (series && !availableSeries.includes(series))
                throw new Error(
                  `Series "${series}" was not found in this chart. Available series: ${availableSeries.join(", ") || "none"}.`,
                );
              const current = block.chart.barColorOverrides ?? [];
              const matches = (override: (typeof current)[number]) =>
                override.category === category && override.series === series;
              const withoutSelected = current.filter(
                (override) => !matches(override),
              );
              block.chart.barColorOverrides = args.reset
                ? withoutSelected
                : [
                    ...withoutSelected,
                    {
                      category,
                      ...(series ? { series } : {}),
                      color: String(args.color).toLowerCase(),
                    },
                  ];
              block.updatedAt = new Date().toISOString();
              dashboard.updatedAt = block.updatedAt;
              result = block;
            },
          );
          return result;
        },
      },
      {
        name: "style_scatter_point",
        title: "Style one scatter point",
        description:
          "Change or reset one scatter point without replacing the chart palette or any other point override. Select the point by its exact label or by its one-based source row, then provide only the appearance fields to change.",
        inputSchema: objectSchema(
          {
            dashboardId: stringProp("Dashboard ID; defaults to active"),
            blockId: stringProp("Scatter block ID"),
            pointLabel: stringProp(
              "Exact point label from labelField; use rowIndex if labels repeat",
            ),
            rowIndex: numberProp("One-based source row", 1),
            color: stringProp("Point color", "^#[0-9A-Fa-f]{6}$"),
            size: numberProp("Point radius in pixels", 2, 20),
            opacity: numberProp("Point opacity", 0.1, 1),
            shape: enumProp("Point shape", ["circle", "square", "diamond"]),
            reset: booleanProp("Remove this point's custom style"),
          },
          ["blockId"],
        ),
        readOnly: false,
        execute: (args, source) => {
          const pointLabel =
            args.pointLabel === undefined ? undefined : String(args.pointLabel);
          const rowIndex =
            args.rowIndex === undefined ? undefined : Number(args.rowIndex);
          if (!pointLabel && rowIndex === undefined)
            throw new TypeError(
              "Provide pointLabel or rowIndex to select one scatter point.",
            );
          if (pointLabel && rowIndex !== undefined)
            throw new TypeError(
              "Use either pointLabel or rowIndex, not both, so the selection is unambiguous.",
            );
          if (rowIndex !== undefined)
            integerNumber(rowIndex, "rowIndex", 1, Number.MAX_SAFE_INTEGER);
          const appearanceKeys = ["color", "size", "opacity", "shape"];
          if (
            !args.reset &&
            !appearanceKeys.some((key) => args[key] !== undefined)
          )
            throw new TypeError(
              "Provide color, size, opacity, shape, or reset: true.",
            );
          if (
            args.reset &&
            appearanceKeys.some((key) => args[key] !== undefined)
          )
            throw new TypeError(
              "reset: true cannot be combined with appearance fields.",
            );
          if (args.color !== undefined) hexColor(args.color, "color");
          if (args.size !== undefined) finiteNumber(args.size, "size", 2, 20);
          if (args.opacity !== undefined)
            finiteNumber(args.opacity, "opacity", 0.1, 1);
          if (args.shape !== undefined)
            enumValue(args.shape, ["circle", "square", "diamond"], "shape");
          let result;
          this.updateActiveProject(
            "style_scatter_point",
            source,
            `Styled scatter point ${pointLabel ?? `row ${rowIndex}`}`,
            (project) => {
              const dashboard = requiredDashboard(
                project,
                String(args.dashboardId ?? project.activeDashboardId),
              );
              const block = requiredBlock(
                dashboard.blocks,
                String(args.blockId),
              );
              if (block.type !== "scatter")
                throw new TypeError("blockId must identify a scatter chart.");
              const table = tableForBlock(project, block);
              if (!table)
                throw new TypeError("The scatter chart has no data table.");
              if (rowIndex !== undefined && rowIndex > table.rows.length)
                throw new TypeError(
                  `rowIndex ${rowIndex} is outside the ${table.rows.length} source rows.`,
                );
              if (pointLabel !== undefined) {
                if (!block.labelField)
                  throw new TypeError(
                    "Set labelField on the scatter chart before selecting a point by label.",
                  );
                const labelIndex = table.columns.indexOf(block.labelField);
                if (labelIndex < 0)
                  throw new TypeError(
                    `labelField ${block.labelField} is not present in the selected data.`,
                  );
                const labelMatches = table.rows.filter(
                  (row) => String(row[labelIndex] ?? "") === pointLabel,
                ).length;
                if (labelMatches === 0)
                  throw new TypeError(`No point is labeled ${pointLabel}.`);
                if (labelMatches > 1)
                  throw new TypeError(
                    `${labelMatches} points are labeled ${pointLabel}; use rowIndex instead.`,
                  );
              }
              const current = block.chart.scatterPointStyles ?? [];
              const matches = (style: (typeof current)[number]) =>
                pointLabel !== undefined
                  ? style.label === pointLabel && style.rowIndex === undefined
                  : style.rowIndex === rowIndex && style.label === undefined;
              const existing = current.find(matches);
              const withoutSelected = current.filter(
                (style) => !matches(style),
              );
              block.chart.scatterPointStyles = args.reset
                ? withoutSelected
                : [
                    ...withoutSelected,
                    {
                      ...(pointLabel === undefined
                        ? {}
                        : { label: pointLabel }),
                      ...(rowIndex === undefined ? {} : { rowIndex }),
                      ...existing,
                      ...(args.color === undefined
                        ? {}
                        : { color: String(args.color) }),
                      ...(args.size === undefined
                        ? {}
                        : { size: Number(args.size) }),
                      ...(args.opacity === undefined
                        ? {}
                        : { opacity: Number(args.opacity) }),
                      ...(args.shape === undefined
                        ? {}
                        : {
                            shape: args.shape as
                              "circle" | "square" | "diamond",
                          }),
                    },
                  ];
              block.updatedAt = new Date().toISOString();
              dashboard.updatedAt = block.updatedAt;
              result = block;
            },
          );
          return result;
        },
      },
      {
        name: "style_sankey_element",
        title: "Style one Sankey element",
        description:
          "Make a surgical style change to exactly one node or one source-to-target link in an existing Sankey chart. Existing chart settings and other element overrides are preserved. Use reset true to remove that element's override and restore automatic styling.",
        inputSchema: objectSchema(
          {
            dashboardId: stringProp("Dashboard ID; defaults to active"),
            blockId: stringProp("Sankey block ID"),
            element: enumProp("Element to update", ["node", "link"]),
            node: stringProp("Exact node name; required for a node"),
            source: stringProp("Exact source node name; required for a link"),
            target: stringProp("Exact target node name; required for a link"),
            color: stringProp(
              "Optional six-digit hex color for this element only",
              "^#[0-9A-Fa-f]{6}$",
            ),
            label: stringProp(
              "Optional display label for a node without changing its data identity",
            ),
            opacity: numberProp("Optional opacity for this link only", 0.05, 1),
            highlighted: booleanProp(
              "Emphasize only this node or link; false explicitly removes emphasis",
            ),
            reset: booleanProp(
              "Remove this element's saved override and restore automatic styling",
            ),
          },
          ["blockId", "element"],
        ),
        readOnly: false,
        execute: (args, source) => {
          const element = String(args.element);
          const reset = args.reset === true;
          if (args.color !== undefined) hexColor(args.color, "color");
          if (args.opacity !== undefined)
            finiteNumber(args.opacity, "opacity", 0.05, 1);
          if (args.label !== undefined && typeof args.label !== "string")
            throw new TypeError("label must be a string.");
          if (args.highlighted !== undefined)
            booleanValue(args.highlighted, "highlighted");
          if (args.reset !== undefined) booleanValue(args.reset, "reset");
          if (element === "node" && !String(args.node ?? "").trim())
            throw new Error("node is required when element is node.");
          if (
            element === "link" &&
            (!String(args.source ?? "").trim() ||
              !String(args.target ?? "").trim())
          )
            throw new Error(
              "source and target are required when element is link.",
            );
          if (element === "link" && args.label !== undefined)
            throw new Error("label can only be set on a Sankey node.");
          if (element === "node" && args.opacity !== undefined)
            throw new Error("opacity can only be set on a Sankey link.");
          if (
            !reset &&
            args.color === undefined &&
            args.label === undefined &&
            args.opacity === undefined &&
            args.highlighted === undefined
          )
            throw new Error(
              "Provide color, label, opacity, highlighted, or reset true.",
            );
          let result;
          this.updateActiveProject(
            "style_sankey_element",
            source,
            `Styled one Sankey ${element}`,
            (project) => {
              const dashboard = requiredDashboard(
                project,
                String(args.dashboardId ?? project.activeDashboardId),
              );
              const block = requiredBlock(
                dashboard.blocks,
                String(args.blockId),
              );
              if (block.type !== "sankey")
                throw new Error("The selected block is not a Sankey chart.");
              const table = tableForBlock(project, block);
              if (!table)
                throw new Error("The Sankey chart has no data table.");
              const sourceIndex = table.columns.indexOf(
                block.categoryField ?? "",
              );
              const targetIndex = table.columns.indexOf(
                block.targetField ?? "",
              );
              if (element === "node") {
                const node = String(args.node).trim();
                const exists = table.rows.some(
                  (row) =>
                    String(row[sourceIndex] ?? "") === node ||
                    String(row[targetIndex] ?? "") === node,
                );
                if (!exists) throw new Error(`Sankey node not found: ${node}.`);
                const current = block.chart.sankeyNodeOverrides ?? [];
                const existing = current.find((item) => item.node === node);
                block.chart.sankeyNodeOverrides = reset
                  ? current.filter((item) => item.node !== node)
                  : [
                      ...current.filter((item) => item.node !== node),
                      {
                        ...existing,
                        node,
                        ...(args.color === undefined
                          ? {}
                          : { color: String(args.color) }),
                        ...(args.label === undefined
                          ? {}
                          : { label: String(args.label) }),
                        ...(args.highlighted === undefined
                          ? {}
                          : { highlighted: Boolean(args.highlighted) }),
                      },
                    ];
                result = block.chart.sankeyNodeOverrides.find(
                  (item) => item.node === node,
                );
              } else {
                const sourceName = String(args.source).trim();
                const targetName = String(args.target).trim();
                const exists = table.rows.some(
                  (row) =>
                    String(row[sourceIndex] ?? "") === sourceName &&
                    String(row[targetIndex] ?? "") === targetName,
                );
                if (!exists)
                  throw new Error(
                    `Sankey link not found: ${sourceName} to ${targetName}.`,
                  );
                const current = block.chart.sankeyLinkOverrides ?? [];
                const matches = (item: (typeof current)[number]) =>
                  item.source === sourceName && item.target === targetName;
                const existing = current.find(matches);
                block.chart.sankeyLinkOverrides = reset
                  ? current.filter((item) => !matches(item))
                  : [
                      ...current.filter((item) => !matches(item)),
                      {
                        ...existing,
                        source: sourceName,
                        target: targetName,
                        ...(args.color === undefined
                          ? {}
                          : { color: String(args.color) }),
                        ...(args.opacity === undefined
                          ? {}
                          : { opacity: Number(args.opacity) }),
                        ...(args.highlighted === undefined
                          ? {}
                          : { highlighted: Boolean(args.highlighted) }),
                      },
                    ];
                result = block.chart.sankeyLinkOverrides.find(matches);
              }
              block.updatedAt = new Date().toISOString();
              dashboard.updatedAt = block.updatedAt;
            },
          );
          return { blockId: String(args.blockId), element, override: result };
        },
      },
      {
        name: "remove_block",
        title: "Remove dashboard block",
        description: "Remove one block from a dashboard.",
        inputSchema: objectSchema(
          {
            dashboardId: stringProp("Dashboard ID; defaults to active"),
            blockId: stringProp("Block ID"),
          },
          ["blockId"],
        ),
        readOnly: false,
        execute: (args, source) => {
          this.updateActiveProject(
            "remove_block",
            source,
            "Removed block",
            (project) => {
              const dashboard = requiredDashboard(
                project,
                String(args.dashboardId ?? project.activeDashboardId),
              );
              const removedBlock = dashboard.blocks.find(
                (block) => block.id === String(args.blockId),
              );
              const removedStackHeight = removedBlock?.layout.stackId
                ? dashboard.blocks
                    .filter(
                      (block) =>
                        block.layout.stackId === removedBlock.layout.stackId,
                    )
                    .reduce((sum, block) => sum + block.layout.minHeight, 0) +
                  Math.max(
                    0,
                    dashboard.blocks.filter(
                      (block) =>
                        block.layout.stackId === removedBlock.layout.stackId,
                    ).length - 1,
                  ) *
                    16
                : undefined;
              const before = dashboard.blocks.length;
              dashboard.blocks = dashboard.blocks.filter(
                (block) => block.id !== String(args.blockId),
              );
              if (dashboard.blocks.length === before)
                throw new Error("Block not found.");
              if (removedBlock?.layout.stackId && removedStackHeight) {
                const survivors = dashboard.blocks.filter(
                  (block) =>
                    block.layout.stackId === removedBlock.layout.stackId,
                );
                if (survivors.length === 1)
                  survivors[0].layout.minHeight = Math.min(
                    MAX_BLOCK_HEIGHT,
                    removedStackHeight,
                  );
              }
              normalizeDashboardStacks(dashboard.blocks);
              normalizeDashboardRowWidths(dashboard.blocks);
            },
          );
          return { removed: true };
        },
      },
      {
        name: "duplicate_block",
        title: "Duplicate dashboard block",
        description:
          "Duplicate a block with all of its human-authored settings.",
        inputSchema: objectSchema(
          {
            dashboardId: stringProp("Dashboard ID; defaults to active"),
            blockId: stringProp("Block ID"),
          },
          ["blockId"],
        ),
        readOnly: false,
        execute: (args, source) => {
          let copy;
          this.updateActiveProject(
            "duplicate_block",
            source,
            "Duplicated block",
            (project) => {
              const dashboard = requiredDashboard(
                project,
                String(args.dashboardId ?? project.activeDashboardId),
              );
              const index = dashboard.blocks.findIndex(
                (block) => block.id === String(args.blockId),
              );
              if (index < 0) throw new Error("Block not found.");
              copy = structuredClone(dashboard.blocks[index]);
              copy.id = crypto.randomUUID();
              copy.title = `${copy.title} copy`;
              copy.createdBy = source;
              copy.createdAt = new Date().toISOString();
              copy.updatedAt = copy.createdAt;
              dashboard.blocks.splice(index + 1, 0, copy);
            },
          );
          return copy;
        },
      },
      {
        name: "move_block",
        title: "Move dashboard block",
        description: "Move a block earlier or later in the dashboard flow.",
        inputSchema: objectSchema(
          {
            dashboardId: stringProp("Dashboard ID; defaults to active"),
            blockId: stringProp("Block ID"),
            index: numberProp("Zero-based destination", 0, 500),
          },
          ["blockId", "index"],
        ),
        readOnly: false,
        execute: (args, source) => {
          this.updateActiveProject(
            "move_block",
            source,
            "Moved block",
            (project) => {
              const dashboard = requiredDashboard(
                project,
                String(args.dashboardId ?? project.activeDashboardId),
              );
              const from = dashboard.blocks.findIndex(
                (block) => block.id === String(args.blockId),
              );
              if (from < 0) throw new Error("Block not found.");
              const [block] = dashboard.blocks.splice(from, 1);
              const destination = Math.max(
                0,
                Math.floor(Number(args.index)) || 0,
              );
              dashboard.blocks.splice(
                Math.min(dashboard.blocks.length, destination),
                0,
                block,
              );
              normalizeDashboardStacks(dashboard.blocks);
              normalizeDashboardRowWidths(dashboard.blocks);
            },
          );
          return { moved: true };
        },
      },
      {
        name: "set_dashboard_layout",
        title: "Move and resize dashboard blocks",
        description:
          "Atomically resize dashboard blocks and, when every block is included, reorder them. Partial placement lists preserve the existing block order.",
        inputSchema: objectSchema(
          {
            dashboardId: stringProp("Dashboard ID; defaults to active"),
            placements: arrayProp("Block placements in desired order", {
              type: "object",
              properties: {
                blockId: stringProp("Block ID"),
                width: enumProp("Grid width", [...LAYOUT_WIDTHS]),
                minHeight: numberProp(
                  "Minimum block height",
                  MIN_BLOCK_HEIGHT,
                  MAX_BLOCK_HEIGHT,
                ),
                stackId: stringProp(
                  "Shared vertical-stack ID; send an empty string to clear",
                ),
              },
              required: ["blockId"],
              additionalProperties: false,
            }),
          },
          ["placements"],
        ),
        readOnly: false,
        execute: (args, source) => {
          let result;
          this.updateActiveProject(
            "set_dashboard_layout",
            source,
            "Reordered and resized dashboard blocks",
            (project) => {
              const dashboard = requiredDashboard(
                project,
                String(args.dashboardId ?? project.activeDashboardId),
              );
              const placements = validateLayoutPlacements(
                args.placements,
                dashboard,
              );
              const blocksById = new Map(
                dashboard.blocks.map((block) => [block.id, block]),
              );
              const placedBlocks = placements.map((placement) => {
                const block = blocksById.get(placement.blockId)!;
                if (placement.width !== undefined)
                  block.layout.width = placement.width;
                if (placement.minHeight !== undefined)
                  block.layout.minHeight = placement.minHeight;
                if (placement.stackId !== undefined) {
                  if (placement.stackId)
                    block.layout.stackId = placement.stackId;
                  else delete block.layout.stackId;
                }
                block.updatedAt = new Date().toISOString();
                return block;
              });
              if (placements.length === dashboard.blocks.length)
                dashboard.blocks = placedBlocks;
              normalizeDashboardStacks(dashboard.blocks);
              dashboard.updatedAt = new Date().toISOString();
              result = dashboard.blocks.map((block, index) => ({
                blockId: block.id,
                index,
                ...block.layout,
              }));
            },
          );
          return result;
        },
      },
      {
        name: "create_monthly_dashboard_edition",
        title: "Create monthly dashboard draft",
        description:
          "Create the next durable monthly version of an existing dashboard after every dataset it uses has approved data for that period. The previous month remains intact. Layout, styling, illustrations, and dashboard lineage are preserved; every bound card moves cleanly to the requested month so an agent can revise only findings, commentary, and chart choices warranted by the new data.",
        inputSchema: objectSchema(
          {
            sourceDashboardId: stringProp(
              "Dashboard to clone; defaults to the active dashboard",
            ),
            period: stringProp(
              "Approved reporting month in YYYY-MM format",
              "^\\d{4}-(0[1-9]|1[0-2])$",
            ),
            name: stringProp("Name for the new dashboard edition"),
          },
          ["period"],
        ),
        readOnly: false,
        execute: (args, source) => {
          let result;
          this.updateActiveProject(
            "create_monthly_dashboard_edition",
            source,
            `Created ${String(args.period)} dashboard draft`,
            (project) => {
              const sourceDashboard = requiredDashboard(
                project,
                String(args.sourceDashboardId ?? project.activeDashboardId),
              );
              const period = String(args.period);
              const seriesId = dashboardSeriesId(project, sourceDashboard);
              const seriesName = dashboardSeriesName(project, sourceDashboard);
              const existing = project.dashboards.find(
                (candidate) =>
                  dashboardSeriesId(project, candidate) === seriesId &&
                  dashboardPeriod(project, candidate) === period,
              );
              if (existing) {
                project.activeDashboardId = existing.id;
                result = {
                  dashboardId: existing.id,
                  name: existing.name,
                  period,
                  status: existing.edition?.status ?? "published",
                  existing: true,
                  preservedBlockCount: existing.blocks.length,
                  nextStep:
                    "This monthly dashboard already exists. Inspect and edit that version instead of creating a duplicate.",
                };
                return;
              }
              const requiredDatasetIds = [
                ...new Set(
                  sourceDashboard.blocks
                    .map((block) => block.datasetId)
                    .filter((id): id is string => Boolean(id)),
                ),
              ];
              const missing = requiredDatasetIds
                .map((id) => requiredAsset(project, id))
                .filter(
                  (asset) =>
                    !asset.months.some(
                      (month) =>
                        month.period === period && month.status !== "pending",
                    ),
                );
              if (missing.length)
                throw new Error(
                  `Dashboard draft blocked: approve ${missing.map((asset) => asset.name).join(", ")} for ${periodLabel(period)} first.`,
                );
              const now = new Date().toISOString();
              const dashboard = structuredClone(sourceDashboard);
              dashboard.id = crypto.randomUUID();
              dashboard.name = String(
                args.name ?? `${seriesName} · ${periodLabel(period)}`,
              );
              dashboard.description = `${periodLabel(period)} draft cloned from ${seriesName}. Approved data is bound; commentary and adaptive chart recommendations await review.`;
              dashboard.headerEyebrow = `${project.name} · ${periodLabel(period)} draft · approved data`;
              dashboard.reportingPeriod = period;
              dashboard.seriesId = seriesId;
              dashboard.createdAt = now;
              dashboard.updatedAt = now;
              dashboard.edition = {
                period,
                sourceDashboardId: sourceDashboard.id,
                status: "draft",
                createdFromPeriod: dashboardPeriod(project, sourceDashboard),
              };
              dashboard.blocks = dashboard.blocks.map((block) => ({
                ...block,
                id: crypto.randomUUID(),
                period: block.datasetId
                  ? periodForDashboardVersion(block.period, period)
                  : block.period,
                createdAt: now,
                updatedAt: now,
              }));
              project.dashboards.push(dashboard);
              project.activeDashboardId = dashboard.id;
              result = {
                dashboardId: dashboard.id,
                name: dashboard.name,
                period,
                status: "draft",
                preservedBlockCount: dashboard.blocks.length,
                commentaryBlockIds: dashboard.blocks
                  .filter((block) =>
                    ["sectionHeader", "heading", "text"].includes(block.type),
                  )
                  .map((block) => block.id),
                chartBlockIds: dashboard.blocks
                  .filter((block) =>
                    [
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
                    ].includes(block.type),
                  )
                  .map((block) => block.id),
                nextStep:
                  "Inspect the new dashboard, compare the approved month with its source edition, then update commentary and only chart layouts that materially improve the new story.",
              };
            },
          );
          return result;
        },
      },
      {
        name: "build_dashboard_from_dataset",
        title: "Build executive dashboard",
        description:
          "Create a newspaper-structured dashboard from a cleaned dataset: headline, KPI row, explanatory midline chart, and detailed appendix table. Every block remains human-editable.",
        inputSchema: objectSchema(
          {
            datasetId: stringProp("Clean dataset ID"),
            name: stringProp("Dashboard name"),
            audience: stringProp("Audience and purpose"),
          },
          ["datasetId", "name"],
        ),
        readOnly: false,
        execute: (args, source) => {
          let result;
          this.updateActiveProject(
            "build_dashboard_from_dataset",
            source,
            `Built ${String(args.name)} from cleaned data`,
            (project) => {
              const asset = requiredAsset(project, String(args.datasetId));
              const dashboard = executiveDashboardFromAsset(
                asset,
                String(args.name),
                String(args.audience ?? "Executive decision support"),
                source,
              );
              project.dashboards.push(dashboard);
              project.activeDashboardId = dashboard.id;
              result = dashboard;
            },
          );
          return result;
        },
      },
    ];

    definitions.push(...this.tableStyleToolDefinitions());
    definitions.push(...this.blockToolDefinitions());
    return definitions.map(withModelGuidance);
  }

  private tableStyleToolDefinitions(): ToolDefinition[] {
    const columnFields = [
      "label",
      "width",
      "align",
      "wrap",
      "numberFormat",
      "decimalPlaces",
      "prefix",
      "suffix",
      "backgroundColor",
      "textColor",
      "headerBackgroundColor",
      "headerTextColor",
    ];
    const cellFields = [
      "backgroundColor",
      "textColor",
      "fontWeight",
      "textAlign",
    ];
    return [
      {
        name: "style_table_column",
        title: "Style one table column",
        description:
          "Make a narrow presentation edit to one exact table column without replacing any other table or column settings. Omitted fields stay unchanged. Set reset to remove this column override.",
        inputSchema: objectSchema(
          {
            dashboardId: stringProp("Dashboard ID; defaults to active"),
            blockId: stringProp("Table block ID"),
            ...tableColumnStyleProp().properties,
            reset: booleanProp("Remove this exact column override"),
          },
          ["blockId", "column"],
        ),
        readOnly: false,
        execute: (args, source) => {
          const column = String(args.column);
          if (args.reset && columnFields.some((key) => args[key] !== undefined))
            throw new TypeError(
              "reset: true cannot be combined with column style fields.",
            );
          if (
            !args.reset &&
            !columnFields.some((key) => args[key] !== undefined)
          )
            throw new TypeError("Provide a column style field or reset: true.");
          let result;
          this.updateActiveProject(
            "style_table_column",
            source,
            `${args.reset ? "Reset" : "Styled"} table column ${column}`,
            (project) => {
              const dashboard = requiredDashboard(
                project,
                String(args.dashboardId ?? project.activeDashboardId),
              );
              const block = requiredTableBlock(
                dashboard.blocks,
                String(args.blockId),
              );
              assertTableColumn(project, block, column);
              const current = block.table.columnStyles ?? [];
              const withoutTarget = current.filter(
                (item) => item.column !== column,
              );
              if (args.reset) block.table.columnStyles = withoutTarget;
              else {
                const style = {
                  ...current.find((item) => item.column === column),
                  column,
                  ...pickDefined(args, columnFields),
                } as DashboardBlock["table"]["columnStyles"][number];
                validateTableColumnStyles([style], "columnStyle");
                block.table.columnStyles = [...withoutTarget, style];
              }
              block.updatedAt = new Date().toISOString();
              dashboard.updatedAt = block.updatedAt;
              result = block;
            },
          );
          return result;
        },
      },
      {
        name: "style_table_cell",
        title: "Style one table cell",
        description:
          "Change exactly one table cell without disturbing the rest of the table. Select it by one-based source rowIndex (stable across sorting and search), or by matchColumn plus exact string matchValue. Reusing a target merges only supplied style fields; reset removes it.",
        inputSchema: objectSchema(
          {
            dashboardId: stringProp("Dashboard ID; defaults to active"),
            blockId: stringProp("Table block ID"),
            ...tableCellStyleProp().properties,
            reset: booleanProp("Remove this exact cell override"),
          },
          ["blockId", "column"],
        ),
        readOnly: false,
        execute: (args, source) => {
          if (args.reset && cellFields.some((key) => args[key] !== undefined))
            throw new TypeError(
              "reset: true cannot be combined with cell style fields.",
            );
          if (!args.reset && !cellFields.some((key) => args[key] !== undefined))
            throw new TypeError("Provide a cell style field or reset: true.");
          const selector = {
            column: String(args.column),
            ...(args.rowIndex === undefined
              ? {}
              : { rowIndex: Number(args.rowIndex) }),
            ...(args.matchColumn === undefined
              ? {}
              : { matchColumn: String(args.matchColumn) }),
            ...(args.matchValue === undefined
              ? {}
              : { matchValue: String(args.matchValue) }),
          };
          validateTableCellStyles([selector], "cellSelector");
          let result;
          this.updateActiveProject(
            "style_table_cell",
            source,
            `${args.reset ? "Reset" : "Styled"} one cell in ${selector.column}`,
            (project) => {
              const dashboard = requiredDashboard(
                project,
                String(args.dashboardId ?? project.activeDashboardId),
              );
              const block = requiredTableBlock(
                dashboard.blocks,
                String(args.blockId),
              );
              assertTableColumn(project, block, selector.column);
              if (selector.matchColumn)
                assertTableColumn(project, block, selector.matchColumn);
              assertTableCellTarget(project, block, selector);
              const current = block.table.cellStyles ?? [];
              const sameTarget = (item: (typeof current)[number]) =>
                item.column === selector.column &&
                item.rowIndex === selector.rowIndex &&
                item.matchColumn === selector.matchColumn &&
                item.matchValue === selector.matchValue;
              const withoutTarget = current.filter((item) => !sameTarget(item));
              if (args.reset) block.table.cellStyles = withoutTarget;
              else {
                const style = {
                  ...current.find(sameTarget),
                  ...selector,
                  ...pickDefined(args, cellFields),
                } as DashboardBlock["table"]["cellStyles"][number];
                validateTableCellStyles([style], "cellStyle");
                block.table.cellStyles = [...withoutTarget, style];
              }
              block.updatedAt = new Date().toISOString();
              dashboard.updatedAt = block.updatedAt;
              result = block;
            },
          );
          return result;
        },
      },
      {
        name: "set_table_sort",
        title: "Set tiered table sorting",
        description:
          "Set the complete ordered sort priority for one table. The first rule is primary; each later rule sorts ties from the earlier levels. Blank values stay last at every level. Send an empty rules array to restore source order.",
        inputSchema: objectSchema(
          {
            dashboardId: stringProp("Dashboard ID; defaults to active"),
            blockId: stringProp("Table block ID"),
            rules: arrayProp(
              "Sort levels in priority order",
              tableSortRuleProp(),
            ),
          },
          ["blockId", "rules"],
        ),
        readOnly: false,
        execute: (args, source) => {
          validateTableSortRules(args.rules, "rules");
          const rules = args.rules as DashboardBlock["table"]["sortRules"];
          let result;
          this.updateActiveProject(
            "set_table_sort",
            source,
            rules.length
              ? `Set ${rules.length}-level table sorting`
              : "Restored table source order",
            (project) => {
              const dashboard = requiredDashboard(
                project,
                String(args.dashboardId ?? project.activeDashboardId),
              );
              const block = requiredTableBlock(
                dashboard.blocks,
                String(args.blockId),
              );
              block.table.sortColumn = "";
              block.table.sortDirection = "none";
              block.table.sortRules = rules;
              validateBoundTableConfiguration(project, block);
              block.updatedAt = new Date().toISOString();
              dashboard.updatedAt = block.updatedAt;
              result = block;
            },
          );
          return result;
        },
      },
      {
        name: "style_table_group",
        title: "Color one table group",
        description:
          "Enable row coloring by one exact column and set or reset the colors for one exact grouping value without replacing other group colors. Omitted color fields stay unchanged.",
        inputSchema: objectSchema(
          {
            dashboardId: stringProp("Dashboard ID; defaults to active"),
            blockId: stringProp("Table block ID"),
            column: stringProp("Exact dataset column used for grouping"),
            value: stringProp("Exact grouping value after String() conversion"),
            backgroundColor: stringProp(
              "Group row background color",
              "^#[0-9A-Fa-f]{6}$",
            ),
            textColor: stringProp(
              "Optional group row text color",
              "^#[0-9A-Fa-f]{6}$",
            ),
            reset: booleanProp("Remove this exact group color override"),
          },
          ["blockId", "column", "value"],
        ),
        readOnly: false,
        execute: (args, source) => {
          const fields = ["backgroundColor", "textColor"];
          if (args.reset && fields.some((key) => args[key] !== undefined))
            throw new TypeError(
              "reset: true cannot be combined with group color fields.",
            );
          if (!args.reset && !fields.some((key) => args[key] !== undefined))
            throw new TypeError("Provide a group color field or reset: true.");
          let result;
          this.updateActiveProject(
            "style_table_group",
            source,
            `${args.reset ? "Reset" : "Styled"} table group ${String(args.value)}`,
            (project) => {
              const dashboard = requiredDashboard(
                project,
                String(args.dashboardId ?? project.activeDashboardId),
              );
              const block = requiredTableBlock(
                dashboard.blocks,
                String(args.blockId),
              );
              const column = String(args.column);
              const value = String(args.value);
              assertTableColumn(project, block, column);
              assertTableGroupValue(project, block, column, value);
              const current =
                block.table.colorByColumn === column
                  ? (block.table.groupColors ?? [])
                  : [];
              const existing = current.find((item) => item.value === value);
              if (
                !args.reset &&
                !existing &&
                args.backgroundColor === undefined
              )
                throw new TypeError(
                  "backgroundColor is required when creating a group override.",
                );
              const withoutTarget = current.filter(
                (item) => item.value !== value,
              );
              block.table.colorByColumn = column;
              block.table.groupColors = args.reset
                ? withoutTarget
                : [
                    ...withoutTarget,
                    {
                      ...existing,
                      value,
                      ...pickDefined(args, fields),
                    } as DashboardBlock["table"]["groupColors"][number],
                  ];
              validateTableGroupColors(
                block.table.groupColors,
                "table.groupColors",
              );
              block.updatedAt = new Date().toISOString();
              dashboard.updatedAt = block.updatedAt;
              result = block;
            },
          );
          return result;
        },
      },
    ];
  }

  private blockToolDefinitions(): ToolDefinition[] {
    return [
      this.addBlockTool(
        "add_section_header",
        "Add section header",
        "Add an editorial section divider with an eyebrow, title, subtitle, and optional chip.",
        "sectionHeader",
        {
          title: stringProp("Section title"),
          eyebrow: stringProp("Small uppercase context label"),
          subtitle: stringProp("Section explanation"),
          chip: stringProp("Optional right-side chip"),
        },
        ["title"],
      ),
      this.addBlockTool(
        "add_heading",
        "Add heading",
        "Add a standalone editable heading block.",
        "heading",
        {
          title: stringProp("Heading text"),
          headingLevel: numberProp("Heading level", 1, 3),
          subtitle: stringProp("Optional supporting line"),
        },
        ["title"],
      ),
      this.addBlockTool(
        "add_text",
        "Add text block",
        "Add editable narrative text for context, interpretation, or commentary.",
        "text",
        {
          body: stringProp("Text content"),
          title: stringProp("Optional text heading"),
        },
        ["body"],
      ),
      this.addBlockTool(
        "add_illustration_card",
        "Add approved editorial illustration",
        "Add one of Tessera's 10 approved transparent business illustrations as an image-only tile. Every preset is pre-generated in the exact flat, faceless, minimal black monoline people style, and the visible artwork can be tinted with any six-digit RGB color. The title is an internal editor name and is hidden on the canvas unless a human enables Show caption in Block settings. Use add_generated_illustration_card instead when the user needs a new scene; custom vectors and outside styles are not accepted.",
        "illustration",
        {
          title: stringProp(
            "Internal illustration name; hidden on the canvas by default",
          ),
          altText: stringProp("Concise accessible description of the scene"),
          preset: enumProp(
            "One of the 10 approved exact-style editorial scenes",
            [...ILLUSTRATION_PRESET_NAMES],
          ),
          primaryColor: stringProp(
            "RGB color applied to all visible illustration artwork as six-digit hex; transparent areas remain transparent",
            "^#[0-9A-Fa-f]{6}$",
          ),
          showCaption: booleanProp(
            "Show the illustration name and accessible caption on this card; false keeps the canvas image-only",
          ),
        },
        ["title", "altText"],
      ),
      this.addBlockTool(
        "add_generated_illustration_card",
        "Add generated bitmap illustration",
        `Use only when the user needs a scene that none of the 10 approved presets can express; a matching preset is the fastest path. Generate exactly one image, never variants, with an image-capable model and this required prompt: ${ILLUSTRATION_STYLE_PROMPT} Resize the final image to a 256 by 171 landscape canvas when practical and convert it to a monochrome 8-bit alpha PNG: for every pixel, multiply the source alpha by its darkness so pure black remains opaque, antialiased gray edges keep partial opacity, and white or off-white becomes fully transparent. Store black RGB beneath that alpha, encode the PNG file bytes as standard base64, and send them as maskPng. Do not send the original image, flatten it onto a background, approximate it with vectors, or invent the mask before generating the image. Tessera validates density and detail, stores the compact transparency mask, applies the chosen RGB color, and saves the accepted scene in the active project's reusable illustration library. Build non-image dashboard blocks first with build_dashboard_fast when the host permits parallel work.`,
        "illustration",
        {
          title: stringProp(
            "Internal illustration name; hidden on the canvas by default",
          ),
          altText: stringProp("Concise accessible description of the scene"),
          styleContract: enumProp(
            "Required locked Tessera editorial style contract",
            [ILLUSTRATION_STYLE_CONTRACT_VERSION],
          ),
          maskEncoding: enumProp("Smooth transparency mask encoding", [
            ILLUSTRATION_ALPHA_MASK_ENCODING,
          ]),
          maskWidth: numberProp(
            "Alpha PNG width in pixels; 256 is recommended for speed",
            64,
            768,
          ),
          maskHeight: numberProp(
            "Alpha PNG height in pixels; 171 is recommended for speed",
            48,
            512,
          ),
          maskPng: {
            type: "string",
            description:
              "Standard base64 for the exact monochrome alpha PNG file bytes. Do not include a data URL prefix.",
            pattern: "^[A-Za-z0-9+/]+={0,2}$",
            minLength: 128,
            maxLength: 262144,
          },
          primaryColor: stringProp(
            "RGB color applied to every on pixel as six-digit hex",
            "^#[0-9A-Fa-f]{6}$",
          ),
          showCaption: booleanProp(
            "Show the illustration name and accessible caption on this card; false keeps the canvas image-only",
          ),
        },
        [
          "title",
          "altText",
          "styleContract",
          "maskEncoding",
          "maskWidth",
          "maskHeight",
          "maskPng",
        ],
      ),
      this.addBlockTool(
        "add_saved_illustration_card",
        "Reuse a generated illustration",
        "Add an image-only illustration tile from the active project's generated illustration library. This reuses the stored smooth transparency mask without generating an image or retransferring its pixels. The internal title is hidden unless a person enables Show caption in Block settings.",
        "illustration",
        {
          assetId: stringProp("Generated illustration library asset ID"),
          title: stringProp(
            "Optional internal name override; hidden on the canvas by default",
          ),
          altText: stringProp(
            "Optional accessible-description override for this use",
          ),
          primaryColor: stringProp(
            "RGB color applied to the reused artwork as six-digit hex",
            "^#[0-9A-Fa-f]{6}$",
          ),
          showCaption: booleanProp(
            "Show the illustration name and accessible caption on this card; false keeps the canvas image-only",
          ),
        },
        ["assetId"],
      ),
      this.addBlockTool(
        "add_kpi",
        "Add KPI",
        "Add a KPI with a semantic category label, explicit dataset, monthly period, measure, aggregation, formatting, comparison, and target controls.",
        "kpi",
        {
          title: stringProp("KPI title"),
          eyebrow: stringProp("Short semantic category label"),
          subtitle: stringProp("Optional KPI context"),
          datasetId: stringProp("Dataset ID"),
          period: stringProp("latest, all, or YYYY-MM"),
          valueField: stringProp("Numeric field"),
          aggregation: enumProp("Aggregation", [
            "sum",
            "average",
            "count",
            "minimum",
            "maximum",
            "first",
            "last",
          ]),
          valueFormat: enumProp("Number format", [
            "auto",
            "number",
            "compact",
            "percent",
            "currency",
          ]),
          targetValue: numberProp("Optional target"),
          comparisonLabel: stringProp("Optional comparison label"),
          comparisonValue: numberProp("Optional comparison value"),
          decimalPlaces: numberProp("Decimal places", 0, 6),
          prefix: stringProp("Text before the value"),
          suffix: stringProp("Text after the value"),
          icon: enumProp("Business icon", [...KPI_ICON_NAMES]),
          showProgress: booleanProp("Show the target badge"),
          positiveDirection: enumProp(
            "Optional KPI meaning: use exactly up when higher is better or down when lower is better; omit when no preference is needed",
            ["up", "down"],
          ),
        },
        ["title", "datasetId", "valueField"],
      ),
      this.addBlockTool(
        "add_table",
        "Add table",
        "Add a presentation-ready clean-data table. Supports ordered multi-level sorting, toggleable search, group-based row coloring, column selection and order, totals, number formats, density, frozen headers or columns, heatmaps, global colors, per-column formatting, and exact cell styling.",
        "table",
        {
          title: stringProp("Table title"),
          subtitle: stringProp("Optional table context"),
          datasetId: stringProp("Dataset ID"),
          period: stringProp("latest, all, or YYYY-MM"),
          visibleColumns: arrayProp("Columns to show", stringProp("Column")),
          rowLimit: numberProp("Maximum visible rows", 1, 500),
          sortColumn: stringProp(
            "Column to sort; leave empty for source order",
          ),
          sortDirection: enumProp("Sort direction", [
            "none",
            "ascending",
            "descending",
          ]),
          sortRules: arrayProp(
            "Ordered sort levels; first rule has highest priority",
            tableSortRuleProp(),
          ),
          compact: booleanProp("Use compact density"),
          striped: booleanProp("Stripe alternating rows"),
          rowGridlines: booleanProp("Show horizontal row rules"),
          showTotals: booleanProp("Add calculated totals row"),
          totalsLabel: stringProp("Label in the totals row"),
          totalColumns: arrayProp(
            "Columns to total; empty totals every visible numeric column",
            stringProp("Column"),
          ),
          showSearch: booleanProp(
            "Enable a header control that opens and closes row search",
          ),
          showDatasetName: booleanProp("Show the linked dataset name"),
          showRowCount: booleanProp("Show the visible row count"),
          showRowNumbers: booleanProp("Show a compact row-number column"),
          showColumnHeaders: booleanProp("Show the column header row"),
          columnGridlines: booleanProp("Show vertical column rules"),
          stickyHeader: booleanProp("Keep headings visible while scrolling"),
          freezeFirstColumn: booleanProp("Keep the first visible column fixed"),
          boldLastRow: booleanProp("Emphasize the final row"),
          numberFormat: enumProp("Numeric cell format", [
            "auto",
            "number",
            "compact",
            "percent",
            "currency",
          ]),
          decimalPlaces: numberProp("Decimal places", 0, 6),
          nullDisplay: stringProp("Text shown for blank or null cells"),
          negativeParens: booleanProp("Format negatives in parentheses"),
          negativeRed: booleanProp("Color negative values red"),
          wrapText: booleanProp("Wrap long cell text"),
          heatmap: booleanProp("Shade numeric cells by magnitude"),
          heatmapColor: stringProp("Heatmap color", "^#[0-9A-Fa-f]{6}$"),
          headerBackgroundColor: stringProp(
            "Default header background color",
            "^#[0-9A-Fa-f]{6}$",
          ),
          headerTextColor: stringProp(
            "Default header text color",
            "^#[0-9A-Fa-f]{6}$",
          ),
          rowBackgroundColor: stringProp(
            "Default body row background color",
            "^#[0-9A-Fa-f]{6}$",
          ),
          alternateRowBackgroundColor: stringProp(
            "Striped alternate row background color",
            "^#[0-9A-Fa-f]{6}$",
          ),
          cellTextColor: stringProp(
            "Default body text color",
            "^#[0-9A-Fa-f]{6}$",
          ),
          gridColor: stringProp("Gridline color", "^#[0-9A-Fa-f]{6}$"),
          colorByColumn: stringProp(
            "Column whose distinct values receive consistent row colors; empty disables grouping colors",
          ),
          groupPalette: arrayProp(
            "Row background colors assigned to groups in source order",
            stringProp("Hex color", "^#[0-9A-Fa-f]{6}$"),
          ),
          groupColors: arrayProp(
            "Exact group color overrides",
            tableGroupColorProp(),
          ),
          columnStyles: arrayProp(
            "Sparse per-column presentation overrides; target columns by exact dataset name",
            tableColumnStyleProp(),
          ),
          cellStyles: arrayProp(
            "Sparse exact-cell overrides. Target a source row with rowIndex or with matchColumn plus matchValue",
            tableCellStyleProp(),
          ),
        },
        ["title", "datasetId"],
      ),
      this.barChartTool("add_bar_chart", "Add bar chart", "bar"),
      this.barChartTool(
        "add_horizontal_bar_chart",
        "Add horizontal bar chart",
        "horizontalBar",
      ),
      this.barChartTool(
        "add_grouped_bar_chart",
        "Add grouped bar chart",
        "groupedBar",
      ),
      this.lineChartTool(),
      {
        name: "style_line_chart_element",
        title: "Style one line or point",
        description:
          "Precisely style one series or one point in an existing line chart without replacing its palette or disturbing other overrides. Omit category to target the whole series; provide the exact x-axis category to target one point. Use reset to remove only that targeted override.",
        inputSchema: objectSchema(
          {
            dashboardId: stringProp("Dashboard ID; defaults to active"),
            blockId: stringProp("Line chart block ID"),
            series: stringProp("Exact bound value field / series name"),
            category: stringProp(
              "Exact source category value bound to the x-axis, before any display abbreviation; omit to style the whole series",
            ),
            color: stringProp("Six-digit hex color", "^#[0-9A-Fa-f]{6}$"),
            lineWidth: numberProp("Series line width in pixels", 1, 8),
            lineDash: enumProp("Series stroke pattern", [
              "solid",
              "dashed",
              "dotted",
            ]),
            opacity: numberProp("Series opacity", 0.1, 1),
            showPoints: booleanProp("Show markers for this series"),
            pointSize: numberProp("Marker radius in pixels", 1, 12),
            pointShape: enumProp("Marker shape", [
              "circle",
              "square",
              "diamond",
            ]),
            showLabel: booleanProp(
              "Show the value label for this point; valid with category",
            ),
            reset: booleanProp("Remove only this series or point override"),
          },
          ["blockId", "series"],
        ),
        readOnly: false,
        execute: (args, source) => {
          let result;
          this.updateActiveProject(
            "style_line_chart_element",
            source,
            `Styled line chart: ${String(args.series)}`,
            (project) => {
              const dashboard = requiredDashboard(
                project,
                String(args.dashboardId ?? project.activeDashboardId),
              );
              const block = requiredBlock(
                dashboard.blocks,
                String(args.blockId),
              );
              if (block.type !== "line")
                throw new TypeError("blockId must identify a line chart.");
              const series = String(args.series ?? "").trim();
              if (!series) throw new TypeError("series must not be empty.");
              const boundSeries = block.valueFields.length
                ? block.valueFields
                : block.valueField
                  ? [block.valueField]
                  : [];
              if (!boundSeries.includes(series))
                throw new TypeError(
                  `series must match a bound value field: ${boundSeries.join(", ") || "none are bound"}.`,
                );
              const category =
                args.category === undefined
                  ? undefined
                  : String(args.category).trim();
              if (args.category !== undefined && !category)
                throw new TypeError(
                  "category must not be empty when provided.",
                );
              if (
                args.reset === true &&
                [
                  "color",
                  "lineWidth",
                  "lineDash",
                  "opacity",
                  "showPoints",
                  "pointSize",
                  "pointShape",
                  "showLabel",
                ].some((key) => args[key] !== undefined)
              )
                throw new TypeError(
                  "Use style properties or reset: true, not both.",
                );
              if (category !== undefined) {
                const table = tableForBlock(project, block);
                const categoryIndex = table?.columns.indexOf(
                  block.categoryField ?? table.columns[0],
                );
                const categories = new Set(
                  categoryIndex === undefined || categoryIndex < 0
                    ? []
                    : table!.rows.map((row) =>
                        String(row[categoryIndex] ?? ""),
                      ),
                );
                if (args.reset !== true && !categories.has(category))
                  throw new TypeError(
                    `category must match a source value bound to the x-axis. Available examples: ${[...categories].slice(0, 8).join(", ") || "none"}.`,
                  );
                if (
                  args.lineWidth !== undefined ||
                  args.lineDash !== undefined ||
                  args.opacity !== undefined ||
                  args.showPoints !== undefined
                )
                  throw new TypeError(
                    "lineWidth, lineDash, opacity, and showPoints apply to a series; omit category to use them.",
                  );
                const current = block.chart.linePointStyles ?? [];
                if (args.reset === true) {
                  block.chart.linePointStyles = current.filter(
                    (style) =>
                      style.series !== series || style.category !== category,
                  );
                } else {
                  const update = validateLinePointStyle(
                    {
                      series,
                      category,
                      ...(args.color === undefined
                        ? {}
                        : { color: args.color }),
                      ...(args.pointSize === undefined
                        ? {}
                        : { pointSize: args.pointSize }),
                      ...(args.pointShape === undefined
                        ? {}
                        : { pointShape: args.pointShape }),
                      ...(args.showLabel === undefined
                        ? {}
                        : { showLabel: args.showLabel }),
                    },
                    "input",
                  );
                  if (Object.keys(update).length === 2)
                    throw new TypeError(
                      "Provide color, pointSize, or showLabel; or set reset to true.",
                    );
                  const index = current.findIndex(
                    (style) =>
                      style.series === series && style.category === category,
                  );
                  block.chart.linePointStyles = [...current];
                  if (index < 0) block.chart.linePointStyles.push(update);
                  else
                    block.chart.linePointStyles[index] = {
                      ...block.chart.linePointStyles[index],
                      ...update,
                    };
                }
              } else {
                if (args.showLabel !== undefined)
                  throw new TypeError(
                    "showLabel targets one point; provide category to use it.",
                  );
                const current = block.chart.lineSeriesStyles ?? [];
                if (args.reset === true) {
                  block.chart.lineSeriesStyles = current.filter(
                    (style) => style.series !== series,
                  );
                } else {
                  const update = validateLineSeriesStyle(
                    {
                      series,
                      ...(args.color === undefined
                        ? {}
                        : { color: args.color }),
                      ...(args.lineWidth === undefined
                        ? {}
                        : { lineWidth: args.lineWidth }),
                      ...(args.lineDash === undefined
                        ? {}
                        : { lineDash: args.lineDash }),
                      ...(args.opacity === undefined
                        ? {}
                        : { opacity: args.opacity }),
                      ...(args.showPoints === undefined
                        ? {}
                        : { showPoints: args.showPoints }),
                      ...(args.pointSize === undefined
                        ? {}
                        : { pointSize: args.pointSize }),
                      ...(args.pointShape === undefined
                        ? {}
                        : { pointShape: args.pointShape }),
                    },
                    "input",
                  );
                  if (Object.keys(update).length === 1)
                    throw new TypeError(
                      "Provide a style property or set reset to true.",
                    );
                  const index = current.findIndex(
                    (style) => style.series === series,
                  );
                  block.chart.lineSeriesStyles = [...current];
                  if (index < 0) block.chart.lineSeriesStyles.push(update);
                  else
                    block.chart.lineSeriesStyles[index] = {
                      ...block.chart.lineSeriesStyles[index],
                      ...update,
                    };
                }
              }
              block.updatedAt = new Date().toISOString();
              dashboard.updatedAt = block.updatedAt;
              result = {
                blockId: block.id,
                series,
                ...(category === undefined ? {} : { category }),
                lineSeriesStyles: block.chart.lineSeriesStyles ?? [],
                linePointStyles: block.chart.linePointStyles ?? [],
              };
            },
          );
          return result;
        },
      },
      ...this.donutToolDefinitions(),
      this.addBlockTool(
        "add_gauge_chart",
        "Add gauge chart",
        "Add a clean actual-versus-target gauge. Supports an aggregated actual, fixed or field-driven target, progress or dial display, explicit bounds, qualitative ranges, labels, number formatting, named element colors, geometry, opacity, and tile layout. Named colors make later one-element edits safe through update_block.",
        "gauge",
        {
          title: stringProp("Gauge title"),
          subtitle: stringProp("Optional chart context"),
          datasetId: stringProp("Dataset ID"),
          period: stringProp("latest, all, or YYYY-MM"),
          valueField: stringProp("Numeric field"),
          targetField: stringProp(
            "Optional numeric target field; when present it takes precedence over targetValue",
          ),
          aggregation: enumProp("How to reduce the actual and target fields", [
            "sum",
            "average",
            "minimum",
            "maximum",
            "count",
            "first",
            "last",
          ]),
          display: enumProp("Gauge presentation", ["progress", "dial"]),
          targetValue: numberProp("Optional fixed target marker"),
          minY: numberProp("Minimum scale value"),
          maxY: numberProp("Maximum scale value; must be greater than minY"),
          valueLabel: stringProp("Optional label below the actual value"),
          targetLabel: stringProp("Target annotation label"),
          showValue: booleanProp("Show the aggregated actual value"),
          showTarget: booleanProp("Show the target tick and annotation"),
          showScaleLabels: booleanProp("Show minimum and maximum labels"),
          showPercentOfTarget: booleanProp(
            "Show actual as a percent of target",
          ),
          showRangeLabels: booleanProp("Show labels for qualitative ranges"),
          arcWidth: numberProp("Arc thickness in pixels", 8, 40),
          roundedEnds: booleanProp("Use rounded arc ends"),
          trackColor: stringProp("Unfilled track color", "^#[0-9A-Fa-f]{6}$"),
          valueColor: stringProp("Actual-value arc color", "^#[0-9A-Fa-f]{6}$"),
          targetColor: stringProp("Target marker color", "^#[0-9A-Fa-f]{6}$"),
          needleColor: stringProp("Dial pointer color", "^#[0-9A-Fa-f]{6}$"),
          ranges: arrayProp(
            "Optional qualitative scale ranges. Give each range a stable id so an agent can identify it in later edits.",
            gaugeRangeProp(),
          ),
          valueFormat: enumProp("Number format", [
            "auto",
            "number",
            "compact",
            "percent",
            "currency",
          ]),
          decimalPlaces: numberProp("Decimal places", 0, 6),
          seriesOpacity: numberProp("Actual arc and range opacity", 0.1, 1),
        },
        ["title", "datasetId", "valueField"],
      ),
      {
        name: "style_gauge_element",
        title: "Style one gauge element",
        description:
          "Change the color of exactly one named gauge element without replacing any other gauge settings. Choose value, track, target, needle, or a qualitative range identified by rangeId.",
        inputSchema: objectSchema(
          {
            dashboardId: stringProp("Dashboard ID; defaults to active"),
            blockId: stringProp("Gauge block ID"),
            element: enumProp("Element to recolor", [
              "value",
              "track",
              "target",
              "needle",
              "range",
            ]),
            rangeId: stringProp(
              "Stable range id; required only when element is range",
            ),
            color: stringProp("New six-digit hex color", "^#[0-9A-Fa-f]{6}$"),
            reset: booleanProp(
              "Restore a named value, track, target, or needle element to its default color",
            ),
          },
          ["blockId", "element"],
        ),
        readOnly: false,
        execute: (args, source) => {
          let result;
          this.updateActiveProject(
            "style_gauge_element",
            source,
            `Styled gauge ${String(args.element)}`,
            (project) => {
              const dashboard = requiredDashboard(
                project,
                String(args.dashboardId ?? project.activeDashboardId),
              );
              const block = requiredBlock(
                dashboard.blocks,
                String(args.blockId),
              );
              if (block.type !== "gauge")
                throw new TypeError("blockId must identify a gauge chart.");
              const element = String(args.element);
              if (args.reset && args.color !== undefined)
                throw new TypeError("Use color or reset: true, not both.");
              if (!args.reset && args.color === undefined)
                throw new TypeError("Provide color or reset: true.");
              const color =
                args.color === undefined ? undefined : String(args.color);
              if (color !== undefined) hexColor(color, "color");
              let appliedColor = String(color ?? "");
              block.gauge = block.gauge ?? defaultGaugeSettings();
              if (element === "range") {
                if (args.reset)
                  throw new TypeError(
                    "Gauge ranges have explicit colors; provide a replacement color instead of reset.",
                  );
                const rangeId = String(args.rangeId ?? "").trim();
                if (!rangeId)
                  throw new TypeError(
                    "rangeId is required when element is range.",
                  );
                const range = block.gauge.ranges.find(
                  (candidate) => candidate.id === rangeId,
                );
                if (!range)
                  throw new Error(`Gauge range not found: ${rangeId}.`);
                range.color = String(color);
                appliedColor = range.color;
              } else {
                enumValue(
                  element,
                  ["value", "track", "target", "needle"],
                  "element",
                );
                block.gauge.colors[
                  element as keyof DashboardBlock["gauge"]["colors"]
                ] = args.reset
                  ? defaultGaugeSettings().colors[
                      element as keyof DashboardBlock["gauge"]["colors"]
                    ]
                  : String(color);
                appliedColor =
                  block.gauge.colors[
                    element as keyof DashboardBlock["gauge"]["colors"]
                  ];
              }
              block.updatedAt = new Date().toISOString();
              dashboard.updatedAt = block.updatedAt;
              result = {
                blockId: block.id,
                element,
                ...(element === "range" ? { rangeId: args.rangeId } : {}),
                color: appliedColor,
              };
            },
          );
          return result;
        },
      },
      this.addBlockTool(
        "add_scatter_chart",
        "Add scatter chart",
        "Add a clean relationship chart with explicit X, Y, label, and optional series bindings; independent axis formats and bounds; point geometry; trend and reference guides; per-point overrides; and complete tile styling. Use style_scatter_point for a later one-point edit.",
        "scatter",
        {
          title: stringProp(
            "Chart title that states the relationship or insight",
          ),
          subtitle: stringProp("Optional context, caveat, or source note"),
          datasetId: stringProp("Dataset ID"),
          period: stringProp("latest, all, or YYYY-MM"),
          categoryField: stringProp("Numeric X-axis field"),
          valueField: stringProp("Numeric Y-axis field"),
          labelField: stringProp("Optional field used to identify each point"),
          seriesField: stringProp(
            "Optional categorical field that groups points by color",
          ),
          showValues: booleanProp("Show point labels"),
          showLegend: booleanProp(
            "Show the series legend when seriesField is set",
          ),
          legendPosition: enumProp("Legend position", [
            "top",
            "bottom",
            "right",
          ]),
          showGridlines: booleanProp("Show horizontal and vertical gridlines"),
          showXAxis: booleanProp("Show X-axis ticks"),
          showYAxis: booleanProp("Show Y-axis ticks"),
          xAxisTitle: stringProp("X-axis title; defaults to categoryField"),
          yAxisTitle: stringProp("Y-axis title; defaults to valueField"),
          xValueFormat: enumProp("X-axis number format", [
            "auto",
            "number",
            "compact",
            "percent",
            "currency",
          ]),
          xDecimalPlaces: numberProp("X-axis decimal places", 0, 6),
          valueFormat: enumProp("Y-axis number format", [
            "auto",
            "number",
            "compact",
            "percent",
            "currency",
          ]),
          decimalPlaces: numberProp("Y-axis decimal places", 0, 6),
          minX: numberProp("Optional X-axis minimum"),
          maxX: numberProp("Optional X-axis maximum"),
          minY: numberProp("Optional Y-axis minimum"),
          maxY: numberProp("Optional Y-axis maximum"),
          includeZero: booleanProp("Force zero into both auto-scaled axes"),
          pointSize: numberProp("Default point radius in pixels", 2, 20),
          pointShape: enumProp("Default point shape", [
            "circle",
            "square",
            "diamond",
          ]),
          pointStroke: stringProp("Point outline color", "^#[0-9A-Fa-f]{6}$"),
          pointStrokeWidth: numberProp("Point outline width", 0, 6),
          seriesOpacity: numberProp("Default point opacity", 0.1, 1),
          showTrendLine: booleanProp(
            "Show an ordinary least-squares trend line",
          ),
          trendLineColor: stringProp("Trend line color", "^#[0-9A-Fa-f]{6}$"),
          xReferenceValue: numberProp("Optional vertical reference value"),
          xReferenceLabel: stringProp("Vertical reference label"),
          yReferenceValue: numberProp("Optional horizontal reference value"),
          yReferenceLabel: stringProp("Horizontal reference label"),
          colors: arrayProp(
            "Series palette; the first color is used when seriesField is unset",
            stringProp("Hex color", "^#[0-9A-Fa-f]{6}$"),
          ),
          pointStyles: scatterPointStylesProp(),
        },
        ["title", "datasetId", "categoryField", "valueField"],
      ),
      ...this.treemapToolDefinitions(),
      this.heatmapChartTool(),
      {
        name: "style_heatmap_cell",
        title: "Style one heatmap cell",
        description:
          "Change or reset exactly one heatmap cell without replacing the color scale or any other cell override. Select a row by its exact rendered label, or use its one-based source row when labels repeat, and identify the column by its exact value-field name.",
        inputSchema: objectSchema(
          {
            dashboardId: stringProp("Dashboard ID; defaults to active"),
            blockId: stringProp("Heatmap block ID"),
            rowLabel: stringProp(
              "Exact rendered row label; use rowIndex instead if labels repeat",
              ".*\\S.*",
            ),
            rowIndex: numberProp(
              "One-based source row, excluding the header",
              1,
            ),
            column: stringProp(
              "Exact bound value field / column heading",
              ".*\\S.*",
            ),
            color: stringProp("Cell fill color", "^#[0-9A-Fa-f]{6}$"),
            textColor: stringProp(
              "Optional value-label color",
              "^#[0-9A-Fa-f]{6}$",
            ),
            reset: booleanProp("Remove this cell's custom style"),
          },
          ["blockId", "column"],
        ),
        readOnly: false,
        execute: (args, source) => {
          const rowLabel =
            args.rowLabel === undefined
              ? undefined
              : String(args.rowLabel).trim();
          const rowIndex =
            args.rowIndex === undefined ? undefined : Number(args.rowIndex);
          if (!rowLabel && rowIndex === undefined)
            throw new TypeError(
              "Provide rowLabel or rowIndex to select one heatmap row.",
            );
          if (rowIndex !== undefined)
            integerNumber(rowIndex, "rowIndex", 1, Number.MAX_SAFE_INTEGER);
          if (args.color !== undefined) hexColor(args.color, "color");
          if (args.textColor !== undefined)
            hexColor(args.textColor, "textColor");
          if (args.reset !== undefined) booleanValue(args.reset, "reset");
          if (rowLabel && rowIndex !== undefined)
            throw new TypeError(
              "Use either rowLabel or rowIndex, not both, so the cell target is unambiguous.",
            );
          if (
            !args.reset &&
            args.color === undefined &&
            args.textColor === undefined
          )
            throw new TypeError("Provide color, textColor, or reset: true.");
          if (
            args.reset &&
            (args.color !== undefined || args.textColor !== undefined)
          )
            throw new TypeError(
              "reset: true cannot be combined with color or textColor.",
            );
          let result;
          this.updateActiveProject(
            "style_heatmap_cell",
            source,
            `Styled heatmap cell ${rowLabel ?? `row ${rowIndex}`} / ${String(args.column)}`,
            (project) => {
              const dashboard = requiredDashboard(
                project,
                String(args.dashboardId ?? project.activeDashboardId),
              );
              const block = requiredBlock(
                dashboard.blocks,
                String(args.blockId),
              );
              if (block.type !== "heatmap")
                throw new TypeError("blockId must identify a heatmap chart.");
              const column = String(args.column ?? "").trim();
              if (!block.valueFields.includes(column))
                throw new TypeError(
                  `column must be one of the heatmap's bound value fields: ${block.valueFields.join(", ") || "none"}.`,
                );
              const table = tableForBlock(project, block);
              if (!table)
                throw new Error("The heatmap's bound dataset has no rows.");
              if (rowIndex !== undefined && rowIndex > table.rows.length)
                throw new TypeError(
                  `rowIndex must be between 1 and ${table.rows.length}.`,
                );
              if (rowLabel) {
                const categoryIndex = table.columns.indexOf(
                  block.categoryField ?? "",
                );
                const matches = table.rows.filter(
                  (row) => String(row[categoryIndex] ?? "") === rowLabel,
                ).length;
                if (!matches)
                  throw new TypeError(
                    `No heatmap row is labeled "${rowLabel}".`,
                  );
                if (matches > 1)
                  throw new TypeError(
                    `The row label "${rowLabel}" is not unique; use rowIndex instead.`,
                  );
              }
              const current = block.chart.heatmapCellStyles ?? [];
              const matches = (style: (typeof current)[number]) =>
                style.column === column &&
                (rowLabel !== undefined
                  ? style.rowLabel === rowLabel && style.rowIndex === undefined
                  : style.rowIndex === rowIndex &&
                    style.rowLabel === undefined);
              const existing = current.find(matches);
              const withoutSelected = current.filter(
                (style) => !matches(style),
              );
              block.chart.heatmapCellStyles = args.reset
                ? withoutSelected
                : [
                    ...withoutSelected,
                    {
                      ...(rowLabel === undefined ? {} : { rowLabel }),
                      ...(rowIndex === undefined ? {} : { rowIndex }),
                      column,
                      ...existing,
                      ...(args.color === undefined
                        ? {}
                        : { color: String(args.color) }),
                      ...(args.textColor === undefined
                        ? {}
                        : { textColor: String(args.textColor) }),
                    },
                  ];
              block.updatedAt = new Date().toISOString();
              dashboard.updatedAt = block.updatedAt;
              result = {
                blockId: block.id,
                target: { rowLabel, rowIndex, column },
                cellStyles: block.chart.heatmapCellStyles,
              };
            },
          );
          return result;
        },
      },
      this.addBlockTool(
        "add_sankey_chart",
        "Add Sankey chart",
        "Build an editable Sankey from a long flow table with one row per source-to-target relationship and a positive numeric magnitude. Repeated pairs are summed. Supply exact field names from inspect_project. Use the base palette for a coherent chart and nodeOverrides or linkOverrides only for intentional exceptions.",
        "sankey",
        {
          title: stringProp("Chart title"),
          subtitle: stringProp("Optional chart context"),
          datasetId: stringProp(
            "Dataset ID returned by inspect_project; the selected table must contain source, target, and value fields",
          ),
          period: stringProp("latest, all, or YYYY-MM"),
          categoryField: stringProp(
            "Exact field containing the source node for each flow row",
          ),
          targetField: stringProp(
            "Exact field containing the target node for each flow row",
          ),
          valueField: stringProp(
            "Exact numeric field containing a positive flow magnitude; duplicate source-target pairs are summed",
          ),
          stageLabels: arrayProp(
            "Stage names in left-to-right order",
            stringProp("Stage name"),
          ),
          showStageHeaders: booleanProp("Show stage counts and names"),
          showNodeLabels: booleanProp("Show node names"),
          showLinkValues: booleanProp("Show values on individual links"),
          showValues: booleanProp("Show node values"),
          showShares: booleanProp("Show each node's share of total flow"),
          valueFormat: enumProp("Number format", [
            "auto",
            "number",
            "compact",
            "percent",
            "currency",
          ]),
          decimalPlaces: numberProp("Decimal places", 0, 6),
          nodeWidth: numberProp("Node width", 8, 36),
          nodeGap: numberProp("Node gap", 4, 40),
          linkOpacity: numberProp("Link opacity", 0.05, 1),
          linkThickness: numberProp("Flow density", 0.6, 1.8),
          linkColorMode: enumProp("How link colors are derived", [
            "gradient",
            "source",
            "target",
          ]),
          nodeSort: enumProp("Order nodes within each stage", [
            "auto",
            "name",
            "value",
          ]),
          highlightNodes: arrayProp(
            "Node names to highlight",
            stringProp("Node"),
          ),
          colors: arrayProp(
            "Node and link colors",
            stringProp("Hex color", "^#[0-9A-Fa-f]{6}$"),
          ),
          nodeOverrides: arrayProp(
            "Optional exact node styles. Node names must match the bound data; use these for exceptions, not the base palette.",
            sankeyNodeOverrideProp(),
          ),
          linkOverrides: arrayProp(
            "Optional exact link styles identified by source and target. Use these for exceptions, not the base link settings.",
            sankeyLinkOverrideProp(),
          ),
        },
        ["title", "datasetId", "categoryField", "targetField", "valueField"],
      ),
    ];
  }

  private barChartTool(
    name: string,
    title: string,
    type: "bar" | "horizontalBar" | "groupedBar",
  ) {
    const grouped = type === "groupedBar";
    const horizontal = type === "horizontalBar";
    const valueBinding: Record<string, Record<string, unknown>> = grouped
      ? {
          valueFields: {
            ...arrayProp(
              "Two to four numeric fields, in legend and left-to-right bar order. Use colors in the same order.",
              stringProp(
                "Exact numeric field name returned by inspect_project",
              ),
            ),
            minItems: 2,
            maxItems: 4,
          },
        }
      : {
          valueField: stringProp(
            "Exact numeric field name returned by inspect_project. A standard bar chart has one value series.",
          ),
        };
    const cartesianSettings: Record<
      string,
      Record<string, unknown>
    > = horizontal
      ? {}
      : {
          showGridlines: booleanProp("Show horizontal value gridlines"),
          showXAxis: booleanProp("Show category labels and the x-axis"),
          showYAxis: booleanProp("Show numeric y-axis labels"),
          showAverageLine: booleanProp("Show the mean as a guide line"),
          showMinLine: booleanProp("Show the minimum as a guide line"),
          showMaxLine: booleanProp("Show the maximum as a guide line"),
          showReferenceLine: booleanProp(
            "Show the custom referenceValue and referenceLabel",
          ),
          referenceValue: numberProp(
            "Custom benchmark or target; supplying it also enables the reference line",
          ),
          referenceLabel: stringProp(
            "Short label for the custom benchmark, such as Target or Plan",
          ),
          xAxisTitle: stringProp("Optional category-axis title"),
          yAxisTitle: stringProp("Optional value-axis title with units"),
          minY: numberProp(
            "Optional fixed y-axis minimum. Omit for an honest automatic baseline.",
          ),
          maxY: numberProp(
            "Optional fixed y-axis maximum. Omit for automatic headroom.",
          ),
        };
    return this.addBlockTool(
      name,
      title,
      grouped
        ? "Create a grouped vertical bar chart for comparing two to four measures across the same categories. Use exact dataset field names from inspect_project, keep the legend visible, and use barColorOverrides for a surgical category/series color change."
        : horizontal
          ? "Create a single-series horizontal bar chart. Prefer it for rankings, more than about eight categories, or long category labels. It defaults to descending order with value labels; use barColorOverrides to recolor one named bar without changing the series palette."
          : "Create a single-series vertical bar chart for comparing roughly two to twelve categories with short labels. Use exact dataset field names from inspect_project, preserve source order for natural sequences, sort descending for rankings, and use barColorOverrides to recolor one named bar without changing the rest.",
      type,
      {
        title: stringProp(
          "Short, specific chart title that states the measure",
        ),
        subtitle: stringProp(
          "Optional context, scope, time period, or concise takeaway",
        ),
        datasetId: stringProp("Exact dataset ID returned by inspect_project"),
        period: stringProp(
          "Dataset period: latest, all, or an available YYYY-MM value",
        ),
        categoryField: stringProp(
          "Exact field whose row values become category labels",
        ),
        ...valueBinding,
        showValues: booleanProp(
          horizontal
            ? "Show a value at the end of every bar (recommended for ranked bars)"
            : "Show a formatted value above every bar; best for small category counts",
        ),
        ...(grouped
          ? {
              showLegend: booleanProp(
                "Show the series legend (recommended for grouped bars)",
              ),
              legendPosition: enumProp("Series legend position", [
                "top",
                "bottom",
                "right",
              ]),
            }
          : {}),
        sortOrder: enumProp(
          "Category order: source preserves the dataset; ascending/descending ranks by the first value series",
          ["source", "ascending", "descending"],
        ),
        valueFormat: enumProp("Value and axis number format", [
          "auto",
          "number",
          "compact",
          "percent",
          "currency",
        ]),
        decimalPlaces: numberProp("Displayed decimal places", 0, 6),
        colors: {
          ...arrayProp(
            grouped
              ? "Series colors in valueFields order. Each item is a six-digit hex color."
              : "Series palette; the first six-digit hex color controls all bars unless a barColorOverride matches.",
            stringProp("Six-digit hex color", "^#[0-9A-Fa-f]{6}$"),
          ),
          minItems: 1,
          maxItems: grouped ? 4 : 1,
        },
        barColorOverrides: barColorOverridesProp(),
        seriesOpacity: numberProp("Bar opacity", 0.1, 1),
        barRadius: numberProp("Bar corner radius in pixels", 0, 20),
        barGap: numberProp(
          "Percent of each category slot left empty; lower values make wider bars",
          0,
          70,
        ),
        ...cartesianSettings,
      },
      [
        "title",
        "datasetId",
        "categoryField",
        grouped ? "valueFields" : "valueField",
      ],
    );
  }

  private lineChartTool() {
    return this.addBlockTool(
      "add_line_chart",
      "Add line chart",
      "Add a time-ordered or sequential line chart with one to eight numeric series. The tool exposes only line-relevant controls: axes, formatting, guides, interpolation, stroke and markers, missing-value behavior, optional area fill, exact series styles, exact point styles, and tile layout. Keep source order for time series. Use style_line_chart_element for a later one-series or one-point change.",
      "line",
      {
        title: stringProp("Chart title that states the trend or takeaway"),
        subtitle: stringProp("Optional context, comparison, or source note"),
        datasetId: stringProp("Dataset ID returned by project inspection"),
        period: stringProp(
          "latest, all, or YYYY-MM; use all for a trend assembled from monthly snapshots",
        ),
        categoryField: stringProp(
          "Exact category, date, period, or sequence field for the x-axis",
        ),
        valueFields: {
          ...arrayProp(
            "One to eight exact numeric field names in legend and drawing order",
            stringProp("Exact numeric field name"),
          ),
          minItems: 1,
          maxItems: 8,
        },
        showValues: booleanProp(
          "Show a formatted label at every point; use a point style for selective labels",
        ),
        showLegend: booleanProp(
          "Show the legend; recommended when valueFields contains multiple series",
        ),
        legendPosition: enumProp("Legend position", ["top", "bottom", "right"]),
        showGridlines: booleanProp("Show horizontal value gridlines"),
        showXAxis: booleanProp("Show x-axis labels and baseline"),
        showYAxis: booleanProp("Show y-axis tick labels"),
        xAxisTitle: stringProp("Optional x-axis title"),
        yAxisTitle: stringProp("Optional y-axis title including units"),
        minY: numberProp("Optional fixed y-axis minimum"),
        maxY: numberProp("Optional fixed y-axis maximum"),
        valueFormat: enumProp("Point, guide, and y-axis number format", [
          "auto",
          "number",
          "compact",
          "percent",
          "currency",
        ]),
        decimalPlaces: numberProp("Displayed decimal places", 0, 6),
        showAverageLine: booleanProp(
          "Show the first series average as a guide",
        ),
        showMinLine: booleanProp("Show the first series minimum as a guide"),
        showMaxLine: booleanProp("Show the first series maximum as a guide"),
        showReferenceLine: booleanProp(
          "Show the custom referenceValue and referenceLabel",
        ),
        referenceValue: numberProp(
          "Custom benchmark or target; supplying it also enables the reference line",
        ),
        referenceLabel: stringProp(
          "Short custom benchmark label, such as Target or Plan",
        ),
        colors: {
          ...arrayProp(
            "Fallback series colors in valueFields order; each item is a six-digit hex color",
            stringProp("Six-digit hex color", "^#[0-9A-Fa-f]{6}$"),
          ),
          minItems: 1,
          maxItems: 8,
        },
        seriesOpacity: numberProp("Default line and marker opacity", 0.1, 1),
        lineWidth: numberProp("Default line width in pixels", 1, 8),
        lineDash: enumProp("Default stroke pattern", [
          "solid",
          "dashed",
          "dotted",
        ]),
        curve: enumProp("Line interpolation", ["straight", "smooth", "step"]),
        showPoints: booleanProp("Show point markers by default"),
        pointSize: numberProp("Default point radius in pixels", 1, 12),
        pointShape: enumProp("Default point marker shape", [
          "circle",
          "square",
          "diamond",
        ]),
        connectNulls: booleanProp(
          "Connect across missing values; false preserves honest gaps",
        ),
        fillArea: booleanProp(
          "Fill the area from each line to the y-axis floor",
        ),
        areaOpacity: numberProp("Area fill opacity", 0, 0.6),
        seriesStyles: lineSeriesStylesProp(),
        pointStyles: linePointStylesProp(),
      },
      ["title", "datasetId", "categoryField", "valueFields"],
    );
  }

  private donutToolDefinitions(): ToolDefinition[] {
    return [
      this.addBlockTool(
        "add_donut_chart",
        "Add donut chart",
        "Create a part-to-whole donut from one category and one nonnegative numeric value. The contract contains only donut-relevant controls. Use style_donut_slice for a later one-slice edit.",
        "donut",
        {
          title: stringProp("Chart title that states the composition insight"),
          subtitle: stringProp("Optional context, scope, or source note"),
          datasetId: stringProp("Dataset ID returned by project inspection"),
          period: stringProp("latest, all, or YYYY-MM"),
          categoryField: stringProp("Exact field whose values label slices"),
          valueField: stringProp("Exact nonnegative numeric value field"),
          showValues: booleanProp(
            "Show each slice as a percentage in the legend",
          ),
          showLegend: booleanProp("Show slice labels and values"),
          legendPosition: enumProp("Legend position", [
            "top",
            "bottom",
            "right",
          ]),
          valueFormat: enumProp("Value and total number format", [
            "auto",
            "number",
            "compact",
            "percent",
            "currency",
          ]),
          decimalPlaces: numberProp("Displayed decimal places", 0, 6),
          colors: arrayProp(
            "Slice palette in source-category order",
            stringProp("Six-digit hex color", "^#[0-9A-Fa-f]{6}$"),
          ),
          donutHole: numberProp("Center hole percent", 20, 82),
          donutCenterLabel: stringProp("Label below the total in the center"),
          seriesOpacity: numberProp("Default slice opacity", 0.1, 1),
          sliceStyles: donutSliceStylesProp(),
        },
        ["title", "datasetId", "categoryField", "valueField"],
      ),
      this.categoryElementStyleTool(
        "style_donut_slice",
        "donut",
        "slice",
        "donutSliceStyles",
        false,
      ),
    ];
  }

  private treemapToolDefinitions(): ToolDefinition[] {
    return [
      this.addBlockTool(
        "add_treemap_chart",
        "Add treemap chart",
        "Create a proportional treemap from one category and one nonnegative numeric value. The contract contains only treemap-relevant controls. Use style_treemap_tile for a later one-tile edit.",
        "treemap",
        {
          title: stringProp("Chart title that states the composition insight"),
          subtitle: stringProp("Optional context, scope, or source note"),
          datasetId: stringProp("Dataset ID returned by project inspection"),
          period: stringProp("latest, all, or YYYY-MM"),
          categoryField: stringProp("Exact field whose values label tiles"),
          valueField: stringProp(
            "Exact nonnegative numeric field that sizes tiles",
          ),
          showValues: booleanProp(
            "Show formatted values on tiles with enough room",
          ),
          sortOrder: enumProp("Tile order before layout", [
            "source",
            "ascending",
            "descending",
          ]),
          valueFormat: enumProp("Tile value number format", [
            "auto",
            "number",
            "compact",
            "percent",
            "currency",
          ]),
          decimalPlaces: numberProp("Displayed decimal places", 0, 6),
          colors: arrayProp(
            "Tile palette in source-category order",
            stringProp("Six-digit hex color", "^#[0-9A-Fa-f]{6}$"),
          ),
          seriesOpacity: numberProp("Default tile opacity", 0.1, 1),
          barRadius: numberProp("Gap between neighboring tiles", 0, 12),
          tileStyles: treemapTileStylesProp(),
        },
        ["title", "datasetId", "categoryField", "valueField"],
      ),
      this.categoryElementStyleTool(
        "style_treemap_tile",
        "treemap",
        "tile",
        "treemapTileStyles",
        true,
      ),
    ];
  }

  private categoryElementStyleTool(
    name: "style_donut_slice" | "style_treemap_tile",
    type: "donut" | "treemap",
    noun: "slice" | "tile",
    targetKey: "donutSliceStyles" | "treemapTileStyles",
    allowTextColor: boolean,
  ): ToolDefinition {
    const styleFields = allowTextColor
      ? ["color", "textColor", "opacity"]
      : ["color", "opacity"];
    return {
      name,
      title: `Style one ${noun}`,
      description: `Change or reset exactly one ${noun} selected by its exact category label without replacing the palette or any other override.`,
      inputSchema: objectSchema(
        {
          dashboardId: stringProp("Dashboard ID; defaults to active"),
          blockId: stringProp(`${type} block ID`),
          category: stringProp("Exact rendered category label", ".*\\S.*"),
          color: stringProp(`${noun} fill color`, "^#[0-9A-Fa-f]{6}$"),
          ...(allowTextColor
            ? {
                textColor: stringProp("Tile label color", "^#[0-9A-Fa-f]{6}$"),
              }
            : {}),
          opacity: numberProp(`${noun} opacity`, 0.1, 1),
          reset: booleanProp(`Remove this ${noun}'s custom style`),
        },
        ["blockId", "category"],
      ),
      readOnly: false,
      execute: (args, source) => {
        const category = String(args.category ?? "").trim();
        if (!category) throw new TypeError("category must not be empty.");
        if (args.reset && styleFields.some((key) => args[key] !== undefined))
          throw new TypeError("Use style fields or reset: true, not both.");
        if (!args.reset && !styleFields.some((key) => args[key] !== undefined))
          throw new TypeError("Provide a style field or reset: true.");
        if (args.color !== undefined) hexColor(args.color, "color");
        if (args.textColor !== undefined) hexColor(args.textColor, "textColor");
        if (args.opacity !== undefined)
          finiteNumber(args.opacity, "opacity", 0.1, 1);
        let result;
        this.updateActiveProject(
          name,
          source,
          `${args.reset ? "Reset" : "Styled"} ${noun}: ${category}`,
          (project) => {
            const dashboard = requiredDashboard(
              project,
              String(args.dashboardId ?? project.activeDashboardId),
            );
            const block = requiredBlock(dashboard.blocks, String(args.blockId));
            if (block.type !== type)
              throw new TypeError(`blockId must identify a ${type} chart.`);
            assertChartCategory(project, block, category);
            const chart = block.chart as unknown as Record<string, unknown>;
            const current = (chart[targetKey] ?? []) as Array<{
              category: string;
              color?: string;
              textColor?: string;
              opacity?: number;
            }>;
            const existing = current.find(
              (style) => style.category === category,
            );
            const withoutTarget = current.filter(
              (style) => style.category !== category,
            );
            const next = args.reset
              ? withoutTarget
              : [
                  ...withoutTarget,
                  {
                    ...existing,
                    category,
                    ...pickDefined(args, styleFields),
                  },
                ];
            chart[targetKey] = next;
            block.updatedAt = new Date().toISOString();
            dashboard.updatedAt = block.updatedAt;
            result = { blockId: block.id, category, styles: next };
          },
        );
        return result;
      },
    };
  }

  private heatmapChartTool() {
    return this.addBlockTool(
      "add_heatmap_chart",
      "Add heatmap chart",
      "Create a readable row-by-column intensity matrix from one category field and one or more numeric value fields. Global scaling is best for comparable measures; row or column scaling highlights relative patterns. Sequential scales show magnitude, diverging scales show distance around a meaningful midpoint. Use style_heatmap_cell for a surgical one-cell color edit.",
      "heatmap",
      {
        title: stringProp("Short, specific chart title"),
        subtitle: stringProp("Optional context, scope, units, or takeaway"),
        datasetId: stringProp("Exact dataset ID returned by inspect_project"),
        period: stringProp("Dataset period: latest, all, or YYYY-MM"),
        categoryField: stringProp("Exact field whose values become row labels"),
        valueFields: {
          ...arrayProp(
            "Numeric fields that become columns, in left-to-right order",
            stringProp("Exact numeric field name"),
          ),
          minItems: 1,
          maxItems: 24,
        },
        showValues: booleanProp("Show formatted values inside cells"),
        showLegend: booleanProp("Show the low-to-high color-scale key"),
        showXAxis: booleanProp("Show column headings"),
        showYAxis: booleanProp("Show row labels"),
        showGridlines: booleanProp("Draw subtle borders around cells"),
        sortOrder: enumProp(
          "Row order: source preserves data order; ascending/descending sorts by row average",
          ["source", "ascending", "descending"],
        ),
        valueFormat: enumProp("Cell value format", [
          "auto",
          "number",
          "compact",
          "percent",
          "currency",
        ]),
        decimalPlaces: numberProp("Cell value decimal places", 0, 6),
        scaleType: enumProp(
          "sequential for low-to-high magnitude; diverging for values around a midpoint",
          ["sequential", "diverging"],
        ),
        scaleScope: enumProp(
          "global compares every cell on one domain; row or column emphasizes within-group patterns",
          ["global", "row", "column"],
        ),
        minColor: stringProp("Low-value color", "^#[0-9A-Fa-f]{6}$"),
        midColor: stringProp(
          "Midpoint color for a diverging scale",
          "^#[0-9A-Fa-f]{6}$",
        ),
        maxColor: stringProp("High-value color", "^#[0-9A-Fa-f]{6}$"),
        midpoint: numberProp(
          "Meaningful center for a diverging scale, commonly zero or a target; omit for the domain midpoint",
        ),
        minValue: numberProp(
          "Optional fixed scale minimum; omit for data minimum",
        ),
        maxValue: numberProp(
          "Optional fixed scale maximum; omit for data maximum",
        ),
        reverseScale: booleanProp("Swap the visual low and high ends"),
        missingColor: stringProp(
          "Color for blank or nonnumeric cells",
          "^#[0-9A-Fa-f]{6}$",
        ),
        cellGap: numberProp("Gap between cells in pixels", 0, 12),
        cellRadius: numberProp("Cell corner radius in pixels", 0, 16),
        seriesOpacity: numberProp("Overall cell opacity", 0.1, 1),
        cellStyles: heatmapCellStylesProp(),
      },
      ["title", "datasetId", "categoryField", "valueFields"],
    );
  }

  private addBlockTool(
    name: string,
    title: string,
    description: string,
    type: BlockType,
    properties: Record<string, Record<string, unknown>>,
    required: string[],
  ): ToolDefinition {
    return {
      name,
      title,
      description,
      inputSchema: objectSchema(
        {
          dashboardId: stringProp("Dashboard ID; defaults to active"),
          placeholderId: stringProp(
            "Optional unfinished tile ID to fulfill in place while preserving its position and size",
          ),
          width: enumProp(
            "Preferred grid width when snapping beside the preceding tool-added card. A card that starts a new row expands to the full 12 columns.",
            [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
          ),
          minHeight: numberProp("Minimum block height", 60, 900),
          accent: stringProp(
            "Accent color. Card surfaces are always white; use the accent for meaning only: #1f7a4d met, #b42318 missed, #b7791f at risk, #1478ff the one item to emphasize.",
            "^#[0-9A-Fa-f]{6}$",
          ),
          textColor: stringProp("Text color", "^#[0-9A-Fa-f]{6}$"),
          alignH: enumProp("Horizontal alignment", ["left", "center", "right"]),
          alignV: enumProp("Vertical alignment", ["top", "middle", "bottom"]),
          fontScale: numberProp("Type scale percent", 75, 160),
          padding: numberProp("Inner padding", 0, 64),
          cornerRadius: numberProp("Corner radius", 0, 40),
          border: booleanProp("Show border"),
          shadow: enumProp("Shadow depth", ["none", "soft", "raised"]),
          ...properties,
        },
        required,
      ),
      readOnly: false,
      execute: (args, source) => {
        let result;
        this.updateActiveProject(
          name,
          source,
          `${title}: ${String(args.title ?? args.body ?? "block")}`,
          (project) => {
            const dashboard = requiredDashboard(
              project,
              String(args.dashboardId ?? project.activeDashboardId),
            );
            const placeholderId = args.placeholderId
              ? String(args.placeholderId)
              : undefined;
            const placeholderIndex = placeholderId
              ? dashboard.blocks.findIndex(
                  (candidate) => candidate.id === placeholderId,
                )
              : -1;
            const placeholder =
              placeholderIndex >= 0
                ? dashboard.blocks[placeholderIndex]
                : undefined;
            if (placeholderId && !placeholder)
              throw new Error("Tile placeholder not found on this dashboard.");
            if (placeholder && placeholder.buildState !== "placeholder")
              throw new Error("That tile is already complete.");
            const asset = args.datasetId
              ? requiredAsset(project, String(args.datasetId))
              : undefined;
            const versionPeriod = dashboardPeriod(project, dashboard);
            const requestedPeriod = args.period
              ? String(args.period)
              : asset && versionPeriod
                ? versionPeriod
                : "latest";
            const blockPeriod =
              asset && versionPeriod && requestedPeriod === "all"
                ? periodForDashboardVersion(requestedPeriod, versionPeriod)
                : requestedPeriod;
            const valueFields = Array.isArray(args.valueFields)
              ? args.valueFields.map(String)
              : args.valueField
                ? [String(args.valueField)]
                : [];
            if (
              asset &&
              ["bar", "horizontalBar", "groupedBar"].includes(type) &&
              args.categoryField &&
              valueFields.length
            )
              validateBarBinding(
                asset,
                blockPeriod,
                String(args.categoryField),
                valueFields,
                type,
              );
            if (
              asset &&
              type === "heatmap" &&
              args.categoryField &&
              valueFields.length
            )
              validateHeatmapBinding(
                asset,
                blockPeriod,
                String(args.categoryField),
                valueFields,
              );
            if (
              asset &&
              type === "scatter" &&
              args.categoryField &&
              args.valueField
            )
              validateScatterBinding(
                asset,
                blockPeriod,
                String(args.categoryField),
                String(args.valueField),
                args.labelField === undefined
                  ? undefined
                  : String(args.labelField),
                args.seriesField === undefined
                  ? undefined
                  : String(args.seriesField),
              );
            if (
              asset &&
              ["donut", "treemap"].includes(type) &&
              args.categoryField &&
              args.valueField
            )
              validateCategoryValueBinding(
                asset,
                blockPeriod,
                String(args.categoryField),
                String(args.valueField),
                type as "donut" | "treemap",
              );
            if (
              asset &&
              type === "sankey" &&
              args.categoryField &&
              args.targetField
            )
              validateNetworkBinding(
                asset,
                blockPeriod,
                String(args.categoryField),
                String(args.targetField),
                args.valueField === undefined
                  ? undefined
                  : String(args.valueField),
                "Sankey",
              );
            if (asset && type === "gauge" && args.valueField)
              validateNumericValueBinding(
                asset,
                blockPeriod,
                String(args.valueField),
                args.targetField === undefined
                  ? undefined
                  : String(args.targetField),
                "gauge",
              );
            const block = createBlock(
              type,
              {
                title: String(
                  args.title ?? (type === "text" ? "" : undefined) ?? "",
                ),
                subtitle: String(args.subtitle ?? ""),
                eyebrow: String(
                  args.eyebrow ?? (type === "sectionHeader" ? "SECTION" : ""),
                ),
                chip: String(args.chip ?? ""),
                body: String(args.body ?? ""),
                headingLevel: clampHeading(args.headingLevel),
                datasetId: args.datasetId ? String(args.datasetId) : undefined,
                period: blockPeriod,
                categoryField: args.categoryField
                  ? String(args.categoryField)
                  : undefined,
                labelField: args.labelField
                  ? String(args.labelField)
                  : undefined,
                seriesField: args.seriesField
                  ? String(args.seriesField)
                  : undefined,
                targetField: args.targetField
                  ? String(args.targetField)
                  : undefined,
                valueField: args.valueField
                  ? String(args.valueField)
                  : undefined,
                valueFields,
                buildState: "ready",
                buildMode: placeholder?.buildMode ?? "agent",
                intent: placeholder?.intent ?? "",
              },
              source,
            );
            // New cards are drawn in the dashboard's kit; explicit colour
            // arguments applied below still win.
            recolorBlock(block, KITS[DEFAULT_KIT_ID], kitFor(dashboard));
            if (placeholder) {
              block.id = placeholder.id;
              block.createdAt = placeholder.createdAt;
              block.layout = { ...placeholder.layout };
            }
            if (type === "horizontalBar") {
              block.chart.showLegend = false;
              block.chart.showValues = true;
              block.chart.sortOrder = "descending";
            } else if (type === "bar") {
              block.chart.showLegend = false;
            } else if (type === "groupedBar") {
              block.chart.showLegend = true;
            }
            if (args.width)
              block.layout.width = Number(
                args.width,
              ) as DashboardBlock["layout"]["width"];
            if (args.minHeight) block.layout.minHeight = Number(args.minHeight);
            if (name === "add_saved_illustration_card") {
              const saved = (project.generatedIllustrations ?? []).find(
                (asset) => asset.id === String(args.assetId),
              );
              if (!saved)
                throw new Error(
                  "Generated illustration was not found in this project's library.",
                );
              block.title = String(args.title ?? saved.name);
              block.illustration = {
                ...defaultIllustrationSettings(),
                preset: "custom",
                altText: String(args.altText ?? saved.altText),
                libraryAssetId: saved.id,
                bitmapMask: structuredClone(saved.bitmapMask),
              };
            }
            applySettingsArgs(block, args);
            if (
              name === "add_generated_illustration_card" &&
              block.type === "illustration" &&
              block.illustration.bitmapMask
            ) {
              const library = (project.generatedIllustrations ??= []);
              let saved = library.find(
                (asset) =>
                  asset.bitmapMask.encoding ===
                    block.illustration.bitmapMask!.encoding &&
                  asset.bitmapMask.width ===
                    block.illustration.bitmapMask!.width &&
                  asset.bitmapMask.height ===
                    block.illustration.bitmapMask!.height &&
                  asset.bitmapMask.bits === block.illustration.bitmapMask!.bits,
              );
              if (!saved) {
                const now = new Date().toISOString();
                saved = {
                  id: crypto.randomUUID(),
                  name: block.title,
                  altText: block.illustration.altText,
                  bitmapMask: structuredClone(block.illustration.bitmapMask),
                  createdAt: now,
                  updatedAt: now,
                };
                library.push(saved);
              }
              block.illustration.libraryAssetId = saved.id;
            }
            if (block.type === "gauge") validateGaugeSettings(block.gauge);
            if (block.type === "table") {
              validateTablePatch(block.table);
              validateBoundTableConfiguration(project, block);
            }
            if (block.type === "kpi") {
              if (!block.datasetId || !block.valueField)
                throw new TypeError(
                  "KPI tiles require a datasetId and valueField.",
                );
              validateNumericValueBinding(
                requiredAsset(project, block.datasetId),
                block.period ?? "latest",
                block.valueField,
                undefined,
                "KPI",
              );
            }
            if (block.type === "line") validateLineChartConfiguration(block);
            if (block.type === "line" && source === "webmcp")
              validateLineChartBinding(project, block);
            if (placeholder) dashboard.blocks[placeholderIndex] = block;
            else if (source === "webmcp")
              appendWebMCPBlock(dashboard.blocks, block, block.layout.width);
            else dashboard.blocks.push(block);
            dashboard.updatedAt = block.updatedAt;
            result = block;
          },
        );
        return result;
      },
    };
  }

  private updateActiveProject(
    tool: string,
    source: Source,
    summary: string,
    mutate: (project: TesseraProject) => void,
    log = true,
  ) {
    this.commit(tool, source, summary, (state) => {
      const next = structuredClone(state);
      const project = activeProject(next);
      mutate(project);
      const now = new Date().toISOString();
      project.updatedAt = now;
      if (log)
        project.activity.unshift({
          id: crypto.randomUUID(),
          at: now,
          source,
          tool,
          summary,
        });
      project.activity = project.activity.slice(0, 100);
      return next;
    });
  }

  private commit(
    tool: string,
    _source: Source,
    summary: string,
    updater: (state: TesseraState) => TesseraState,
  ) {
    if (tool === "activate_dashboard") {
      this.#context.setState(updater);
      return;
    }
    this.#context.setState(updater, {
      record: true,
      group:
        this.#activeCommand?.historyGroup ??
        defaultHistoryGroup(tool, this.#activeCommand?.args),
      label: summary,
    });
  }
}

function defaultHistoryGroup(
  tool: string,
  args: Record<string, unknown> | undefined,
) {
  if (tool !== "update_block" || !args) return undefined;
  const patch = args.patch;
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    return undefined;
  const fields = leafFieldPaths(patch as Record<string, unknown>);
  return `update_block:${String(args.dashboardId ?? "active")}:${String(
    args.blockId,
  )}:${fields.join(",")}`;
}

function leafFieldPaths(value: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(value)
    .flatMap(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      if (child && typeof child === "object" && !Array.isArray(child))
        return leafFieldPaths(child as Record<string, unknown>, path);
      return [path];
    })
    .sort();
}

function clearDatasetBinding(block: DashboardBlock, updatedAt: string) {
  delete block.datasetId;
  delete block.categoryField;
  delete block.labelField;
  delete block.seriesField;
  delete block.targetField;
  delete block.valueField;
  block.valueFields = [];
  block.period = "latest";
  block.table = {
    ...block.table,
    visibleColumns: [],
    sortColumn: "",
    sortDirection: "none",
    sortRules: [],
    totalColumns: [],
    colorByColumn: "",
    groupColors: [],
    columnStyles: [],
    cellStyles: [],
  };
  block.chart = {
    ...block.chart,
    barColorOverrides: [],
    lineSeriesStyles: [],
    linePointStyles: [],
    heatmapCellStyles: [],
    donutSliceStyles: [],
    treemapTileStyles: [],
    sankeyNodeOverrides: [],
    sankeyLinkOverrides: [],
    highlightNodes: [],
    scatterPointStyles: [],
  };
  block.updatedAt = updatedAt;
}

function applySettingsArgs(
  block: DashboardBlock,
  args: Record<string, unknown>,
) {
  if (args.barColorOverrides !== undefined)
    validateBarColorOverrides(args.barColorOverrides);
  if (args.cellStyles !== undefined && block.type === "table")
    validateTableCellStyles(args.cellStyles, "cellStyles");
  else if (args.cellStyles !== undefined)
    validateHeatmapCellStyles(args.cellStyles, "cellStyles");
  if (args.sliceStyles !== undefined)
    validateDonutSliceStyles(args.sliceStyles, "sliceStyles");
  if (args.tileStyles !== undefined)
    validateTreemapTileStyles(args.tileStyles, "tileStyles");
  if (args.nodeOverrides !== undefined && block.type === "sankey")
    validateSankeyNodeOverrides(args.nodeOverrides, "nodeOverrides");
  if (args.linkOverrides !== undefined && block.type === "sankey")
    validateSankeyLinkOverrides(args.linkOverrides, "linkOverrides");
  if (block.type === "illustration") {
    const illustration = {
      ...(block.illustration ?? defaultIllustrationSettings()),
    };
    if (args.altText !== undefined)
      illustration.altText = String(args.altText).trim();
    if (args.primaryColor !== undefined)
      illustration.primaryColor = String(args.primaryColor);
    if (args.showCaption !== undefined)
      illustration.showCaption = Boolean(args.showCaption);
    if (args.preset !== undefined)
      illustration.preset =
        args.preset as DashboardBlock["illustration"]["preset"];
    if (args.preset !== undefined) {
      illustration.bitmapMask = null;
      illustration.libraryAssetId = "";
    }
    if (args.maskPng !== undefined) {
      if (args.styleContract !== ILLUSTRATION_STYLE_CONTRACT_VERSION)
        throw new TypeError(
          `styleContract must be ${ILLUSTRATION_STYLE_CONTRACT_VERSION}.`,
        );
      if (args.maskEncoding !== ILLUSTRATION_ALPHA_MASK_ENCODING)
        throw new TypeError(
          `maskEncoding must be ${ILLUSTRATION_ALPHA_MASK_ENCODING}.`,
        );
      illustration.preset = "custom";
      illustration.bitmapMask = {
        encoding: ILLUSTRATION_ALPHA_MASK_ENCODING,
        contractVersion: ILLUSTRATION_STYLE_CONTRACT_VERSION,
        width: Number(args.maskWidth),
        height: Number(args.maskHeight),
        bits: String(args.maskPng),
      };
      illustration.libraryAssetId = "";
      illustration.elements = [];
    }
    validateIllustrationSettings(illustration);
    block.illustration = illustration;
  }
  const chartMap: Record<string, keyof DashboardBlock["chart"]> = {
    showValues: "showValues",
    showLegend: "showLegend",
    legendPosition: "legendPosition",
    showGridlines: "showGridlines",
    showXAxis: "showXAxis",
    showYAxis: "showYAxis",
    showPoints: "showPoints",
    showAverageLine: "showAverageLine",
    showMinLine: "showMinLine",
    showMaxLine: "showMaxLine",
    showReferenceLine: "showReferenceLine",
    sortOrder: "sortOrder",
    valueFormat: "valueFormat",
    decimalPlaces: "decimalPlaces",
    colors: "colors",
    referenceLabel: "referenceLabel",
    barRadius: "barRadius",
    barGap: "barGap",
    barColorOverrides: "barColorOverrides",
    lineWidth: "lineWidth",
    curve: "curve",
    lineDash: "lineDash",
    pointSize: "pointSize",
    connectNulls: "connectNulls",
    fillArea: "fillArea",
    areaOpacity: "areaOpacity",
    seriesStyles: "lineSeriesStyles",
    pointStyles: "linePointStyles",
    donutHole: "donutHole",
    donutCenterLabel: "donutCenterLabel",
    sliceStyles: "donutSliceStyles",
    tileStyles: "treemapTileStyles",
    seriesOpacity: "seriesOpacity",
    xAxisTitle: "xAxisTitle",
    yAxisTitle: "yAxisTitle",
    xValueFormat: "xValueFormat",
    xDecimalPlaces: "xDecimalPlaces",
    minX: "minX",
    maxX: "maxX",
    minY: "minY",
    maxY: "maxY",
    includeZero: "scatterIncludeZero",
    pointStroke: "scatterPointStroke",
    pointStrokeWidth: "scatterPointStrokeWidth",
    showTrendLine: "scatterShowTrendLine",
    trendLineColor: "scatterTrendLineColor",
    xReferenceValue: "scatterXReferenceValue",
    xReferenceLabel: "scatterXReferenceLabel",
    yReferenceValue: "scatterYReferenceValue",
    yReferenceLabel: "scatterYReferenceLabel",
    nodeWidth: "sankeyNodeWidth",
    nodeGap: "sankeyNodeGap",
    linkOpacity: "sankeyLinkOpacity",
    linkThickness: "sankeyLinkThickness",
    stageLabels: "sankeyStageLabels",
    showStageHeaders: "sankeyShowStageHeaders",
    showNodeLabels: "sankeyShowNodeLabels",
    showLinkValues: "sankeyShowLinkValues",
    showShares: "sankeyShowShares",
    linkColorMode: "sankeyLinkColorMode",
    nodeSort: "sankeyNodeSort",
    nodeOverrides: "sankeyNodeOverrides",
    linkOverrides: "sankeyLinkOverrides",
    highlightNodes: "highlightNodes",
    scaleType: "heatmapScaleType",
    scaleScope: "heatmapScaleScope",
    minColor: "heatmapMinColor",
    midColor: "heatmapMidColor",
    maxColor: "heatmapMaxColor",
    midpoint: "heatmapMidpoint",
    minValue: "heatmapMinValue",
    maxValue: "heatmapMaxValue",
    reverseScale: "heatmapReverse",
    missingColor: "heatmapMissingColor",
    cellGap: "heatmapCellGap",
    cellRadius: "heatmapCellRadius",
    cellStyles: "heatmapCellStyles",
  };
  Object.entries(chartMap).forEach(([input, target]) => {
    if (
      block.type === "scatter" &&
      (input === "pointSize" || input === "pointStyles")
    )
      return;
    if (block.type === "table" && input === "cellStyles") return;
    if (args[input] !== undefined)
      (block.chart as unknown as Record<string, unknown>)[target] = args[input];
  });
  if (args.pointShape !== undefined) {
    if (block.type === "scatter")
      block.chart.scatterPointShape =
        args.pointShape as DashboardBlock["chart"]["scatterPointShape"];
    else
      block.chart.pointShape =
        args.pointShape as DashboardBlock["chart"]["pointShape"];
  }
  if (block.type === "scatter") {
    if (
      args.minX !== undefined &&
      args.maxX !== undefined &&
      Number(args.minX) >= Number(args.maxX)
    )
      throw new TypeError("minX must be less than maxX.");
    if (
      args.minY !== undefined &&
      args.maxY !== undefined &&
      Number(args.minY) >= Number(args.maxY)
    )
      throw new TypeError("minY must be less than maxY.");
    if (args.pointSize !== undefined)
      block.chart.scatterPointSize = Number(args.pointSize);
    if (args.pointStyles !== undefined) {
      validateScatterPointStyles(args.pointStyles, "pointStyles");
      block.chart.scatterPointStyles =
        args.pointStyles as DashboardBlock["chart"]["scatterPointStyles"];
    }
  }
  if (args.referenceValue !== undefined) {
    block.chart.referenceValue = Number(args.referenceValue);
    block.chart.showReferenceLine = true;
  }
  if (block.type === "gauge") {
    const gauge = block.gauge ?? defaultGaugeSettings();
    const gaugeMap: Record<string, keyof DashboardBlock["gauge"]> = {
      aggregation: "aggregation",
      display: "display",
      valueLabel: "valueLabel",
      targetLabel: "targetLabel",
      showValue: "showValue",
      showTarget: "showTarget",
      showScaleLabels: "showScaleLabels",
      showPercentOfTarget: "showPercentOfTarget",
      showRangeLabels: "showRangeLabels",
      arcWidth: "arcWidth",
      roundedEnds: "roundedEnds",
      ranges: "ranges",
    };
    Object.entries(gaugeMap).forEach(([input, target]) => {
      if (args[input] !== undefined)
        (gauge as unknown as Record<string, unknown>)[target] = args[input];
    });
    if (args.minY !== undefined) gauge.min = Number(args.minY);
    if (args.maxY !== undefined) gauge.max = Number(args.maxY);
    if (args.targetValue !== undefined)
      gauge.targetValue = Number(args.targetValue);
    const colorMap: Record<string, keyof DashboardBlock["gauge"]["colors"]> = {
      trackColor: "track",
      valueColor: "value",
      targetColor: "target",
      needleColor: "needle",
    };
    Object.entries(colorMap).forEach(([input, target]) => {
      if (args[input] !== undefined) gauge.colors[target] = String(args[input]);
    });
    block.gauge = gauge;
  }
  if (block.type === "kpi" && args.aggregation)
    block.kpi.aggregation =
      args.aggregation as DashboardBlock["kpi"]["aggregation"];
  if (block.type === "kpi" && args.valueFormat)
    block.kpi.valueFormat =
      args.valueFormat as DashboardBlock["kpi"]["valueFormat"];
  if (block.type === "kpi" && args.decimalPlaces !== undefined)
    block.kpi.decimalPlaces = Number(args.decimalPlaces);
  if (block.type === "kpi" && args.prefix !== undefined)
    block.kpi.prefix = String(args.prefix);
  if (block.type === "kpi" && args.suffix !== undefined)
    block.kpi.suffix = String(args.suffix);
  if (block.type === "kpi" && args.icon)
    block.kpi.icon = args.icon as DashboardBlock["kpi"]["icon"];
  if (block.type === "kpi" && args.showProgress !== undefined)
    block.kpi.showProgress = Boolean(args.showProgress);
  if (block.type === "kpi" && args.positiveDirection)
    block.kpi.positiveDirection =
      args.positiveDirection as DashboardBlock["kpi"]["positiveDirection"];
  if (args.targetValue !== undefined && block.type === "kpi")
    block.kpi.targetValue = Number(args.targetValue);
  if (block.type === "kpi" && args.comparisonValue !== undefined)
    block.kpi.comparisonValue = Number(args.comparisonValue);
  if (block.type === "kpi" && args.comparisonLabel !== undefined)
    block.kpi.comparisonLabel = String(args.comparisonLabel);
  if (block.type === "table" && Array.isArray(args.visibleColumns))
    block.table.visibleColumns = args.visibleColumns.map(String);
  if (block.type === "table" && args.rowLimit !== undefined)
    block.table.rowLimit = Number(args.rowLimit);
  const tableMap: Record<string, keyof DashboardBlock["table"]> = {
    sortColumn: "sortColumn",
    sortDirection: "sortDirection",
    sortRules: "sortRules",
    compact: "compact",
    striped: "striped",
    rowGridlines: "rowGridlines",
    showTotals: "showTotals",
    totalsLabel: "totalsLabel",
    totalColumns: "totalColumns",
    showSearch: "showSearch",
    showDatasetName: "showDatasetName",
    showRowCount: "showRowCount",
    showRowNumbers: "showRowNumbers",
    showColumnHeaders: "showColumnHeaders",
    columnGridlines: "columnGridlines",
    stickyHeader: "stickyHeader",
    freezeFirstColumn: "freezeFirstColumn",
    boldLastRow: "boldLastRow",
    numberFormat: "numberFormat",
    decimalPlaces: "decimalPlaces",
    nullDisplay: "nullDisplay",
    negativeParens: "negativeParens",
    negativeRed: "negativeRed",
    wrapText: "wrapText",
    heatmap: "heatmap",
    heatmapColor: "heatmapColor",
    headerBackgroundColor: "headerBackgroundColor",
    headerTextColor: "headerTextColor",
    rowBackgroundColor: "rowBackgroundColor",
    alternateRowBackgroundColor: "alternateRowBackgroundColor",
    cellTextColor: "cellTextColor",
    gridColor: "gridColor",
    colorByColumn: "colorByColumn",
    groupPalette: "groupPalette",
    groupColors: "groupColors",
    columnStyles: "columnStyles",
    cellStyles: "cellStyles",
  };
  Object.entries(tableMap).forEach(([input, target]) => {
    if (block.type === "table" && args[input] !== undefined)
      (block.table as unknown as Record<string, unknown>)[target] = args[input];
  });
  const styleMap: Record<string, keyof DashboardBlock["style"]> = {
    accent: "accent",
    textColor: "textColor",
    alignH: "alignH",
    alignV: "alignV",
    fontScale: "fontScale",
    padding: "padding",
    cornerRadius: "cornerRadius",
    border: "border",
    shadow: "shadow",
  };
  Object.entries(styleMap).forEach(([input, target]) => {
    if (args[input] !== undefined)
      (block.style as unknown as Record<string, unknown>)[target] = args[input];
  });
}

function initialMonthProcessing(now: string): DatasetMonthProcessing {
  return {
    stage: "uploaded",
    progress: 5,
    message: "Original workbook saved; no clean fields exist yet",
    updatedAt: now,
    variableMappings: [],
    questions: [],
    qualityChecks: [],
    recipeRevision: 1,
  };
}

function ensureMonthProcessing(month: DatasetMonth): DatasetMonthProcessing {
  if (!month.processing) {
    const now = new Date().toISOString();
    month.processing =
      month.status === "pending"
        ? initialMonthProcessing(now)
        : {
            ...initialMonthProcessing(now),
            stage: "approved",
            progress: 100,
            message: "Approved and available to dashboards",
          };
  }
  return month.processing;
}

function monthProcessingView(month: DatasetMonth): DatasetMonthProcessing {
  if (month.processing) return month.processing;
  const fallback = initialMonthProcessing(month.importedAt);
  return month.status === "pending"
    ? fallback
    : {
        ...fallback,
        stage: "approved",
        progress: 100,
        message: "Approved and available to dashboards",
      };
}

function normalizeSourceWorkbook(
  workbook: SourceWorkbook,
  fallbackName: string,
): SourceWorkbook {
  if (!workbook || !Array.isArray(workbook.sheets) || !workbook.sheets.length)
    throw new Error("The upload must contain at least one worksheet.");
  return {
    fileName: String(workbook.fileName || fallbackName),
    ...(Number.isFinite(workbook.byteLength)
      ? { byteLength: Number(workbook.byteLength) }
      : {}),
    ...(workbook.checksum ? { checksum: String(workbook.checksum) } : {}),
    ...(workbook.storageKey ? { storageKey: String(workbook.storageKey) } : {}),
    ...(workbook.contentType
      ? { contentType: String(workbook.contentType) }
      : {}),
    sheets: workbook.sheets.map((sheet, index) => {
      const rows = Array.isArray(sheet.rows)
        ? sheet.rows.map((row) => (Array.isArray(row) ? [...row] : []))
        : [];
      const columnCount = rows.reduce(
        (widest, row) => Math.max(widest, row.length),
        Number(sheet.columnCount) || 0,
      );
      return {
        name: String(sheet.name || `Sheet ${index + 1}`),
        rowCount: Math.max(Number(sheet.rowCount) || 0, rows.length),
        columnCount,
        rows,
        regions: Array.isArray(sheet.regions)
          ? sheet.regions.map(normalizeWorksheetRegion)
          : [],
      };
    }),
  };
}

function normalizeWorksheetRegion(region: WorksheetRegion): WorksheetRegion {
  const startRow = Math.max(1, Math.round(Number(region.range?.startRow) || 1));
  const startColumn = Math.max(
    1,
    Math.round(Number(region.range?.startColumn) || 1),
  );
  const endRow = Math.max(
    startRow + 1,
    Math.round(Number(region.range?.endRow) || 0),
  );
  const endColumn = Math.max(
    startColumn,
    Math.round(Number(region.range?.endColumn) || 0),
  );
  return {
    id: String(region.id || crypto.randomUUID()),
    ...(region.sheet ? { sheet: String(region.sheet) } : {}),
    name: String(region.name || "Detected table"),
    kind:
      region.kind === "narrative" || region.kind === "footnote"
        ? region.kind
        : "table",
    confidence: Math.min(1, Math.max(0, Number(region.confidence) || 0)),
    canonicalName: String(region.canonicalName || region.name || "Table"),
    range: { startRow, startColumn, endRow, endColumn },
  };
}

function normalizeVariableMapping(
  mapping: DatasetVariableMapping,
): DatasetVariableMapping {
  return {
    source: String(mapping.source),
    canonical: String(mapping.canonical),
    confidence: Math.min(1, Math.max(0, Number(mapping.confidence) || 0)),
    ...(mapping.matchedFromPrevious
      ? { matchedFromPrevious: String(mapping.matchedFromPrevious) }
      : {}),
    ...(mapping.usedByCharts ? { usedByCharts: true } : {}),
    ...(mapping.confirmed ? { confirmed: true } : {}),
  };
}

function normalizeCleaningQuestion(
  question: DatasetCleaningQuestion,
): DatasetCleaningQuestion {
  const choices = Array.isArray(question.choices)
    ? question.choices.map((choice, index) => ({
        id: String(choice.id || `choice-${index + 1}`),
        label: String(choice.label),
        ...(choice.description
          ? { description: String(choice.description) }
          : {}),
      }))
    : [];
  if (choices.length < 2)
    throw new Error(
      `Question "${String(question.prompt)}" needs at least two choices.`,
    );
  return {
    id: String(question.id || crypto.randomUUID()),
    prompt: String(question.prompt),
    ...(question.detail ? { detail: String(question.detail) } : {}),
    choices,
    ...(question.recommendedChoiceId
      ? { recommendedChoiceId: String(question.recommendedChoiceId) }
      : {}),
    ...(question.answerChoiceId
      ? { answerChoiceId: String(question.answerChoiceId) }
      : {}),
  };
}

function applyRegionsToMonthSource(
  month: DatasetMonth,
  regions: WorksheetRegion[],
) {
  if (month.sourceWorkbook) {
    const sheets = month.sourceWorkbook.sheets;
    const unknown = regions.find(
      (region) =>
        region.sheet && !sheets.some((sheet) => sheet.name === region.sheet),
    );
    if (unknown) throw new Error(`Unknown worksheet: ${unknown.sheet}.`);
    sheets.forEach((sheet, index) => {
      sheet.regions = regions
        .filter((region) =>
          region.sheet ? region.sheet === sheet.name : index === 0,
        )
        .map((region) => ({ ...region, sheet: sheet.name }));
    });
    const active = month.sourceWorkbook.sheets.find(
      (sheet) => sheet.name === month.sourceWorksheet?.name,
    );
    month.sourceWorksheet = active ?? month.sourceWorkbook.sheets[0];
  } else if (month.sourceWorksheet) {
    month.sourceWorksheet.regions = regions;
  }
}

function latestReadyMonthBefore(asset: DataAsset, period: string) {
  return [...asset.months]
    .filter((month) => month.status !== "pending" && month.period < period)
    .sort((a, b) => b.period.localeCompare(a.period))[0];
}

function chartCriticalFields(project: TesseraProject, datasetId: string) {
  const fields = new Set<string>();
  project.dashboards.forEach((dashboard) =>
    dashboard.blocks.forEach((block) => {
      if (block.datasetId !== datasetId) return;
      [
        block.categoryField,
        block.labelField,
        block.seriesField,
        block.valueField,
        block.targetField,
        ...block.valueFields,
      ].forEach((field) => {
        if (field) fields.add(field);
      });
    }),
  );
  return [...fields];
}

function processingSnapshot(
  asset: DataAsset,
  month: DatasetMonth,
  project: TesseraProject,
  includeSource = false,
) {
  const processing = monthProcessingView(month);
  const prior = latestReadyMonthBefore(asset, month.period);
  const source =
    month.sourceWorkbook ??
    (month.sourceWorksheet
      ? {
          fileName: month.sourceName,
          sheets: [month.sourceWorksheet],
        }
      : undefined);
  return {
    dataset: { id: asset.id, name: asset.name },
    month: {
      id: month.id,
      period: month.period,
      label: month.label,
      status: month.status ?? "ready",
      sourceName: month.sourceName,
    },
    processing: structuredClone(processing),
    tableRegions:
      source?.sheets.flatMap((sheet) =>
        sheet.regions.map((region) => ({ ...region, sheet: sheet.name })),
      ) ?? [],
    priorApproved: prior
      ? {
          period: prior.period,
          label: prior.label,
          columns: prior.cleaned.columns,
          rows: prior.cleaned.rows.length,
        }
      : null,
    chartCriticalFields: chartCriticalFields(project, asset.id),
    savedHeaderMap: asset.recipe.headerMap,
    cleanedDraft:
      processing.stage === "review" || processing.stage === "approved"
        ? month.cleaned
        : undefined,
    refresh: monthlyRefreshStatus(project, month.period),
    ...(includeSource && source ? { source } : {}),
  };
}

function tableFromConfirmedMonthRegion(month: DatasetMonth): DataTable {
  const workbook =
    month.sourceWorkbook ??
    (month.sourceWorksheet
      ? { fileName: month.sourceName, sheets: [month.sourceWorksheet] }
      : undefined);
  const candidate = workbook?.sheets
    .flatMap((sheet) =>
      sheet.regions
        .filter((region) => region.kind === "table")
        .map((region) => ({ sheet, region })),
    )
    .sort((a, b) => b.region.confidence - a.region.confidence)[0];
  if (!candidate) return month.original;
  const { sheet, region } = candidate;
  const width = region.range.endColumn - region.range.startColumn + 1;
  const headerRow = sheet.rows[region.range.startRow - 1] ?? [];
  const columns = Array.from({ length: width }, (_, offset) => {
    const value = headerRow[region.range.startColumn - 1 + offset];
    return String(value ?? `Column ${offset + 1}`);
  });
  const rows = sheet.rows
    .slice(region.range.startRow, region.range.endRow)
    .map((row) =>
      Array.from(
        { length: width },
        (_, offset) => row[region.range.startColumn - 1 + offset] ?? null,
      ),
    );
  return { columns, rows };
}

function qualityChecksForDraft(
  prior: DataTable | undefined,
  prepared: DataTable,
  schema: ReturnType<typeof schemaCompatibility>,
  profile: ReturnType<typeof profileTable>,
) {
  const checks: DatasetMonthProcessing["qualityChecks"] = [
    {
      id: "schema",
      label: "Prior-month schema",
      status: schema.compatible ? "pass" : "fail",
      detail: prior
        ? schema.compatible
          ? `${schema.retained.length} prior field${schema.retained.length === 1 ? "" : "s"} retained; ${schema.added.length} added`
          : `${schema.missing.length} canonical field${schema.missing.length === 1 ? "" : "s"} missing`
        : "First approved month establishes the canonical schema",
    },
    {
      id: "rows",
      label: "Publishable rows",
      status: prepared.rows.length ? "pass" : "fail",
      detail: `${prepared.rows.length} non-empty row${prepared.rows.length === 1 ? "" : "s"} prepared`,
    },
    {
      id: "completeness",
      label: "Completeness",
      status:
        profile.completeness >= 0.9
          ? "pass"
          : profile.completeness >= 0.7
            ? "review"
            : "fail",
      detail: `${Math.round(profile.completeness * 100)}% of clean cells are populated`,
    },
  ];
  return checks;
}

function monthlyRefreshStatus(project: TesseraProject, period: string) {
  const datasets = project.warehouse.map((asset) => {
    const month = asset.months.find((candidate) => candidate.period === period);
    const processing = month ? monthProcessingView(month) : undefined;
    return {
      datasetId: asset.id,
      datasetName: asset.name,
      present: Boolean(month),
      status: month?.status ?? "missing",
      stage: processing?.stage ?? "missing",
      progress: processing?.progress ?? 0,
      message: processing?.message ?? "Upload needed",
      questionsRemaining:
        processing?.questions.filter((question) => !question.answerChoiceId)
          .length ?? 0,
    };
  });
  const approved = datasets.filter((dataset) => dataset.status === "ready");
  return {
    period,
    label: periodLabel(period),
    approved: approved.length,
    total: datasets.length,
    allApproved:
      Boolean(datasets.length) && approved.length === datasets.length,
    datasets,
  };
}

function cleanWithRecipe(
  original: DataTable,
  recipe: Record<string, string>,
  canonicalColumns: string[] = [],
  period?: string,
) {
  if (
    period &&
    detectLayout(original, recipe, canonicalColumns) === "metricRows"
  )
    return pivotMetricRows(original, recipe, canonicalColumns, period);
  const cleaned = cleanImportedTable(original);
  const renamedByRecipe: Record<string, string> = {};
  const used = new Map<string, number>();
  const canonicalByNormalizedHeader = new Map(
    canonicalColumns.map((column) => [normalizedHeaderKey(column), column]),
  );
  const columns = cleaned.table.columns.map((column) => {
    const source = Object.entries(cleaned.headerMap).find(
      ([, normalized]) => normalized === column,
    )?.[0];
    const requested =
      canonicalByNormalizedHeader.get(column) ??
      (source ? recipe[source] : undefined);
    const base = requested?.trim() || column;
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    const next = count === 1 ? base : `${base} ${count}`;
    if (source) renamedByRecipe[source] = next;
    return next;
  });
  const recipeMatches = Object.entries(renamedByRecipe).filter(
    ([source, target]) => recipe[source] === target,
  ).length;
  return {
    table: { ...cleaned.table, columns },
    headerMap: { ...cleaned.headerMap, ...renamedByRecipe },
    summary: [
      ...cleaned.summary,
      ...(recipeMatches
        ? [
            `${recipeMatches} saved field mapping${recipeMatches === 1 ? "" : "s"} reapplied`,
          ]
        : []),
    ],
  };
}

function normalizedHeaderKey(column: string) {
  return column
    .trim()
    .toLowerCase()
    .replace(/[%]/g, " pct ")
    .replace(/[$]/g, " usd ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function executiveDashboardFromAsset(
  asset: DataAsset,
  name: string,
  audience: string,
  source: Source,
): Dashboard {
  const now = new Date().toISOString();
  const latest = selectedReadyMonth(asset);
  const table = latest?.cleaned;
  const numeric =
    table?.columns.filter((_, column) =>
      table.rows.some((row) => typeof row[column] === "number"),
    ) ?? [];
  const dimensions =
    table?.columns.filter((column) => !numeric.includes(column)) ?? [];
  const category =
    dimensions.find((column) => !/status|note|narrative/i.test(column)) ??
    dimensions[0] ??
    table?.columns[0];
  const dashboard = createDashboard(name, latest?.period);
  dashboard.description = audience;
  dashboard.createdAt = now;
  dashboard.updatedAt = now;
  dashboard.blocks = [
    createBlock(
      "sectionHeader",
      {
        eyebrow: `${latest?.label?.toUpperCase() ?? "LATEST"} · CLEAN DATA`,
        title: name,
        subtitle: audience,
        chip: "Executive view",
        layout: { width: 12, minHeight: 132 },
        style: {
          ...createBlock("sectionHeader").style,
          background: "#f5f7fb",
          border: false,
          shadow: "none",
        },
      },
      source,
    ),
    createBlock(
      "text",
      {
        title: "How to read this page",
        body: `• Headline metrics use ${latest?.label ?? "the latest clean month"}.\n• Midline charts explain mix and movement.\n• The appendix keeps the underlying records visible for follow-up.`,
        layout: { width: 12, minHeight: 116 },
      },
      source,
    ),
    ...numeric.slice(0, 3).map((field) =>
      createBlock(
        "kpi",
        {
          title: field,
          datasetId: asset.id,
          period: "latest",
          valueField: field,
          layout: { width: 4, minHeight: 168 },
        },
        source,
      ),
    ),
    ...(category && numeric[0]
      ? [
          createBlock(
            "bar",
            {
              title: `${numeric[0]} by ${category}`,
              subtitle:
                "Sorted to make the largest contributors immediately visible.",
              datasetId: asset.id,
              period: "latest",
              categoryField: category,
              valueField: numeric[0],
              valueFields: [numeric[0]],
              layout: { width: 12, minHeight: 340 },
              chart: {
                ...createBlock("bar").chart,
                showValues: true,
                showLegend: false,
                sortOrder: "descending",
                valueFormat: "compact",
              },
            },
            source,
          ),
        ]
      : []),
    createBlock(
      "table",
      {
        title: `${asset.name} detail`,
        subtitle: "Appendix · cleaned, traceable records",
        datasetId: asset.id,
        period: "latest",
        layout: { width: 12, minHeight: 340 },
        table: {
          ...createBlock("table").table,
          compact: true,
          striped: true,
          showSearch: true,
          showRowNumbers: true,
          rowLimit: 50,
        },
      },
      source,
    ),
  ];
  if (latest)
    dashboard.blocks = dashboard.blocks.map((block) =>
      block.datasetId ? { ...block, period: latest.period } : block,
    );
  return dashboard;
}

function summarizeFastBuildResult(toolName: string, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { toolName, result: value };
  const item = value as Record<string, unknown>;
  return {
    toolName,
    ...(typeof item.id === "string" ? { id: item.id } : {}),
    ...(typeof item.name === "string" ? { name: item.name } : {}),
    ...(typeof item.type === "string" ? { type: item.type } : {}),
    ...(typeof item.title === "string" ? { title: item.title } : {}),
    ...(typeof item.buildState === "string"
      ? { buildState: item.buildState }
      : {}),
    ...(item.layout && typeof item.layout === "object"
      ? { layout: item.layout }
      : {}),
  };
}

function waitForFastDashboardReveal(
  toolName: (typeof FAST_DASHBOARD_BUILD_OPERATIONS)[number],
  holdBeforeNextStep: boolean,
  reveal?: (delayMs: number) => Promise<void>,
) {
  const delay = holdBeforeNextStep
    ? toolName === "create_dashboard"
      ? FAST_DASHBOARD_OPEN_REVEAL_MS
      : FAST_DASHBOARD_STEP_REVEAL_MS
    : 0;
  if (reveal) return reveal(delay);
  return new Promise<void>((resolve) => setTimeout(resolve, delay));
}

function normalizeFastDashboardArguments(
  toolName: (typeof FAST_DASHBOARD_BUILD_OPERATIONS)[number],
  arguments_: Record<string, unknown>,
) {
  const normalized = { ...arguments_ };
  if (toolName !== "add_kpi") return normalized;

  const requestedDirection =
    normalized.positiveDirection ?? normalized.direction;
  delete normalized.direction;
  if (requestedDirection === undefined || requestedDirection === null) {
    delete normalized.positiveDirection;
    return normalized;
  }

  const direction = normalizeKpiPositiveDirection(requestedDirection);
  if (direction) normalized.positiveDirection = direction;
  else delete normalized.positiveDirection;
  return normalized;
}

function normalizeKpiPositiveDirection(value: unknown): "up" | "down" | null {
  if (typeof value !== "string") return null;
  const token = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();
  if (
    [
      "up",
      "higher",
      "increase",
      "increasing",
      "ascending",
      "maximize",
      "higher is better",
      "high is good",
    ].includes(token)
  )
    return "up";
  if (
    [
      "down",
      "lower",
      "decrease",
      "decreasing",
      "descending",
      "minimize",
      "lower is better",
      "low is good",
    ].includes(token)
  )
    return "down";
  return null;
}

function requiredDashboard(project: TesseraProject, id: string) {
  const dashboard = project.dashboards.find((candidate) => candidate.id === id);
  if (!dashboard) throw new Error("Dashboard not found.");
  return dashboard;
}

function dashboardInspectionView(dashboard: Dashboard) {
  const view = structuredClone(dashboard);
  const blocks = view.blocks as unknown as Array<Record<string, unknown>>;
  blocks.forEach((block) => {
    const type = String(block.type);
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
    ].includes(type);
    if (type !== "table") delete block.table;
    if (type !== "kpi") delete block.kpi;
    if (type !== "gauge") delete block.gauge;
    if (type !== "illustration") delete block.illustration;
    else {
      const illustration = block.illustration as
        Record<string, unknown> | undefined;
      const mask = illustration?.bitmapMask as
        Record<string, unknown> | null | undefined;
      if (mask)
        illustration!.bitmapMask = {
          encoding: mask.encoding,
          contractVersion: mask.contractVersion,
          width: mask.width,
          height: mask.height,
          packedByteLength: illustrationMaskPayloadByteLength(
            mask as unknown as DashboardBlock["illustration"]["bitmapMask"] &
              object,
          ),
          pixelsStored: true,
        };
    }
    if (!isChart) delete block.chart;
  });
  return view;
}

function requiredMonth(asset: DataAsset, period: unknown) {
  const month = period
    ? asset.months.find((candidate) => candidate.period === String(period))
    : [...asset.months].sort((a, b) => b.period.localeCompare(a.period))[0];
  if (!month) throw new Error("Dataset month not found.");
  return month;
}

function schemaCompatibility(priorColumns: string[], nextColumns: string[]) {
  const key = (column: string) => column.trim().toLocaleLowerCase();
  const priorKeys = new Set(priorColumns.map(key));
  const nextKeys = new Set(nextColumns.map(key));
  const added = nextColumns.filter((column) => !priorKeys.has(key(column)));
  const missing = priorColumns.filter((column) => !nextKeys.has(key(column)));
  const retained = nextColumns.filter((column) => priorKeys.has(key(column)));
  const requiredRetained = Math.max(1, Math.ceil(priorColumns.length * 0.65));
  const allowedMissing = Math.max(1, Math.floor(priorColumns.length * 0.35));
  return {
    added,
    missing,
    retained,
    compatible:
      priorColumns.length === 0 ||
      (retained.length >= requiredRetained && missing.length <= allowedMissing),
  };
}

function requiredAsset(project: TesseraProject, id: string) {
  const asset = project.warehouse.find((candidate) => candidate.id === id);
  if (!asset) throw new Error("Dataset not found in the active project.");
  return asset;
}

function validateBarBinding(
  asset: DataAsset,
  period: string,
  categoryField: string,
  valueFields: string[],
  type: BlockType,
) {
  const table = tableForAssetPeriodOrUndefined(asset, period);
  if (!table)
    throw new Error(
      `Dataset ${asset.id} has no data for period ${period}. Available periods: ${asset.months.map((month) => month.period).join(", ") || "none"}.`,
    );
  if (!table.columns.includes(categoryField))
    throw new Error(
      `Category field "${categoryField}" was not found in dataset ${asset.id}. Available fields: ${table.columns.join(", ")}.`,
    );
  const numeric = numericColumns(table);
  const invalid = valueFields.filter((field) => !numeric.includes(field));
  if (invalid.length)
    throw new Error(
      `Bar value field${invalid.length === 1 ? "" : "s"} ${invalid.map((field) => `"${field}"`).join(", ")} must be numeric fields in dataset ${asset.id}. Available numeric fields: ${numeric.join(", ") || "none"}.`,
    );
  if (type !== "groupedBar" && valueFields.length !== 1)
    throw new Error(
      "A standard or horizontal bar chart requires one value field.",
    );
  if (
    type === "groupedBar" &&
    (valueFields.length < 2 || valueFields.length > 4)
  )
    throw new Error("A grouped bar chart requires two to four value fields.");
}

function validateHeatmapBinding(
  asset: DataAsset,
  period: string,
  categoryField: string,
  valueFields: string[],
) {
  const table = tableForAssetPeriodOrUndefined(asset, period);
  if (!table)
    throw new Error(
      `Dataset ${asset.id} has no data for period ${period}. Available periods: ${asset.months.map((month) => month.period).join(", ") || "none"}.`,
    );
  if (!table.columns.includes(categoryField))
    throw new Error(
      `Heatmap row field "${categoryField}" was not found. Available fields: ${table.columns.join(", ")}.`,
    );
  const numeric = numericColumns(table);
  const invalid = valueFields.filter((field) => !numeric.includes(field));
  if (invalid.length)
    throw new Error(
      `Heatmap value field${invalid.length === 1 ? "" : "s"} ${invalid.map((field) => `"${field}"`).join(", ")} must be numeric. Available numeric fields: ${numeric.join(", ") || "none"}.`,
    );
  if (valueFields.length > 24)
    throw new Error(
      "A heatmap supports at most 24 value fields so column labels remain readable.",
    );
}

function validateScatterBinding(
  asset: DataAsset,
  period: string,
  xField: string,
  yField: string,
  labelField?: string,
  seriesField?: string,
) {
  const table = tableForAssetPeriodOrUndefined(asset, period);
  if (!table)
    throw new Error(
      `Dataset ${asset.id} has no data for period ${period}. Available periods: ${asset.months.map((month) => month.period).join(", ") || "none"}.`,
    );
  const numeric = numericColumns(table);
  const invalidNumeric = [xField, yField].filter(
    (field) => !numeric.includes(field),
  );
  if (invalidNumeric.length)
    throw new Error(
      `Scatter X and Y fields must be numeric. Invalid: ${invalidNumeric.join(", ")}. Available numeric fields: ${numeric.join(", ") || "none"}.`,
    );
  [labelField, seriesField].forEach((field) => {
    if (field && !table.columns.includes(field))
      throw new Error(
        `Scatter field "${field}" was not found. Available fields: ${table.columns.join(", ")}.`,
      );
  });
  const validPoints = table.rows.filter((row) => {
    const x = row[table.columns.indexOf(xField)];
    const y = row[table.columns.indexOf(yField)];
    return (
      typeof x === "number" &&
      Number.isFinite(x) &&
      typeof y === "number" &&
      Number.isFinite(y)
    );
  }).length;
  if (validPoints < 2)
    throw new Error(
      "A scatter chart requires at least two rows with valid X and Y values.",
    );
}

function tableForAssetPeriod(asset: DataAsset, period: string) {
  const table = tableForAssetPeriodOrUndefined(asset, period);
  if (!table)
    throw new Error(
      `Dataset ${asset.id} has no data for period ${period}. Available periods: ${asset.months.map((month) => month.period).join(", ") || "none"}.`,
    );
  return table;
}

function tableForAssetPeriodOrUndefined(asset: DataAsset, period: string) {
  const cutoff = throughPeriodCutoff(period);
  return period === "all" || cutoff
    ? combineAssetMonths(asset, cutoff)
    : selectedReadyMonth(asset, period)?.cleaned;
}

function validateCategoryValueBinding(
  asset: DataAsset,
  period: string,
  categoryField: string,
  valueField: string,
  type: "donut" | "treemap",
) {
  const table = tableForAssetPeriod(asset, period);
  if (!table.columns.includes(categoryField))
    throw new Error(
      `${type} category field "${categoryField}" was not found. Available fields: ${table.columns.join(", ")}.`,
    );
  if (!numericColumns(table).includes(valueField))
    throw new Error(
      `${type} value field "${valueField}" must be numeric. Available numeric fields: ${numericColumns(table).join(", ") || "none"}.`,
    );
  const valueIndex = table.columns.indexOf(valueField);
  const values = table.rows
    .map((row) => row[valueIndex])
    .filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value),
    );
  if (!values.some((value) => value > 0))
    throw new Error(`A ${type} requires at least one positive value.`);
  if (values.some((value) => value < 0))
    throw new Error(`A ${type} cannot represent negative values.`);
}

function validateNetworkBinding(
  asset: DataAsset,
  period: string,
  sourceField: string,
  targetField: string,
  valueField: string | undefined,
  label: string,
) {
  const table = tableForAssetPeriod(asset, period);
  [sourceField, targetField].forEach((field) => {
    if (!table.columns.includes(field))
      throw new Error(
        `${label} field "${field}" was not found. Available fields: ${table.columns.join(", ")}.`,
      );
  });
  if (valueField && !numericColumns(table).includes(valueField))
    throw new Error(
      `${label} value field "${valueField}" must be numeric. Available numeric fields: ${numericColumns(table).join(", ") || "none"}.`,
    );
  const sourceIndex = table.columns.indexOf(sourceField);
  const targetIndex = table.columns.indexOf(targetField);
  if (
    !table.rows.some(
      (row) =>
        String(row[sourceIndex] ?? "").trim() &&
        String(row[targetIndex] ?? "").trim(),
    )
  )
    throw new Error(
      `${label} requires at least one complete source-to-target row.`,
    );
}

function validateNumericValueBinding(
  asset: DataAsset,
  period: string,
  valueField: string,
  targetField: string | undefined,
  label: string,
) {
  const table = tableForAssetPeriod(asset, period);
  const numeric = numericColumns(table);
  const invalid = [valueField, targetField].filter(
    (field): field is string => Boolean(field) && !numeric.includes(field!),
  );
  if (invalid.length)
    throw new Error(
      `${label} field${invalid.length === 1 ? "" : "s"} ${invalid.join(", ")} must be numeric. Available numeric fields: ${numeric.join(", ") || "none"}.`,
    );
}

function assertChartCategory(
  project: TesseraProject,
  block: DashboardBlock,
  category: string,
) {
  const table = tableForBlock(project, block);
  if (!table) throw new TypeError("The chart has no data table.");
  const categoryIndex = table.columns.indexOf(block.categoryField ?? "");
  const matches = table.rows.filter(
    (row) => String(row[categoryIndex] ?? "") === category,
  ).length;
  if (!matches)
    throw new TypeError(`No chart element is labeled "${category}".`);
  if (matches > 1)
    throw new TypeError(
      `The category "${category}" is not unique; edit the chart binding or use a unique category.`,
    );
}

function validateBlockBinding(project: TesseraProject, block: DashboardBlock) {
  if (
    ![
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
    ].includes(block.type)
  )
    return;
  if (!block.datasetId)
    throw new TypeError(`${block.type} charts require a datasetId.`);
  const asset = requiredAsset(project, block.datasetId);
  const period = block.period ?? "latest";
  const values = block.valueFields.length
    ? block.valueFields
    : block.valueField
      ? [block.valueField]
      : [];
  if (["bar", "horizontalBar", "groupedBar"].includes(block.type))
    return validateBarBinding(
      asset,
      period,
      String(block.categoryField ?? ""),
      values,
      block.type,
    );
  if (block.type === "line") return validateLineChartBinding(project, block);
  if (block.type === "heatmap")
    return validateHeatmapBinding(
      asset,
      period,
      String(block.categoryField ?? ""),
      values,
    );
  if (block.type === "scatter")
    return validateScatterBinding(
      asset,
      period,
      String(block.categoryField ?? ""),
      String(block.valueField ?? values[0] ?? ""),
      block.labelField,
      block.seriesField,
    );
  if (block.type === "donut" || block.type === "treemap")
    return validateCategoryValueBinding(
      asset,
      period,
      String(block.categoryField ?? ""),
      String(block.valueField ?? values[0] ?? ""),
      block.type,
    );
  if (block.type === "sankey")
    return validateNetworkBinding(
      asset,
      period,
      String(block.categoryField ?? ""),
      String(block.targetField ?? ""),
      block.valueField ?? values[0],
      block.type,
    );
  if (block.type === "gauge")
    return validateNumericValueBinding(
      asset,
      period,
      String(block.valueField ?? values[0] ?? ""),
      block.targetField,
      "gauge",
    );
}

function validateScatterBounds(chart: DashboardBlock["chart"]) {
  if (
    chart.minX !== undefined &&
    chart.maxX !== undefined &&
    chart.minX >= chart.maxX
  )
    throw new TypeError("Scatter X minimum must be less than X maximum.");
  if (
    chart.minY !== undefined &&
    chart.maxY !== undefined &&
    chart.minY >= chart.maxY
  )
    throw new TypeError("Scatter Y minimum must be less than Y maximum.");
}

function findBlock(project: TesseraProject, id: string) {
  for (const dashboard of project.dashboards) {
    const block = dashboard.blocks.find((candidate) => candidate.id === id);
    if (block) return { dashboard, block };
  }
  throw new Error("Block not found.");
}

function validatePlaceholderCompletion(
  project: TesseraProject,
  block: DashboardBlock,
) {
  if (block.type === "text") {
    if (!block.body.trim())
      throw new Error("Add text before finishing this tile.");
    return;
  }
  if (["heading", "sectionHeader"].includes(block.type)) {
    if (!block.title.trim())
      throw new Error("Add a title before finishing this tile.");
    return;
  }
  if (block.type === "illustration") {
    validateIllustrationSettings(block.illustration);
    return;
  }
  if (!block.datasetId)
    throw new Error("Choose a clean dataset before finishing this tile.");
  if (block.type === "table") {
    validateBoundTableConfiguration(project, block);
    return;
  }
  if (block.type === "kpi") {
    if (!block.valueField)
      throw new Error("Choose a KPI value field before finishing this tile.");
    validateKpiBinding(project, block);
    return;
  }
  validateBlockBinding(project, block);
}

/** A KPI may be bound step by step; only the fields already set are checked. */
function validateKpiBinding(project: TesseraProject, block: DashboardBlock) {
  if (!block.datasetId) return;
  const table = tableForBlock(project, block);
  if (!table)
    throw new Error("No approved clean data exists for the selected period.");
  const missing = [block.valueField, block.targetField].filter(
    (field): field is string =>
      Boolean(field) && !table.columns.includes(field!),
  );
  if (missing.length)
    throw new Error(
      `KPI field not found in the clean table: ${missing.join(", ")}.`,
    );
}

function requiredBlock(blocks: DashboardBlock[], id: string) {
  const block = blocks.find((candidate) => candidate.id === id);
  if (!block) throw new Error("Block not found.");
  return block;
}

function requiredTableBlock(blocks: DashboardBlock[], id: string) {
  const block = requiredBlock(blocks, id);
  if (block.type !== "table")
    throw new TypeError("blockId must identify a table block.");
  return block;
}

function assertTableColumn(
  project: TesseraProject,
  block: DashboardBlock,
  column: string,
) {
  const table = tableForBlock(project, block);
  if (table && !table.columns.includes(column))
    throw new Error(
      `Column "${column}" was not found in this table. Available columns: ${table.columns.join(", ")}.`,
    );
}

function validateBoundTableConfiguration(
  project: TesseraProject,
  block: DashboardBlock,
) {
  if (!block.datasetId) throw new TypeError("Table tiles require a datasetId.");
  const table = tableForBlock(project, block);
  if (!table)
    throw new TypeError(
      "The selected dataset period does not contain a clean table.",
    );
  const configuredColumns = [
    ...block.table.visibleColumns,
    ...(block.table.sortColumn ? [block.table.sortColumn] : []),
    ...block.table.sortRules.map((rule) => rule.column),
    ...(block.table.colorByColumn ? [block.table.colorByColumn] : []),
    ...block.table.totalColumns,
    ...block.table.columnStyles.map((style) => style.column),
    ...block.table.cellStyles.flatMap((style) => [
      style.column,
      ...(style.matchColumn ? [style.matchColumn] : []),
    ]),
  ];
  const unknown = [...new Set(configuredColumns)].filter(
    (column) => !table.columns.includes(column),
  );
  if (unknown.length)
    throw new Error(
      `Table field${unknown.length === 1 ? "" : "s"} ${unknown.map((column) => `"${column}"`).join(", ")} not found. Available columns: ${table.columns.join(", ")}.`,
    );
  if (block.table.sortDirection !== "none" && !block.table.sortColumn)
    throw new TypeError(
      "table.sortColumn is required when sortDirection is ascending or descending.",
    );
  const numeric = numericColumns(table);
  const invalidTotals = block.table.totalColumns.filter(
    (column) => !numeric.includes(column),
  );
  if (invalidTotals.length)
    throw new TypeError(
      `Total columns must be numeric. Invalid: ${invalidTotals.join(", ")}.`,
    );
}

function assertTableCellTarget(
  project: TesseraProject,
  block: DashboardBlock,
  selector: DashboardBlock["table"]["cellStyles"][number],
) {
  const table = tableForBlock(project, block);
  if (!table) return;
  if (selector.rowIndex !== undefined && selector.rowIndex > table.rows.length)
    throw new Error(
      `rowIndex ${selector.rowIndex} is outside the table's ${table.rows.length} source rows.`,
    );
  if (selector.matchColumn) {
    const matchIndex = table.columns.indexOf(selector.matchColumn);
    if (
      !table.rows.some(
        (row) => String(row[matchIndex] ?? "") === selector.matchValue,
      )
    )
      throw new Error(
        `No row has ${selector.matchColumn} equal to "${selector.matchValue}".`,
      );
  }
}

function assertTableGroupValue(
  project: TesseraProject,
  block: DashboardBlock,
  column: string,
  value: string,
) {
  const table = tableForBlock(project, block);
  if (!table) return;
  const columnIndex = table.columns.indexOf(column);
  if (!table.rows.some((row) => String(row[columnIndex] ?? "") === value))
    throw new Error(`No row has ${column} equal to "${value}".`);
}

function pickDefined(source: Record<string, unknown>, keys: readonly string[]) {
  return Object.fromEntries(
    keys
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, source[key]]),
  );
}

function clampHeading(value: unknown): 1 | 2 | 3 {
  const level = Number(value ?? 2);
  return level <= 1 ? 1 : level >= 3 ? 3 : 2;
}

type LayoutPlacement = {
  blockId: string;
  width?: DashboardBlock["layout"]["width"];
  minHeight?: number;
  stackId?: string;
};

function validateLayoutPlacements(
  value: unknown,
  dashboard: Dashboard,
): LayoutPlacement[] {
  if (!Array.isArray(value))
    throw new TypeError("placements must be an array.");
  const knownIds = new Set(dashboard.blocks.map((block) => block.id));
  const seen = new Set<string>();
  return value.map((candidate, index) => {
    const placement = plainObject(candidate, `placements[${index}]`);
    rejectUnknownKeys(
      placement,
      ["blockId", "width", "minHeight", "stackId"],
      `placements[${index}]`,
    );
    if (typeof placement.blockId !== "string" || !placement.blockId.trim())
      throw new TypeError(
        `placements[${index}].blockId must be a non-empty string.`,
      );
    const blockId = placement.blockId;
    if (seen.has(blockId))
      throw new Error(`Duplicate blockId in placements: ${blockId}.`);
    seen.add(blockId);
    if (!knownIds.has(blockId))
      throw new Error(`Unknown blockId in placements: ${blockId}.`);
    if (placement.width !== undefined) validateLayoutWidth(placement.width);
    if (placement.minHeight !== undefined)
      finiteNumber(
        placement.minHeight,
        `placements[${index}].minHeight`,
        MIN_BLOCK_HEIGHT,
        MAX_BLOCK_HEIGHT,
      );
    if (
      placement.stackId !== undefined &&
      (typeof placement.stackId !== "string" || placement.stackId.length > 160)
    )
      throw new TypeError(
        `placements[${index}].stackId must be a string of at most 160 characters.`,
      );
    return {
      blockId,
      ...(placement.width === undefined
        ? {}
        : {
            width: placement.width as DashboardBlock["layout"]["width"],
          }),
      ...(placement.minHeight === undefined
        ? {}
        : { minHeight: placement.minHeight as number }),
      ...(placement.stackId === undefined
        ? {}
        : { stackId: placement.stackId as string }),
    };
  });
}

function dashboardBlockPatchProp() {
  return partialObjectProp("Mutable DashboardBlock fields", {
    title: stringProp("Block title"),
    subtitle: stringProp("Block subtitle"),
    eyebrow: stringProp("Block eyebrow"),
    chip: stringProp("Block chip"),
    body: stringProp("Narrative body"),
    headingLevel: enumProp("Heading level", [1, 2, 3]),
    datasetId: stringProp("Dataset ID"),
    period: stringProp("latest, all, or YYYY-MM"),
    categoryField: stringProp("Category or source field"),
    labelField: stringProp("Scatter point label field"),
    seriesField: stringProp("Scatter series field"),
    targetField: stringProp("Target field"),
    valueField: stringProp("Primary value field"),
    valueFields: arrayProp("Value fields", stringProp("Field")),
    style: partialObjectProp("Block style (card surfaces are always white)", {
      accent: stringProp(
        "Accent color; reserve non-blue accents for status: #1f7a4d met, #b42318 missed, #b7791f at risk, #1478ff emphasis",
        "^#[0-9A-Fa-f]{6}$",
      ),
      textColor: stringProp("Text color", "^#[0-9A-Fa-f]{6}$"),
      alignH: enumProp("Horizontal alignment", ["left", "center", "right"]),
      alignV: enumProp("Vertical alignment", ["top", "middle", "bottom"]),
      fontScale: numberProp("Type scale percent", 75, 160),
      padding: numberProp("Inner padding", 0, 64),
      cornerRadius: numberProp("Corner radius", 0, 40),
      border: booleanProp("Show border"),
      shadow: enumProp("Shadow depth", ["none", "soft", "raised"]),
    }),
    chart: partialObjectProp("Chart settings", {
      showLegend: booleanProp("Show legend"),
      legendPosition: enumProp("Legend position", ["top", "bottom", "right"]),
      showValues: booleanProp("Show values"),
      showGridlines: booleanProp("Show gridlines"),
      showXAxis: booleanProp("Show x-axis"),
      showYAxis: booleanProp("Show y-axis"),
      showPoints: booleanProp("Show points"),
      showAverageLine: booleanProp("Show average line"),
      showMinLine: booleanProp("Show minimum line"),
      showMaxLine: booleanProp("Show maximum line"),
      showReferenceLine: booleanProp("Show reference line"),
      referenceValue: numberProp("Reference value"),
      referenceLabel: stringProp("Reference label"),
      sortOrder: enumProp("Sort order", ["source", "ascending", "descending"]),
      valueFormat: enumProp("Number format", [
        "auto",
        "number",
        "compact",
        "percent",
        "currency",
      ]),
      decimalPlaces: numberProp("Decimal places", 0, 6),
      colors: arrayProp(
        "Series colors",
        stringProp("Hex color", "^#[0-9A-Fa-f]{6}$"),
      ),
      seriesOpacity: numberProp("Series opacity", 0.1, 1),
      barRadius: numberProp("Bar radius", 0, 20),
      barGap: numberProp("Bar gap", 0, 70),
      barColorOverrides: barColorOverridesProp(),
      lineWidth: numberProp("Line width", 1, 8),
      curve: enumProp("Line curve", ["straight", "smooth", "step"]),
      lineDash: enumProp("Line dash", ["solid", "dashed", "dotted"]),
      pointSize: numberProp("Line point radius", 1, 12),
      pointShape: enumProp("Line point shape", ["circle", "square", "diamond"]),
      connectNulls: booleanProp("Connect line across missing values"),
      fillArea: booleanProp("Fill area below lines"),
      areaOpacity: numberProp("Line area opacity", 0, 0.6),
      lineSeriesStyles: lineSeriesStylesProp(),
      linePointStyles: linePointStylesProp(),
      donutHole: numberProp("Donut hole", 20, 82),
      donutCenterLabel: stringProp("Donut center label"),
      donutSliceStyles: donutSliceStylesProp(),
      treemapTileStyles: treemapTileStylesProp(),
      sankeyNodeWidth: numberProp("Network node size", 8, 36),
      sankeyNodeGap: numberProp("Network node gap", 4, 40),
      sankeyLinkOpacity: numberProp("Network link opacity", 0.05, 1),
      sankeyLinkThickness: numberProp("Network flow density", 0.6, 1.8),
      sankeyStageLabels: arrayProp(
        "Sankey stage names",
        stringProp("Stage name"),
      ),
      sankeyShowStageHeaders: booleanProp("Show Sankey stage headers"),
      sankeyShowNodeLabels: booleanProp("Show Sankey node labels"),
      sankeyShowLinkValues: booleanProp("Show Sankey link values"),
      sankeyShowShares: booleanProp("Show Sankey flow shares"),
      sankeyLinkColorMode: enumProp("Sankey link color mode", [
        "gradient",
        "source",
        "target",
      ]),
      sankeyNodeSort: enumProp("Sankey node ordering", [
        "auto",
        "name",
        "value",
      ]),
      sankeyNodeOverrides: arrayProp(
        "Exact Sankey node style overrides",
        sankeyNodeOverrideProp(),
      ),
      sankeyLinkOverrides: arrayProp(
        "Exact Sankey link style overrides",
        sankeyLinkOverrideProp(),
      ),
      highlightNodes: arrayProp("Highlighted nodes", stringProp("Node")),
      xAxisTitle: stringProp("X-axis title"),
      yAxisTitle: stringProp("Y-axis title"),
      xValueFormat: enumProp("X-axis number format", [
        "auto",
        "number",
        "compact",
        "percent",
        "currency",
      ]),
      xDecimalPlaces: numberProp("X-axis decimal places", 0, 6),
      minX: numberProp("X-axis minimum"),
      maxX: numberProp("X-axis maximum"),
      minY: numberProp("Y-axis minimum"),
      maxY: numberProp("Y-axis maximum"),
      scatterPointSize: numberProp("Scatter point radius", 2, 20),
      scatterPointShape: enumProp("Scatter point shape", [
        "circle",
        "square",
        "diamond",
      ]),
      scatterPointStroke: stringProp(
        "Scatter point outline color",
        "^#[0-9A-Fa-f]{6}$",
      ),
      scatterPointStrokeWidth: numberProp("Scatter point outline width", 0, 6),
      scatterIncludeZero: booleanProp("Include zero in scatter axes"),
      scatterShowTrendLine: booleanProp("Show scatter trend line"),
      scatterTrendLineColor: stringProp(
        "Scatter trend line color",
        "^#[0-9A-Fa-f]{6}$",
      ),
      scatterXReferenceValue: numberProp("Scatter X reference value"),
      scatterXReferenceLabel: stringProp("Scatter X reference label"),
      scatterYReferenceValue: numberProp("Scatter Y reference value"),
      scatterYReferenceLabel: stringProp("Scatter Y reference label"),
      scatterPointStyles: scatterPointStylesProp(),
      heatmapScaleType: enumProp("Heatmap color scale", [
        "sequential",
        "diverging",
      ]),
      heatmapScaleScope: enumProp("Heatmap comparison scope", [
        "global",
        "row",
        "column",
      ]),
      heatmapMinColor: stringProp(
        "Heatmap low-value color",
        "^#[0-9A-Fa-f]{6}$",
      ),
      heatmapMidColor: stringProp(
        "Heatmap midpoint color",
        "^#[0-9A-Fa-f]{6}$",
      ),
      heatmapMaxColor: stringProp(
        "Heatmap high-value color",
        "^#[0-9A-Fa-f]{6}$",
      ),
      heatmapMidpoint: numberProp("Heatmap diverging midpoint"),
      heatmapMinValue: numberProp("Heatmap fixed scale minimum"),
      heatmapMaxValue: numberProp("Heatmap fixed scale maximum"),
      heatmapReverse: booleanProp("Reverse the heatmap color scale"),
      heatmapMissingColor: stringProp(
        "Heatmap missing-value color",
        "^#[0-9A-Fa-f]{6}$",
      ),
      heatmapCellGap: numberProp("Heatmap cell gap", 0, 12),
      heatmapCellRadius: numberProp("Heatmap cell corner radius", 0, 16),
      heatmapCellStyles: heatmapCellStylesProp(),
    }),
    gauge: partialObjectProp(
      "Gauge-only settings. Every property is optional and merged recursively; use colors.value, colors.track, colors.target, or colors.needle for a one-element color edit.",
      {
        aggregation: enumProp("How numeric rows are reduced to one value", [
          "sum",
          "average",
          "minimum",
          "maximum",
          "count",
          "first",
          "last",
        ]),
        display: enumProp("Progress arc or classic pointer dial", [
          "progress",
          "dial",
        ]),
        min: numberProp("Minimum scale value"),
        max: numberProp("Maximum scale value"),
        targetValue: numberProp(
          "Fixed target; targetField takes precedence when the block has one",
        ),
        valueLabel: stringProp("Optional actual-value label"),
        targetLabel: stringProp("Target annotation label"),
        showValue: booleanProp("Show the actual value"),
        showTarget: booleanProp("Show target marker and annotation"),
        showScaleLabels: booleanProp("Show minimum and maximum labels"),
        showPercentOfTarget: booleanProp("Show actual as percent of target"),
        showRangeLabels: booleanProp("Show qualitative range labels"),
        arcWidth: numberProp("Arc thickness", 8, 40),
        roundedEnds: booleanProp("Use rounded arc ends"),
        colors: partialObjectProp(
          "Named gauge element colors; set only the element that should change",
          {
            track: stringProp("Unfilled track color", "^#[0-9A-Fa-f]{6}$"),
            value: stringProp("Actual-value arc color", "^#[0-9A-Fa-f]{6}$"),
            target: stringProp("Target marker color", "^#[0-9A-Fa-f]{6}$"),
            needle: stringProp("Dial pointer color", "^#[0-9A-Fa-f]{6}$"),
          },
        ),
        ranges: arrayProp(
          "Complete ordered qualitative ranges; stable ids make individual ranges easy to identify",
          gaugeRangeProp(),
        ),
      },
    ),
    table: partialObjectProp(
      "Table settings. Send only changed fields; nested settings are merged. columnStyles and cellStyles replace those arrays, so use the targeted table styling tools for one-element edits.",
      {
        visibleColumns: arrayProp("Visible columns", stringProp("Column")),
        rowLimit: numberProp("Maximum visible rows", 1, 500),
        sortColumn: stringProp("Column to sort; empty restores source order"),
        sortDirection: enumProp("Sort direction", [
          "none",
          "ascending",
          "descending",
        ]),
        sortRules: arrayProp(
          "Ordered sort levels; first rule has highest priority",
          tableSortRuleProp(),
        ),
        striped: booleanProp("Stripe alternating rows"),
        compact: booleanProp("Use compact density"),
        columnGridlines: booleanProp("Show column gridlines"),
        rowGridlines: booleanProp("Show row gridlines"),
        stickyHeader: booleanProp("Keep header visible"),
        freezeFirstColumn: booleanProp("Freeze the first visible column"),
        showSearch: booleanProp(
          "Enable the header button that toggles row search",
        ),
        showDatasetName: booleanProp("Show linked dataset name"),
        showRowCount: booleanProp("Show visible row count"),
        showRowNumbers: booleanProp("Show row numbers"),
        showColumnHeaders: booleanProp("Show the column header row"),
        boldLastRow: booleanProp("Bold final row"),
        showTotals: booleanProp("Show totals"),
        totalsLabel: stringProp("Totals row label"),
        totalColumns: arrayProp(
          "Columns to total; empty means every visible numeric column",
          stringProp("Column"),
        ),
        numberFormat: enumProp("Number format", [
          "auto",
          "number",
          "compact",
          "percent",
          "currency",
        ]),
        decimalPlaces: numberProp("Default decimal places", 0, 6),
        nullDisplay: stringProp("Text for null or blank cells"),
        negativeParens: booleanProp("Use parentheses for negatives"),
        negativeRed: booleanProp("Color negatives red"),
        wrapText: booleanProp("Wrap long text"),
        heatmap: booleanProp("Show cell heatmap"),
        heatmapColor: stringProp("Heatmap color", "^#[0-9A-Fa-f]{6}$"),
        headerBackgroundColor: stringProp(
          "Default header background color",
          "^#[0-9A-Fa-f]{6}$",
        ),
        headerTextColor: stringProp(
          "Default header text color",
          "^#[0-9A-Fa-f]{6}$",
        ),
        rowBackgroundColor: stringProp(
          "Default body row background color",
          "^#[0-9A-Fa-f]{6}$",
        ),
        alternateRowBackgroundColor: stringProp(
          "Striped alternate row background color",
          "^#[0-9A-Fa-f]{6}$",
        ),
        cellTextColor: stringProp(
          "Default body text color",
          "^#[0-9A-Fa-f]{6}$",
        ),
        gridColor: stringProp("Gridline color", "^#[0-9A-Fa-f]{6}$"),
        colorByColumn: stringProp(
          "Column whose distinct values receive consistent row colors; empty disables grouping colors",
        ),
        groupPalette: arrayProp(
          "Row background colors assigned to groups in source order",
          stringProp("Hex color", "^#[0-9A-Fa-f]{6}$"),
        ),
        groupColors: arrayProp(
          "Exact group color overrides",
          tableGroupColorProp(),
        ),
        columnStyles: arrayProp(
          "Sparse per-column overrides by exact dataset column name",
          tableColumnStyleProp(),
        ),
        cellStyles: arrayProp(
          "Sparse exact-cell overrides selected by source rowIndex or matchColumn plus matchValue",
          tableCellStyleProp(),
        ),
      },
    ),
    kpi: partialObjectProp("KPI settings", {
      aggregation: enumProp("Aggregation", [
        "sum",
        "average",
        "count",
        "minimum",
        "maximum",
        "first",
        "last",
      ]),
      valueFormat: enumProp("Number format", [
        "auto",
        "number",
        "compact",
        "percent",
        "currency",
      ]),
      decimalPlaces: numberProp("Decimal places", 0, 6),
      prefix: stringProp("Value prefix"),
      suffix: stringProp("Value suffix"),
      icon: enumProp("Business icon", [...KPI_ICON_NAMES]),
      comparisonLabel: stringProp("Comparison label"),
      comparisonValue: numberProp("Comparison value"),
      targetValue: numberProp("Target value"),
      showProgress: booleanProp("Show target badge"),
      positiveDirection: enumProp("Desired direction", ["up", "down"]),
    }),
    illustration: partialObjectProp("Illustration settings", {
      preset: enumProp(
        "Approved editorial scene, or custom for saved artwork",
        [...ILLUSTRATION_PRESET_NAMES, "custom"],
      ),
      altText: stringProp("Accessible scene description"),
      primaryColor: stringProp(
        "RGB color applied to the visible artwork",
        "^#[0-9A-Fa-f]{6}$",
      ),
      showCaption: booleanProp("Show the title and eyebrow above the artwork"),
      libraryAssetId: stringProp(
        "Saved generated illustration to display; pairs with preset custom",
      ),
      bitmapMask: {
        type: ["object", "null"],
        description:
          "Packed artwork mask carried from the saved library asset, or null to return to a preset; prefer add_saved_illustration_card",
        additionalProperties: true,
      },
    }),
    layout: partialObjectProp("Block layout", {
      width: enumProp("Grid width", [...LAYOUT_WIDTHS]),
      minHeight: numberProp(
        "Minimum block height",
        MIN_BLOCK_HEIGHT,
        MAX_BLOCK_HEIGHT,
      ),
      stackId: stringProp("Shared vertical-stack ID"),
    }),
  });
}

function partialObjectProp(
  description: string,
  properties: Record<string, Record<string, unknown>>,
) {
  return {
    type: "object",
    description,
    properties,
    additionalProperties: false,
  };
}

function tableColumnStyleProp() {
  return {
    type: "object",
    description:
      "Presentation for one exact dataset column. Omitted fields inherit table defaults.",
    properties: {
      column: stringProp("Exact dataset column name"),
      label: stringProp("Optional display label; does not rename source data"),
      width: numberProp("Column width in pixels", 48, 600),
      align: enumProp("Cell alignment", ["auto", "left", "center", "right"]),
      wrap: booleanProp("Wrap text in this column"),
      numberFormat: enumProp("Column number format", [
        "auto",
        "number",
        "compact",
        "percent",
        "currency",
      ]),
      decimalPlaces: numberProp("Column decimal places", 0, 6),
      prefix: stringProp("Text before formatted values"),
      suffix: stringProp("Text after formatted values"),
      backgroundColor: stringProp(
        "Body cell background color",
        "^#[0-9A-Fa-f]{6}$",
      ),
      textColor: stringProp("Body cell text color", "^#[0-9A-Fa-f]{6}$"),
      headerBackgroundColor: stringProp(
        "Header background color",
        "^#[0-9A-Fa-f]{6}$",
      ),
      headerTextColor: stringProp("Header text color", "^#[0-9A-Fa-f]{6}$"),
    },
    required: ["column"],
    additionalProperties: false,
  };
}

function tableCellStyleProp() {
  return {
    type: "object",
    description:
      "Style one cell. Provide rowIndex, or provide both matchColumn and matchValue. Later matching entries win.",
    properties: {
      column: stringProp("Exact dataset column name of the target cell"),
      rowIndex: numberProp("One-based source dataset row", 1, 1000000),
      matchColumn: stringProp("Column used to identify the target row"),
      matchValue: stringProp(
        "Row value to match after String() conversion; comparisons are exact",
      ),
      backgroundColor: stringProp(
        "Target cell background color",
        "^#[0-9A-Fa-f]{6}$",
      ),
      textColor: stringProp("Target cell text color", "^#[0-9A-Fa-f]{6}$"),
      fontWeight: enumProp("Target cell weight", ["normal", "medium", "bold"]),
      textAlign: enumProp("Target cell alignment", ["left", "center", "right"]),
    },
    required: ["column"],
    additionalProperties: false,
  };
}

function tableSortRuleProp() {
  return {
    type: "object",
    description:
      "One table sort level. Array order is priority order, from primary to final tie-breaker.",
    properties: {
      column: stringProp("Exact dataset column name"),
      direction: enumProp(
        "Sort direction; blank values stay last in either direction",
        ["ascending", "descending"],
      ),
    },
    required: ["column", "direction"],
    additionalProperties: false,
  };
}

function tableGroupColorProp() {
  return {
    type: "object",
    description: "Color override for one exact grouping value",
    properties: {
      value: stringProp("Exact grouping value after String() conversion"),
      backgroundColor: stringProp("Row background color", "^#[0-9A-Fa-f]{6}$"),
      textColor: stringProp("Optional row text color", "^#[0-9A-Fa-f]{6}$"),
    },
    required: ["value", "backgroundColor"],
    additionalProperties: false,
  };
}

function validateDashboardBlockPatch(value: unknown): Partial<DashboardBlock> {
  const patch = plainObject(value, "patch");
  const immutable = ["id", "type", "createdAt", "createdBy", "updatedAt"];
  const attemptedImmutable = immutable.find((key) => key in patch);
  if (attemptedImmutable)
    throw new Error(`patch.${attemptedImmutable} is immutable.`);
  rejectUnknownKeys(
    patch,
    [
      "title",
      "subtitle",
      "eyebrow",
      "chip",
      "body",
      "headingLevel",
      "datasetId",
      "period",
      "categoryField",
      "labelField",
      "seriesField",
      "targetField",
      "valueField",
      "valueFields",
      "style",
      "chart",
      "gauge",
      "table",
      "kpi",
      "illustration",
      "layout",
    ],
    "patch",
  );
  rejectUndefinedExcept(
    patch,
    [
      "datasetId",
      "categoryField",
      "labelField",
      "seriesField",
      "targetField",
      "valueField",
    ],
    "patch",
  );
  validateStringFields(patch, [
    "title",
    "subtitle",
    "eyebrow",
    "chip",
    "body",
    "period",
  ]);
  validateOptionalStringFields(patch, [
    "datasetId",
    "categoryField",
    "labelField",
    "seriesField",
    "targetField",
    "valueField",
  ]);
  if (patch.headingLevel !== undefined)
    enumValue(patch.headingLevel, [1, 2, 3], "patch.headingLevel");
  if (patch.valueFields !== undefined)
    stringArray(patch.valueFields, "patch.valueFields");
  if (patch.style !== undefined) validateStylePatch(patch.style);
  if (patch.chart !== undefined) validateChartPatch(patch.chart);
  if (patch.gauge !== undefined) validateGaugePatch(patch.gauge);
  if (patch.table !== undefined) validateTablePatch(patch.table);
  if (patch.kpi !== undefined) validateKpiPatch(patch.kpi);
  if (patch.illustration !== undefined)
    validateIllustrationPatch(patch.illustration);
  if (patch.layout !== undefined) validateLayoutPatch(patch.layout);
  return patch as Partial<DashboardBlock>;
}

function validateStylePatch(value: unknown) {
  const style = plainObject(value, "patch.style");
  if ("background" in style)
    throw new TypeError(
      "Card surfaces are always white in Tessera; recolor the accent, the text, or the chart series instead.",
    );
  rejectUnknownKeys(
    style,
    [
      "accent",
      "textColor",
      "alignH",
      "alignV",
      "fontScale",
      "padding",
      "cornerRadius",
      "border",
      "shadow",
    ],
    "patch.style",
  );
  rejectUndefinedExcept(style, [], "patch.style");
  ["accent", "textColor"].forEach((key) => {
    if (style[key] !== undefined) hexColor(style[key], `patch.style.${key}`);
  });
  if (style.alignH !== undefined)
    enumValue(style.alignH, ["left", "center", "right"], "patch.style.alignH");
  if (style.alignV !== undefined)
    enumValue(style.alignV, ["top", "middle", "bottom"], "patch.style.alignV");
  if (style.fontScale !== undefined)
    finiteNumber(style.fontScale, "patch.style.fontScale", 75, 160);
  if (style.padding !== undefined)
    finiteNumber(style.padding, "patch.style.padding", 0, 64);
  if (style.cornerRadius !== undefined)
    finiteNumber(style.cornerRadius, "patch.style.cornerRadius", 0, 40);
  if (style.border !== undefined)
    booleanValue(style.border, "patch.style.border");
  if (style.shadow !== undefined)
    enumValue(style.shadow, ["none", "soft", "raised"], "patch.style.shadow");
}

function validateChartPatch(value: unknown) {
  const chart = plainObject(value, "patch.chart");
  const booleanFields = [
    "showLegend",
    "showValues",
    "showGridlines",
    "showXAxis",
    "showYAxis",
    "showPoints",
    "showAverageLine",
    "showMinLine",
    "showMaxLine",
    "showReferenceLine",
    "sankeyShowStageHeaders",
    "sankeyShowNodeLabels",
    "sankeyShowLinkValues",
    "sankeyShowShares",
    "scatterIncludeZero",
    "scatterShowTrendLine",
    "connectNulls",
    "fillArea",
    "heatmapReverse",
  ];
  const stringFields = [
    "referenceLabel",
    "donutCenterLabel",
    "xAxisTitle",
    "yAxisTitle",
    "scatterPointStroke",
    "scatterTrendLineColor",
    "scatterXReferenceLabel",
    "scatterYReferenceLabel",
    "heatmapMinColor",
    "heatmapMidColor",
    "heatmapMaxColor",
    "heatmapMissingColor",
  ];
  const allowed = [
    ...booleanFields,
    ...stringFields,
    "legendPosition",
    "referenceValue",
    "sortOrder",
    "valueFormat",
    "decimalPlaces",
    "colors",
    "seriesOpacity",
    "barRadius",
    "barGap",
    "barColorOverrides",
    "lineWidth",
    "curve",
    "lineDash",
    "pointSize",
    "pointShape",
    "areaOpacity",
    "lineSeriesStyles",
    "linePointStyles",
    "donutHole",
    "donutSliceStyles",
    "treemapTileStyles",
    "sankeyNodeWidth",
    "sankeyNodeGap",
    "sankeyLinkOpacity",
    "sankeyLinkThickness",
    "sankeyStageLabels",
    "sankeyLinkColorMode",
    "sankeyNodeSort",
    "sankeyNodeOverrides",
    "sankeyLinkOverrides",
    "highlightNodes",
    "xValueFormat",
    "xDecimalPlaces",
    "minX",
    "maxX",
    "minY",
    "maxY",
    "scatterPointSize",
    "scatterPointShape",
    "scatterPointStrokeWidth",
    "scatterXReferenceValue",
    "scatterYReferenceValue",
    "scatterPointStyles",
    "heatmapScaleType",
    "heatmapScaleScope",
    "heatmapMidpoint",
    "heatmapMinValue",
    "heatmapMaxValue",
    "heatmapCellGap",
    "heatmapCellRadius",
    "heatmapCellStyles",
  ];
  rejectUnknownKeys(chart, allowed, "patch.chart");
  rejectUndefinedExcept(
    chart,
    [
      "referenceValue",
      "minX",
      "maxX",
      "minY",
      "maxY",
      "scatterXReferenceValue",
      "scatterYReferenceValue",
      "heatmapMidpoint",
      "heatmapMinValue",
      "heatmapMaxValue",
    ],
    "patch.chart",
  );
  booleanFields.forEach((key) => {
    if (chart[key] !== undefined)
      booleanValue(chart[key], `patch.chart.${key}`);
  });
  validateStringFields(chart, stringFields);
  if (chart.legendPosition !== undefined)
    enumValue(
      chart.legendPosition,
      ["top", "bottom", "right"],
      "patch.chart.legendPosition",
    );
  if (chart.sortOrder !== undefined)
    enumValue(
      chart.sortOrder,
      ["source", "ascending", "descending"],
      "patch.chart.sortOrder",
    );
  if (chart.valueFormat !== undefined)
    enumValue(
      chart.valueFormat,
      ["auto", "number", "compact", "percent", "currency"],
      "patch.chart.valueFormat",
    );
  if (chart.xValueFormat !== undefined)
    enumValue(
      chart.xValueFormat,
      ["auto", "number", "compact", "percent", "currency"],
      "patch.chart.xValueFormat",
    );
  if (chart.curve !== undefined)
    enumValue(chart.curve, ["straight", "smooth", "step"], "patch.chart.curve");
  if (chart.sankeyLinkColorMode !== undefined)
    enumValue(
      chart.sankeyLinkColorMode,
      ["gradient", "source", "target"],
      "patch.chart.sankeyLinkColorMode",
    );
  if (chart.sankeyNodeSort !== undefined)
    enumValue(
      chart.sankeyNodeSort,
      ["auto", "name", "value"],
      "patch.chart.sankeyNodeSort",
    );
  if (chart.lineDash !== undefined)
    enumValue(
      chart.lineDash,
      ["solid", "dashed", "dotted"],
      "patch.chart.lineDash",
    );
  if (chart.pointShape !== undefined)
    enumValue(
      chart.pointShape,
      ["circle", "square", "diamond"],
      "patch.chart.pointShape",
    );
  if (chart.scatterPointShape !== undefined)
    enumValue(
      chart.scatterPointShape,
      ["circle", "square", "diamond"],
      "patch.chart.scatterPointShape",
    );
  if (chart.heatmapScaleType !== undefined)
    enumValue(
      chart.heatmapScaleType,
      ["sequential", "diverging"],
      "patch.chart.heatmapScaleType",
    );
  if (chart.heatmapScaleScope !== undefined)
    enumValue(
      chart.heatmapScaleScope,
      ["global", "row", "column"],
      "patch.chart.heatmapScaleScope",
    );
  optionalFiniteNumber(chart, "referenceValue", "patch.chart.referenceValue");
  optionalFiniteNumber(chart, "minX", "patch.chart.minX");
  optionalFiniteNumber(chart, "maxX", "patch.chart.maxX");
  optionalFiniteNumber(chart, "minY", "patch.chart.minY");
  optionalFiniteNumber(chart, "maxY", "patch.chart.maxY");
  optionalFiniteNumber(
    chart,
    "scatterXReferenceValue",
    "patch.chart.scatterXReferenceValue",
  );
  optionalFiniteNumber(
    chart,
    "scatterYReferenceValue",
    "patch.chart.scatterYReferenceValue",
  );
  if (
    chart.minX !== undefined &&
    chart.maxX !== undefined &&
    Number(chart.minX) >= Number(chart.maxX)
  )
    throw new TypeError("patch.chart.minX must be less than patch.chart.maxX.");
  if (
    chart.minY !== undefined &&
    chart.maxY !== undefined &&
    Number(chart.minY) >= Number(chart.maxY)
  )
    throw new TypeError("patch.chart.minY must be less than patch.chart.maxY.");
  optionalFiniteNumber(chart, "heatmapMidpoint", "patch.chart.heatmapMidpoint");
  optionalFiniteNumber(chart, "heatmapMinValue", "patch.chart.heatmapMinValue");
  optionalFiniteNumber(chart, "heatmapMaxValue", "patch.chart.heatmapMaxValue");
  if (chart.decimalPlaces !== undefined)
    integerNumber(chart.decimalPlaces, "patch.chart.decimalPlaces", 0, 6);
  if (chart.xDecimalPlaces !== undefined)
    integerNumber(chart.xDecimalPlaces, "patch.chart.xDecimalPlaces", 0, 6);
  if (chart.seriesOpacity !== undefined)
    finiteNumber(chart.seriesOpacity, "patch.chart.seriesOpacity", 0.1, 1);
  if (chart.barRadius !== undefined)
    finiteNumber(chart.barRadius, "patch.chart.barRadius", 0, 20);
  if (chart.barGap !== undefined)
    finiteNumber(chart.barGap, "patch.chart.barGap", 0, 70);
  if (chart.barColorOverrides !== undefined)
    validateBarColorOverrides(chart.barColorOverrides);
  if (chart.lineWidth !== undefined)
    finiteNumber(chart.lineWidth, "patch.chart.lineWidth", 1, 8);
  if (chart.pointSize !== undefined)
    finiteNumber(chart.pointSize, "patch.chart.pointSize", 1, 12);
  if (chart.areaOpacity !== undefined)
    finiteNumber(chart.areaOpacity, "patch.chart.areaOpacity", 0, 0.6);
  if (chart.lineSeriesStyles !== undefined)
    validateLineSeriesStyles(
      chart.lineSeriesStyles,
      "patch.chart.lineSeriesStyles",
    );
  if (chart.linePointStyles !== undefined)
    validateLinePointStyles(
      chart.linePointStyles,
      "patch.chart.linePointStyles",
    );
  if (chart.scatterPointSize !== undefined)
    finiteNumber(chart.scatterPointSize, "patch.chart.scatterPointSize", 2, 20);
  if (chart.scatterPointStrokeWidth !== undefined)
    finiteNumber(
      chart.scatterPointStrokeWidth,
      "patch.chart.scatterPointStrokeWidth",
      0,
      6,
    );
  if (chart.donutHole !== undefined)
    finiteNumber(chart.donutHole, "patch.chart.donutHole", 20, 82);
  if (chart.donutSliceStyles !== undefined)
    validateDonutSliceStyles(
      chart.donutSliceStyles,
      "patch.chart.donutSliceStyles",
    );
  if (chart.treemapTileStyles !== undefined)
    validateTreemapTileStyles(
      chart.treemapTileStyles,
      "patch.chart.treemapTileStyles",
    );
  [
    "heatmapMinColor",
    "heatmapMidColor",
    "heatmapMaxColor",
    "heatmapMissingColor",
  ].forEach((key) => {
    if (chart[key] !== undefined) hexColor(chart[key], `patch.chart.${key}`);
  });
  if (chart.heatmapCellGap !== undefined)
    finiteNumber(chart.heatmapCellGap, "patch.chart.heatmapCellGap", 0, 12);
  if (chart.heatmapCellRadius !== undefined)
    finiteNumber(
      chart.heatmapCellRadius,
      "patch.chart.heatmapCellRadius",
      0,
      16,
    );
  if (chart.sankeyNodeWidth !== undefined)
    finiteNumber(chart.sankeyNodeWidth, "patch.chart.sankeyNodeWidth", 8, 36);
  if (chart.sankeyNodeGap !== undefined)
    finiteNumber(chart.sankeyNodeGap, "patch.chart.sankeyNodeGap", 4, 40);
  if (chart.sankeyLinkOpacity !== undefined)
    finiteNumber(
      chart.sankeyLinkOpacity,
      "patch.chart.sankeyLinkOpacity",
      0.05,
      1,
    );
  if (chart.sankeyLinkThickness !== undefined)
    finiteNumber(
      chart.sankeyLinkThickness,
      "patch.chart.sankeyLinkThickness",
      0.6,
      1.8,
    );
  if (chart.colors !== undefined) {
    stringArray(chart.colors, "patch.chart.colors");
    if (!(chart.colors as string[]).length)
      throw new TypeError(
        "patch.chart.colors must contain at least one color.",
      );
    (chart.colors as string[]).forEach((color, index) =>
      hexColor(color, `patch.chart.colors[${index}]`),
    );
  }
  if (chart.highlightNodes !== undefined)
    stringArray(chart.highlightNodes, "patch.chart.highlightNodes");
  if (chart.sankeyStageLabels !== undefined)
    stringArray(chart.sankeyStageLabels, "patch.chart.sankeyStageLabels");
  if (chart.sankeyNodeOverrides !== undefined)
    validateSankeyNodeOverrides(
      chart.sankeyNodeOverrides,
      "patch.chart.sankeyNodeOverrides",
    );
  if (chart.sankeyLinkOverrides !== undefined)
    validateSankeyLinkOverrides(
      chart.sankeyLinkOverrides,
      "patch.chart.sankeyLinkOverrides",
    );
  if (chart.scatterPointStroke !== undefined)
    hexColor(chart.scatterPointStroke, "patch.chart.scatterPointStroke");
  if (chart.scatterTrendLineColor !== undefined)
    hexColor(chart.scatterTrendLineColor, "patch.chart.scatterTrendLineColor");
  if (chart.scatterPointStyles !== undefined)
    validateScatterPointStyles(
      chart.scatterPointStyles,
      "patch.chart.scatterPointStyles",
    );
  if (chart.heatmapCellStyles !== undefined)
    validateHeatmapCellStyles(
      chart.heatmapCellStyles,
      "patch.chart.heatmapCellStyles",
    );
  if (
    chart.heatmapMinValue !== undefined &&
    chart.heatmapMaxValue !== undefined &&
    Number(chart.heatmapMinValue) >= Number(chart.heatmapMaxValue)
  )
    throw new TypeError(
      "patch.chart.heatmapMinValue must be less than heatmapMaxValue.",
    );
}

function validateChartPatchForType(
  type: BlockType,
  patch: Partial<DashboardBlock["chart"]>,
) {
  const common = [
    "showLegend",
    "legendPosition",
    "showValues",
    "sortOrder",
    "valueFormat",
    "decimalPlaces",
    "colors",
    "seriesOpacity",
  ];
  const cartesian = [
    "showGridlines",
    "showXAxis",
    "showYAxis",
    "showAverageLine",
    "showMinLine",
    "showMaxLine",
    "showReferenceLine",
    "referenceValue",
    "referenceLabel",
    "xAxisTitle",
    "yAxisTitle",
    "minY",
    "maxY",
  ];
  const byType: Partial<Record<BlockType, string[]>> = {
    bar: [...common, ...cartesian, "barRadius", "barGap", "barColorOverrides"],
    horizontalBar: [...common, "barRadius", "barGap", "barColorOverrides"],
    groupedBar: [
      ...common,
      ...cartesian,
      "barRadius",
      "barGap",
      "barColorOverrides",
    ],
    line: [
      ...common,
      ...cartesian,
      "showPoints",
      "lineWidth",
      "curve",
      "lineDash",
      "pointSize",
      "pointShape",
      "connectNulls",
      "fillArea",
      "areaOpacity",
      "lineSeriesStyles",
      "linePointStyles",
    ],
    donut: [...common, "donutHole", "donutCenterLabel", "donutSliceStyles"],
    sankey: [
      ...common,
      "sankeyNodeWidth",
      "sankeyNodeGap",
      "sankeyLinkOpacity",
      "sankeyLinkThickness",
      "sankeyStageLabels",
      "sankeyShowStageHeaders",
      "sankeyShowNodeLabels",
      "sankeyShowLinkValues",
      "sankeyShowShares",
      "sankeyLinkColorMode",
      "sankeyNodeSort",
      "sankeyNodeOverrides",
      "sankeyLinkOverrides",
      "highlightNodes",
    ],
    gauge: [...common],
    scatter: [
      ...common,
      "showGridlines",
      "showXAxis",
      "showYAxis",
      "xAxisTitle",
      "yAxisTitle",
      "xValueFormat",
      "xDecimalPlaces",
      "minX",
      "maxX",
      "minY",
      "maxY",
      "scatterPointSize",
      "scatterPointShape",
      "scatterPointStroke",
      "scatterPointStrokeWidth",
      "scatterIncludeZero",
      "scatterShowTrendLine",
      "scatterTrendLineColor",
      "scatterXReferenceValue",
      "scatterXReferenceLabel",
      "scatterYReferenceValue",
      "scatterYReferenceLabel",
      "scatterPointStyles",
    ],
    treemap: [...common, "barRadius", "treemapTileStyles"],
    heatmap: [
      ...common,
      "showGridlines",
      "showXAxis",
      "showYAxis",
      "heatmapScaleType",
      "heatmapScaleScope",
      "heatmapMinColor",
      "heatmapMidColor",
      "heatmapMaxColor",
      "heatmapMidpoint",
      "heatmapMinValue",
      "heatmapMaxValue",
      "heatmapReverse",
      "heatmapMissingColor",
      "heatmapCellGap",
      "heatmapCellRadius",
      "heatmapCellStyles",
    ],
  };
  const allowed = byType[type];
  if (!allowed)
    throw new TypeError(`${type} blocks do not accept chart settings.`);
  const invalid = Object.keys(patch).filter((key) => !allowed.includes(key));
  if (invalid.length)
    throw new TypeError(
      `${type} chart settings do not include: ${invalid.join(", ")}.`,
    );
}

function validateSankeyNodeOverrides(value: unknown, path: string) {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  const seen = new Set<string>();
  (value as unknown[]).forEach((entry, index) => {
    const itemPath = `${path}[${index}]`;
    const override = plainObject(entry, itemPath);
    rejectUnknownKeys(
      override,
      ["node", "color", "label", "highlighted"],
      itemPath,
    );
    rejectUndefinedExcept(override, [], itemPath);
    if (typeof override.node !== "string" || !override.node.trim())
      throw new TypeError(`${itemPath}.node must be a non-empty string.`);
    if (seen.has(override.node))
      throw new TypeError(`${path} contains duplicate node ${override.node}.`);
    seen.add(override.node);
    if (override.color !== undefined)
      hexColor(override.color, `${itemPath}.color`);
    if (override.label !== undefined && typeof override.label !== "string")
      throw new TypeError(`${itemPath}.label must be a string.`);
    if (override.highlighted !== undefined)
      booleanValue(override.highlighted, `${itemPath}.highlighted`);
    if (
      !["color", "label", "highlighted"].some(
        (key) => override[key] !== undefined,
      )
    )
      throw new TypeError(`${itemPath} must include a style override.`);
  });
}

function validateSankeyLinkOverrides(value: unknown, path: string) {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  const seen = new Set<string>();
  (value as unknown[]).forEach((entry, index) => {
    const itemPath = `${path}[${index}]`;
    const override = plainObject(entry, itemPath);
    rejectUnknownKeys(
      override,
      ["source", "target", "color", "opacity", "highlighted"],
      itemPath,
    );
    rejectUndefinedExcept(override, [], itemPath);
    ["source", "target"].forEach((key) => {
      if (typeof override[key] !== "string" || !override[key].trim())
        throw new TypeError(`${itemPath}.${key} must be a non-empty string.`);
    });
    const selector = `${override.source}\u0000${override.target}`;
    if (seen.has(selector))
      throw new TypeError(
        `${path} contains duplicate link ${override.source} to ${override.target}.`,
      );
    seen.add(selector);
    if (override.color !== undefined)
      hexColor(override.color, `${itemPath}.color`);
    if (override.opacity !== undefined)
      finiteNumber(override.opacity, `${itemPath}.opacity`, 0.05, 1);
    if (override.highlighted !== undefined)
      booleanValue(override.highlighted, `${itemPath}.highlighted`);
    if (
      !["color", "opacity", "highlighted"].some(
        (key) => override[key] !== undefined,
      )
    )
      throw new TypeError(`${itemPath} must include a style override.`);
  });
}

function validateHeatmapCellStyles(value: unknown, path: string) {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  if (value.length > 250)
    throw new TypeError(`${path} supports at most 250 targeted cells.`);
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const itemPath = `${path}[${index}]`;
    const style = plainObject(entry, itemPath);
    rejectUnknownKeys(
      style,
      ["rowLabel", "rowIndex", "column", "color", "textColor"],
      itemPath,
    );
    rejectUndefinedExcept(style, [], itemPath);
    const hasLabel =
      typeof style.rowLabel === "string" && style.rowLabel.trim().length > 0;
    const hasRow = style.rowIndex !== undefined;
    if (hasLabel === hasRow)
      throw new TypeError(
        `${itemPath} must select a row with exactly one of rowLabel or rowIndex.`,
      );
    if (hasRow)
      integerNumber(
        style.rowIndex,
        `${itemPath}.rowIndex`,
        1,
        Number.MAX_SAFE_INTEGER,
      );
    if (typeof style.column !== "string" || !style.column.trim())
      throw new TypeError(`${itemPath}.column must be a non-empty string.`);
    if (style.color !== undefined) hexColor(style.color, `${itemPath}.color`);
    if (style.textColor !== undefined)
      hexColor(style.textColor, `${itemPath}.textColor`);
    if (style.color === undefined && style.textColor === undefined)
      throw new TypeError(`${itemPath} must include color or textColor.`);
    const selector = hasLabel
      ? `label:${style.rowLabel}\u0000${style.column}`
      : `row:${style.rowIndex}\u0000${style.column}`;
    if (seen.has(selector))
      throw new TypeError(`${path} contains duplicate cell ${selector}.`);
    seen.add(selector);
  });
}

function validateScatterPointStyles(value: unknown, path: string) {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  const seen = new Set<string>();
  (value as unknown[]).forEach((entry, index) => {
    const itemPath = `${path}[${index}]`;
    const style = plainObject(entry, itemPath);
    rejectUnknownKeys(
      style,
      ["label", "rowIndex", "color", "size", "opacity", "shape"],
      itemPath,
    );
    rejectUndefinedExcept(style, [], itemPath);
    const hasLabel = typeof style.label === "string" && style.label.length > 0;
    const hasRow = style.rowIndex !== undefined;
    if (hasLabel === hasRow)
      throw new TypeError(
        `${itemPath} must select a point with exactly one of label or rowIndex.`,
      );
    if (style.label !== undefined && !hasLabel)
      throw new TypeError(`${itemPath}.label must be a non-empty string.`);
    if (hasRow)
      integerNumber(
        style.rowIndex,
        `${itemPath}.rowIndex`,
        1,
        Number.MAX_SAFE_INTEGER,
      );
    if (style.color !== undefined) hexColor(style.color, `${itemPath}.color`);
    if (style.size !== undefined)
      finiteNumber(style.size, `${itemPath}.size`, 2, 20);
    if (style.opacity !== undefined)
      finiteNumber(style.opacity, `${itemPath}.opacity`, 0.1, 1);
    if (style.shape !== undefined)
      enumValue(
        style.shape,
        ["circle", "square", "diamond"],
        `${itemPath}.shape`,
      );
    if (
      !["color", "size", "opacity", "shape"].some(
        (key) => style[key] !== undefined,
      )
    )
      throw new TypeError(`${itemPath} must include an appearance override.`);
    const selector = hasLabel
      ? `label:${style.label}`
      : `row:${style.rowIndex}`;
    if (seen.has(selector))
      throw new TypeError(`${path} contains duplicate selector ${selector}.`);
    seen.add(selector);
  });
}

function validateLineSeriesStyles(value: unknown, path: string) {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  if (value.length > 8)
    throw new TypeError(`${path} supports at most 8 series overrides.`);
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const style = validateLineSeriesStyle(entry, `${path}[${index}]`);
    if (seen.has(style.series))
      throw new TypeError(`${path} contains duplicate series ${style.series}.`);
    seen.add(style.series);
  });
}

function validateLineSeriesStyle(
  value: unknown,
  path: string,
): LineSeriesStyle {
  const style = plainObject(value, path);
  rejectUnknownKeys(
    style,
    [
      "series",
      "color",
      "lineWidth",
      "lineDash",
      "opacity",
      "showPoints",
      "pointSize",
      "pointShape",
    ],
    path,
  );
  rejectUndefinedExcept(style, [], path);
  if (typeof style.series !== "string" || !style.series.trim())
    throw new TypeError(`${path}.series must be a non-empty string.`);
  if (style.color !== undefined) hexColor(style.color, `${path}.color`);
  if (style.lineWidth !== undefined)
    finiteNumber(style.lineWidth, `${path}.lineWidth`, 1, 8);
  if (style.lineDash !== undefined)
    enumValue(
      style.lineDash,
      ["solid", "dashed", "dotted"],
      `${path}.lineDash`,
    );
  if (style.opacity !== undefined)
    finiteNumber(style.opacity, `${path}.opacity`, 0.1, 1);
  if (style.showPoints !== undefined)
    booleanValue(style.showPoints, `${path}.showPoints`);
  if (style.pointSize !== undefined)
    finiteNumber(style.pointSize, `${path}.pointSize`, 1, 12);
  if (style.pointShape !== undefined)
    enumValue(
      style.pointShape,
      ["circle", "square", "diamond"],
      `${path}.pointShape`,
    );
  if (
    ![
      "color",
      "lineWidth",
      "lineDash",
      "opacity",
      "showPoints",
      "pointSize",
      "pointShape",
    ].some((key) => style[key] !== undefined)
  )
    throw new TypeError(`${path} must include a style override.`);
  return { ...style, series: style.series.trim() } as LineSeriesStyle;
}

function validateLinePointStyles(value: unknown, path: string) {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  if (value.length > 200)
    throw new TypeError(`${path} supports at most 200 point overrides.`);
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const style = validateLinePointStyle(entry, `${path}[${index}]`);
    const key = `${style.series}\u0000${style.category}`;
    if (seen.has(key))
      throw new TypeError(
        `${path} contains a duplicate series/category target.`,
      );
    seen.add(key);
  });
}

function validateLinePointStyle(value: unknown, path: string): LinePointStyle {
  const style = plainObject(value, path);
  rejectUnknownKeys(
    style,
    ["series", "category", "color", "pointSize", "pointShape", "showLabel"],
    path,
  );
  rejectUndefinedExcept(style, [], path);
  if (typeof style.series !== "string" || !style.series.trim())
    throw new TypeError(`${path}.series must be a non-empty string.`);
  if (typeof style.category !== "string" || !style.category.trim())
    throw new TypeError(`${path}.category must be a non-empty string.`);
  if (style.color !== undefined) hexColor(style.color, `${path}.color`);
  if (style.pointSize !== undefined)
    finiteNumber(style.pointSize, `${path}.pointSize`, 1, 12);
  if (style.pointShape !== undefined)
    enumValue(
      style.pointShape,
      ["circle", "square", "diamond"],
      `${path}.pointShape`,
    );
  if (style.showLabel !== undefined)
    booleanValue(style.showLabel, `${path}.showLabel`);
  if (
    !["color", "pointSize", "pointShape", "showLabel"].some(
      (key) => style[key] !== undefined,
    )
  )
    throw new TypeError(`${path} must include a point override.`);
  return {
    ...style,
    series: style.series.trim(),
    category: style.category.trim(),
  } as LinePointStyle;
}

function validateLineChartConfiguration(block: DashboardBlock) {
  if (
    block.chart.minY !== undefined &&
    block.chart.maxY !== undefined &&
    block.chart.minY >= block.chart.maxY
  )
    throw new TypeError("A line chart's minY must be lower than maxY.");
  const series = block.valueFields.length
    ? block.valueFields
    : block.valueField
      ? [block.valueField]
      : [];
  if (series.length > 8)
    throw new TypeError("A line chart supports at most 8 value fields.");
  if (new Set(series).size !== series.length)
    throw new TypeError("A line chart cannot bind the same value field twice.");
  const seriesStyles = block.chart.lineSeriesStyles ?? [];
  const pointStyles = block.chart.linePointStyles ?? [];
  validateLineSeriesStyles(seriesStyles, "chart.lineSeriesStyles");
  validateLinePointStyles(pointStyles, "chart.linePointStyles");
  [...seriesStyles, ...pointStyles].forEach((style) => {
    if (!series.includes(style.series))
      throw new TypeError(
        `Line style series ${style.series} must match a bound value field.`,
      );
  });
}

function validateLineChartBinding(
  project: TesseraProject,
  block: DashboardBlock,
) {
  const table = tableForBlock(project, block);
  if (!table)
    throw new TypeError(
      "The selected dataset period has no cleaned table to plot.",
    );
  const series = block.valueFields.length
    ? block.valueFields
    : block.valueField
      ? [block.valueField]
      : [];
  const fields = [block.categoryField, ...series].filter(
    (field): field is string => Boolean(field),
  );
  const missing = fields.filter((field) => !table.columns.includes(field));
  if (missing.length)
    throw new TypeError(
      `Line chart fields were not found in the selected cleaned table: ${missing.join(", ")}.`,
    );
  const nonNumeric = series.filter((field) => {
    const index = table.columns.indexOf(field);
    return !table.rows.some((row) => chartNumericValue(row[index]) !== null);
  });
  if (nonNumeric.length)
    throw new TypeError(
      `Line chart value fields must contain numeric data: ${nonNumeric.join(", ")}.`,
    );
}

function chartNumericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validateCategoryStyles(
  value: unknown,
  path: string,
  allowed: string[],
) {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const itemPath = `${path}[${index}]`;
    const style = plainObject(entry, itemPath);
    rejectUnknownKeys(style, ["category", ...allowed], itemPath);
    rejectUndefinedExcept(style, [], itemPath);
    if (typeof style.category !== "string" || !style.category.trim())
      throw new TypeError(`${itemPath}.category must be a non-empty string.`);
    if (seen.has(style.category))
      throw new TypeError(
        `${path} contains duplicate category ${style.category}.`,
      );
    seen.add(style.category);
    ["color", "textColor"].forEach((key) => {
      if (style[key] !== undefined) hexColor(style[key], `${itemPath}.${key}`);
    });
    if (style.opacity !== undefined)
      finiteNumber(style.opacity, `${itemPath}.opacity`, 0.1, 1);
  });
}

function validateDonutSliceStyles(value: unknown, path: string) {
  validateCategoryStyles(value, path, ["color", "opacity"]);
}

function validateTreemapTileStyles(value: unknown, path: string) {
  validateCategoryStyles(value, path, ["color", "textColor", "opacity"]);
}

function validateBarColorOverrides(value: unknown) {
  if (!Array.isArray(value))
    throw new TypeError("patch.chart.barColorOverrides must be an array.");
  if (value.length > 100)
    throw new TypeError(
      "patch.chart.barColorOverrides supports at most 100 targeted bars.",
    );
  const seen = new Set<string>();
  value.forEach((candidate, index) => {
    const label = `patch.chart.barColorOverrides[${index}]`;
    const override = plainObject(candidate, label);
    rejectUnknownKeys(override, ["category", "series", "color"], label);
    rejectUndefinedExcept(override, ["series"], label);
    if (typeof override.category !== "string" || !override.category.trim())
      throw new TypeError(`${label}.category must be a non-empty string.`);
    if (
      override.series !== undefined &&
      (typeof override.series !== "string" || !override.series.trim())
    )
      throw new TypeError(
        `${label}.series must be a non-empty string when set.`,
      );
    hexColor(override.color, `${label}.color`);
    const key = `${override.category}\u0000${String(override.series ?? "")}`;
    if (seen.has(key))
      throw new TypeError(
        `${label} duplicates an earlier category/series target.`,
      );
    seen.add(key);
  });
}

function validateGaugePatch(value: unknown) {
  const gauge = plainObject(value, "patch.gauge");
  const booleanFields = [
    "showValue",
    "showTarget",
    "showScaleLabels",
    "showPercentOfTarget",
    "showRangeLabels",
    "roundedEnds",
  ];
  rejectUnknownKeys(
    gauge,
    [
      "aggregation",
      "display",
      "min",
      "max",
      "targetValue",
      "valueLabel",
      "targetLabel",
      ...booleanFields,
      "arcWidth",
      "colors",
      "ranges",
    ],
    "patch.gauge",
  );
  rejectUndefinedExcept(gauge, ["min", "max", "targetValue"], "patch.gauge");
  if (gauge.aggregation !== undefined)
    enumValue(
      gauge.aggregation,
      ["sum", "average", "minimum", "maximum", "count", "first", "last"],
      "patch.gauge.aggregation",
    );
  if (gauge.display !== undefined)
    enumValue(gauge.display, ["progress", "dial"], "patch.gauge.display");
  ["min", "max", "targetValue"].forEach((key) =>
    optionalFiniteNumber(gauge, key, `patch.gauge.${key}`),
  );
  validateStringFields(gauge, ["valueLabel", "targetLabel"]);
  booleanFields.forEach((key) => {
    if (gauge[key] !== undefined)
      booleanValue(gauge[key], `patch.gauge.${key}`);
  });
  if (gauge.arcWidth !== undefined)
    finiteNumber(gauge.arcWidth, "patch.gauge.arcWidth", 8, 40);
  if (gauge.colors !== undefined) {
    const colors = plainObject(gauge.colors, "patch.gauge.colors");
    rejectUnknownKeys(
      colors,
      ["track", "value", "target", "needle"],
      "patch.gauge.colors",
    );
    rejectUndefinedExcept(colors, [], "patch.gauge.colors");
    Object.entries(colors).forEach(([key, color]) =>
      hexColor(color, `patch.gauge.colors.${key}`),
    );
  }
  if (gauge.ranges !== undefined)
    validateGaugeRanges(gauge.ranges, "patch.gauge.ranges");
}

function validateGaugeSettings(gauge: DashboardBlock["gauge"]) {
  validateGaugePatch(gauge);
  const min = gauge.min ?? 0;
  const max = gauge.max;
  if (max !== undefined && max <= min)
    throw new TypeError("Gauge maximum must be greater than its minimum.");
}

function validateGaugeRanges(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  const ids = new Set<string>();
  value.forEach((candidate, index) => {
    const range = plainObject(candidate, `${label}[${index}]`);
    rejectUnknownKeys(
      range,
      ["id", "label", "from", "to", "color"],
      `${label}[${index}]`,
    );
    ["id", "label", "color"].forEach((key) => {
      if (typeof range[key] !== "string")
        throw new TypeError(`${label}[${index}].${key} must be a string.`);
    });
    if (!String(range.id).trim())
      throw new TypeError(`${label}[${index}].id must not be empty.`);
    if (ids.has(String(range.id)))
      throw new TypeError(
        `${label} contains duplicate id ${String(range.id)}.`,
      );
    ids.add(String(range.id));
    finiteNumber(range.from, `${label}[${index}].from`);
    finiteNumber(range.to, `${label}[${index}].to`);
    if (Number(range.to) <= Number(range.from))
      throw new TypeError(`${label}[${index}].to must be greater than from.`);
    hexColor(range.color, `${label}[${index}].color`);
  });
}

function validateTablePatch(value: unknown) {
  const table = plainObject(value, "patch.table");
  const booleanFields = [
    "striped",
    "compact",
    "columnGridlines",
    "rowGridlines",
    "stickyHeader",
    "freezeFirstColumn",
    "showSearch",
    "showDatasetName",
    "showRowCount",
    "showRowNumbers",
    "showColumnHeaders",
    "boldLastRow",
    "showTotals",
    "negativeParens",
    "negativeRed",
    "wrapText",
    "heatmap",
  ];
  rejectUnknownKeys(
    table,
    [
      "visibleColumns",
      "rowLimit",
      "sortColumn",
      "sortDirection",
      "sortRules",
      ...booleanFields,
      "totalsLabel",
      "totalColumns",
      "numberFormat",
      "decimalPlaces",
      "nullDisplay",
      "heatmapColor",
      "headerBackgroundColor",
      "headerTextColor",
      "rowBackgroundColor",
      "alternateRowBackgroundColor",
      "cellTextColor",
      "gridColor",
      "colorByColumn",
      "groupPalette",
      "groupColors",
      "columnStyles",
      "cellStyles",
    ],
    "patch.table",
  );
  rejectUndefinedExcept(table, [], "patch.table");
  if (table.visibleColumns !== undefined)
    stringArray(table.visibleColumns, "patch.table.visibleColumns");
  if (table.totalColumns !== undefined)
    stringArray(table.totalColumns, "patch.table.totalColumns");
  if (table.rowLimit !== undefined)
    integerNumber(table.rowLimit, "patch.table.rowLimit", 1, 500);
  if (table.decimalPlaces !== undefined)
    integerNumber(table.decimalPlaces, "patch.table.decimalPlaces", 0, 6);
  validateStringFields(table, [
    "sortColumn",
    "totalsLabel",
    "nullDisplay",
    "colorByColumn",
  ]);
  if (table.sortDirection !== undefined)
    enumValue(
      table.sortDirection,
      ["none", "ascending", "descending"],
      "patch.table.sortDirection",
    );
  booleanFields.forEach((key) => {
    if (table[key] !== undefined)
      booleanValue(table[key], `patch.table.${key}`);
  });
  if (table.numberFormat !== undefined)
    enumValue(
      table.numberFormat,
      ["auto", "number", "compact", "percent", "currency"],
      "patch.table.numberFormat",
    );
  [
    "heatmapColor",
    "headerBackgroundColor",
    "headerTextColor",
    "rowBackgroundColor",
    "alternateRowBackgroundColor",
    "cellTextColor",
    "gridColor",
  ].forEach((key) => {
    if (table[key] !== undefined) hexColor(table[key], `patch.table.${key}`);
  });
  if (table.sortRules !== undefined)
    validateTableSortRules(table.sortRules, "patch.table.sortRules");
  if (table.groupPalette !== undefined) {
    if (!Array.isArray(table.groupPalette) || !table.groupPalette.length)
      throw new TypeError(
        "patch.table.groupPalette must contain at least one color.",
      );
    table.groupPalette.forEach((color, index) =>
      hexColor(color, `patch.table.groupPalette[${index}]`),
    );
  }
  if (table.groupColors !== undefined)
    validateTableGroupColors(table.groupColors, "patch.table.groupColors");
  if (table.columnStyles !== undefined)
    validateTableColumnStyles(table.columnStyles, "patch.table.columnStyles");
  if (table.cellStyles !== undefined)
    validateTableCellStyles(table.cellStyles, "patch.table.cellStyles");
}

function validateTableSortRules(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  if (value.length > 8)
    throw new TypeError(`${label} supports at most eight sort levels.`);
  const columns = new Set<string>();
  value.forEach((candidate, index) => {
    const itemLabel = `${label}[${index}]`;
    const rule = plainObject(candidate, itemLabel);
    rejectUnknownKeys(rule, ["column", "direction"], itemLabel);
    rejectUndefinedExcept(rule, [], itemLabel);
    if (typeof rule.column !== "string" || !rule.column.trim())
      throw new TypeError(`${itemLabel}.column must be a non-empty string.`);
    if (columns.has(rule.column))
      throw new TypeError(`${label} cannot sort ${rule.column} twice.`);
    columns.add(rule.column);
    enumValue(
      rule.direction,
      ["ascending", "descending"],
      `${itemLabel}.direction`,
    );
  });
}

function validateTableGroupColors(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  const values = new Set<string>();
  value.forEach((candidate, index) => {
    const itemLabel = `${label}[${index}]`;
    const color = plainObject(candidate, itemLabel);
    rejectUnknownKeys(
      color,
      ["value", "backgroundColor", "textColor"],
      itemLabel,
    );
    rejectUndefinedExcept(color, [], itemLabel);
    if (typeof color.value !== "string")
      throw new TypeError(`${itemLabel}.value must be a string.`);
    if (values.has(color.value))
      throw new TypeError(`${label} cannot target ${color.value} twice.`);
    values.add(color.value);
    hexColor(color.backgroundColor, `${itemLabel}.backgroundColor`);
    if (color.textColor !== undefined)
      hexColor(color.textColor, `${itemLabel}.textColor`);
  });
}

function validateTableColumnStyles(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  const seen = new Set<string>();
  value.forEach((candidate, index) => {
    const itemLabel = `${label}[${index}]`;
    const style = plainObject(candidate, itemLabel);
    rejectUnknownKeys(
      style,
      [
        "column",
        "label",
        "width",
        "align",
        "wrap",
        "numberFormat",
        "decimalPlaces",
        "prefix",
        "suffix",
        "backgroundColor",
        "textColor",
        "headerBackgroundColor",
        "headerTextColor",
      ],
      itemLabel,
    );
    rejectUndefinedExcept(style, [], itemLabel);
    if (typeof style.column !== "string" || !style.column.trim())
      throw new TypeError(`${itemLabel}.column must be a non-empty string.`);
    if (seen.has(style.column))
      throw new TypeError(`${label} cannot target ${style.column} twice.`);
    seen.add(style.column);
    validateStringFields(style, ["label", "prefix", "suffix"]);
    if (style.width !== undefined)
      integerNumber(style.width, `${itemLabel}.width`, 48, 600);
    if (style.align !== undefined)
      enumValue(
        style.align,
        ["auto", "left", "center", "right"],
        `${itemLabel}.align`,
      );
    if (style.wrap !== undefined) booleanValue(style.wrap, `${itemLabel}.wrap`);
    if (style.numberFormat !== undefined)
      enumValue(
        style.numberFormat,
        ["auto", "number", "compact", "percent", "currency"],
        `${itemLabel}.numberFormat`,
      );
    if (style.decimalPlaces !== undefined)
      integerNumber(style.decimalPlaces, `${itemLabel}.decimalPlaces`, 0, 6);
    [
      "backgroundColor",
      "textColor",
      "headerBackgroundColor",
      "headerTextColor",
    ].forEach((key) => {
      if (style[key] !== undefined) hexColor(style[key], `${itemLabel}.${key}`);
    });
  });
}

function validateTableCellStyles(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  value.forEach((candidate, index) => {
    const itemLabel = `${label}[${index}]`;
    const style = plainObject(candidate, itemLabel);
    rejectUnknownKeys(
      style,
      [
        "column",
        "rowIndex",
        "matchColumn",
        "matchValue",
        "backgroundColor",
        "textColor",
        "fontWeight",
        "textAlign",
      ],
      itemLabel,
    );
    rejectUndefinedExcept(style, [], itemLabel);
    if (typeof style.column !== "string" || !style.column.trim())
      throw new TypeError(`${itemLabel}.column must be a non-empty string.`);
    if (style.rowIndex !== undefined)
      integerNumber(style.rowIndex, `${itemLabel}.rowIndex`, 1, 1000000);
    const hasMatchColumn = typeof style.matchColumn === "string";
    const hasMatchValue = typeof style.matchValue === "string";
    if (style.rowIndex === undefined && !(hasMatchColumn && hasMatchValue))
      throw new TypeError(
        `${itemLabel} needs rowIndex or both matchColumn and matchValue.`,
      );
    if (hasMatchColumn !== hasMatchValue)
      throw new TypeError(
        `${itemLabel}.matchColumn and matchValue must be provided together.`,
      );
    ["backgroundColor", "textColor"].forEach((key) => {
      if (style[key] !== undefined) hexColor(style[key], `${itemLabel}.${key}`);
    });
    if (style.fontWeight !== undefined)
      enumValue(
        style.fontWeight,
        ["normal", "medium", "bold"],
        `${itemLabel}.fontWeight`,
      );
    if (style.textAlign !== undefined)
      enumValue(
        style.textAlign,
        ["left", "center", "right"],
        `${itemLabel}.textAlign`,
      );
  });
}

function validateKpiPatch(value: unknown) {
  const kpi = plainObject(value, "patch.kpi");
  rejectUnknownKeys(
    kpi,
    [
      "aggregation",
      "valueFormat",
      "decimalPlaces",
      "prefix",
      "suffix",
      "icon",
      "comparisonLabel",
      "comparisonValue",
      "targetValue",
      "showProgress",
      "positiveDirection",
    ],
    "patch.kpi",
  );
  rejectUndefinedExcept(kpi, ["comparisonValue", "targetValue"], "patch.kpi");
  if (kpi.aggregation !== undefined)
    enumValue(
      kpi.aggregation,
      ["sum", "average", "count", "minimum", "maximum", "first", "last"],
      "patch.kpi.aggregation",
    );
  if (kpi.valueFormat !== undefined)
    enumValue(
      kpi.valueFormat,
      ["auto", "number", "compact", "percent", "currency"],
      "patch.kpi.valueFormat",
    );
  if (kpi.decimalPlaces !== undefined)
    integerNumber(kpi.decimalPlaces, "patch.kpi.decimalPlaces", 0, 6);
  validateStringFields(kpi, ["prefix", "suffix", "comparisonLabel"]);
  if (kpi.icon !== undefined)
    enumValue(kpi.icon, KPI_ICON_NAMES, "patch.kpi.icon");
  optionalFiniteNumber(kpi, "comparisonValue", "patch.kpi.comparisonValue");
  optionalFiniteNumber(kpi, "targetValue", "patch.kpi.targetValue");
  if (kpi.showProgress !== undefined)
    booleanValue(kpi.showProgress, "patch.kpi.showProgress");
  if (kpi.positiveDirection !== undefined)
    enumValue(
      kpi.positiveDirection,
      ["up", "down"],
      "patch.kpi.positiveDirection",
    );
}

function validateIllustrationSettings(value: DashboardBlock["illustration"]) {
  validateIllustrationPatch(value);
  if (!value.altText.trim())
    throw new TypeError("Illustration altText must not be empty.");
  if (value.preset === "custom" && !value.bitmapMask)
    throw new TypeError("Custom illustrations require a packed bitmap mask.");
  if (value.preset !== "custom" && value.bitmapMask)
    throw new TypeError(
      "Approved illustration presets cannot carry a custom bitmap mask.",
    );
}

function validateIllustrationPatch(value: unknown) {
  const illustration = plainObject(value, "patch.illustration");
  rejectUnknownKeys(
    illustration,
    [
      "preset",
      "altText",
      "primaryColor",
      "showCaption",
      "libraryAssetId",
      "bitmapMask",
      "accentColor",
      "strokeWidth",
      "elements",
    ],
    "patch.illustration",
  );
  rejectUndefinedExcept(illustration, [], "patch.illustration");
  if (illustration.preset !== undefined)
    enumValue(
      illustration.preset,
      [...ILLUSTRATION_PRESET_NAMES, "custom"],
      "patch.illustration.preset",
    );
  validateStringFields(illustration, ["altText"]);
  if (illustration.primaryColor !== undefined)
    hexColor(illustration.primaryColor, "patch.illustration.primaryColor");
  if (illustration.showCaption !== undefined)
    booleanValue(illustration.showCaption, "patch.illustration.showCaption");
  validateStringFields(illustration, ["libraryAssetId"]);
  if (illustration.bitmapMask !== undefined && illustration.bitmapMask !== null)
    validateIllustrationBitmapMask(illustration.bitmapMask);
  if (illustration.accentColor !== undefined)
    hexColor(illustration.accentColor, "patch.illustration.accentColor");
  if (illustration.strokeWidth !== undefined)
    finiteNumber(
      illustration.strokeWidth,
      "patch.illustration.strokeWidth",
      2.5,
      4,
    );
  if (illustration.elements !== undefined) {
    if (!Array.isArray(illustration.elements))
      throw new TypeError("patch.illustration.elements must be an array.");
    if (illustration.elements.length)
      throw new TypeError(
        "Custom vector elements are no longer accepted; choose an approved illustration preset.",
      );
  }
}

function validateIllustrationBitmapMask(value: unknown) {
  const label = "patch.illustration.bitmapMask";
  const mask = plainObject(value, label);
  rejectUnknownKeys(
    mask,
    ["encoding", "contractVersion", "width", "height", "bits"],
    label,
  );
  rejectUndefinedExcept(mask, [], label);
  enumValue(mask.encoding, ILLUSTRATION_MASK_ENCODINGS, `${label}.encoding`);
  enumValue(
    mask.contractVersion,
    [ILLUSTRATION_STYLE_CONTRACT_VERSION],
    `${label}.contractVersion`,
  );
  const isAlphaPng = mask.encoding === ILLUSTRATION_ALPHA_MASK_ENCODING;
  integerNumber(mask.width, `${label}.width`, 64, isAlphaPng ? 768 : 320);
  integerNumber(mask.height, `${label}.height`, 48, isAlphaPng ? 512 : 240);
  const width = Number(mask.width);
  const height = Number(mask.height);
  const pixels = width * height;
  const maximumPixels = isAlphaPng ? 393_216 : 65_536;
  if (pixels > maximumPixels)
    throw new RangeError(
      `${label} may contain at most ${maximumPixels.toLocaleString()} pixels.`,
    );
  const aspectRatio = width / height;
  if (aspectRatio < 1.35 || aspectRatio > 1.8)
    throw new RangeError(
      `${label} must use a landscape editorial aspect ratio between 1.35:1 and 1.8:1.`,
    );
  if (
    typeof mask.bits !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(mask.bits)
  )
    throw new TypeError(`${label}.bits must be standard base64.`);
  let bytes: Uint8Array;
  try {
    bytes = decodeIllustrationMaskBits({
      encoding: ILLUSTRATION_MASK_ENCODING,
      contractVersion: ILLUSTRATION_STYLE_CONTRACT_VERSION,
      width,
      height,
      bits: mask.bits,
    });
  } catch {
    throw new TypeError(`${label}.bits must be valid base64.`);
  }
  if (isAlphaPng) {
    const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (
      bytes.length < 33 ||
      pngSignature.some((byte, index) => bytes[index] !== byte) ||
      String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR"
    )
      throw new TypeError(`${label}.bits must contain PNG file bytes.`);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const pngWidth = view.getUint32(16);
    const pngHeight = view.getUint32(20);
    if (pngWidth !== width || pngHeight !== height)
      throw new RangeError(
        `${label} dimensions ${width} × ${height} do not match the PNG's ${pngWidth} × ${pngHeight}.`,
      );
    const bitDepth = bytes[24];
    const colorType = bytes[25];
    if (bitDepth !== 8 || (colorType !== 4 && colorType !== 6))
      throw new TypeError(
        `${label}.bits must be an 8-bit PNG with an alpha channel.`,
      );
    return;
  }
  const expectedBytes = illustrationMaskByteLength(width, height);
  if (bytes.length !== expectedBytes)
    throw new RangeError(
      `${label}.bits decodes to ${bytes.length} bytes; ${expectedBytes} are required for ${width} × ${height}.`,
    );
  const unusedBits = bytes.length * 8 - pixels;
  if (unusedBits && bytes.at(-1)! & ((1 << unusedBits) - 1))
    throw new TypeError(`${label}.bits must leave unused trailing bits off.`);
  let onPixels = 0;
  for (let pixel = 0; pixel < pixels; pixel += 1)
    if (illustrationMaskPixelIsOn(bytes, pixel)) onPixels += 1;
  const minimumOnPixels = Math.max(16, Math.ceil(pixels * 0.003));
  if (onPixels < minimumOnPixels)
    throw new RangeError(
      `${label} is effectively empty; at least ${minimumOnPixels} pixels must be on.`,
    );
  if (onPixels > Math.floor(pixels * 0.72))
    throw new RangeError(
      `${label} is too dense for transparent editorial line art; no more than 72% of pixels may be on.`,
    );
}

function validateLayoutPatch(value: unknown) {
  const layout = plainObject(value, "patch.layout");
  rejectUnknownKeys(layout, ["width", "minHeight", "stackId"], "patch.layout");
  rejectUndefinedExcept(layout, [], "patch.layout");
  if (layout.width !== undefined) validateLayoutWidth(layout.width);
  if (layout.minHeight !== undefined)
    finiteNumber(
      layout.minHeight,
      "patch.layout.minHeight",
      MIN_BLOCK_HEIGHT,
      MAX_BLOCK_HEIGHT,
    );
  if (
    layout.stackId !== undefined &&
    (typeof layout.stackId !== "string" || layout.stackId.length > 160)
  )
    throw new TypeError(
      "patch.layout.stackId must be a string of at most 160 characters.",
    );
}

function normalizeDashboardStacks(blocks: DashboardBlock[]) {
  let index = 0;
  while (index < blocks.length) {
    const stackId = blocks[index].layout.stackId;
    if (!stackId) {
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < blocks.length && blocks[end].layout.stackId === stackId)
      end += 1;
    if (end - index === 1) delete blocks[index].layout.stackId;
    index = end;
  }
}

function appendWebMCPBlock(
  blocks: DashboardBlock[],
  block: DashboardBlock,
  preferredWidth: DashboardBlock["layout"]["width"],
) {
  const width = Math.max(
    MIN_BLOCK_WIDTH,
    Math.min(CANVAS_COLUMNS, Math.round(preferredWidth)),
  ) as DashboardBlock["layout"]["width"];
  block.layout.width = CANVAS_COLUMNS;
  delete block.layout.stackId;
  if (!blocks.length || width === CANVAS_COLUMNS) {
    blocks.push(block);
    return;
  }

  const lastRow = dashboardLayoutRows(blocks).at(-1);
  const startsAfterDivider = lastRow?.some((cell) =>
    cell.some((candidate) =>
      ["sectionHeader", "heading"].includes(candidate.type),
    ),
  );
  const available = CANVAS_COLUMNS - width;
  if (
    !lastRow ||
    startsAfterDivider ||
    lastRow.length >= MAX_BLOCKS_PER_ROW ||
    available < lastRow.length * MIN_BLOCK_WIDTH
  ) {
    blocks.push(block);
    return;
  }

  const base = Math.floor(available / lastRow.length);
  let remainder = available - base * lastRow.length;
  lastRow.forEach((cell) => {
    const nextWidth = (base +
      (remainder > 0 ? 1 : 0)) as DashboardBlock["layout"]["width"];
    remainder -= remainder > 0 ? 1 : 0;
    cell.forEach((candidate) => {
      candidate.layout.width = nextWidth;
    });
  });
  block.layout.width = width;
  blocks.push(block);
}

function dashboardLayoutRows(blocks: DashboardBlock[]) {
  const cells: DashboardBlock[][] = [];
  for (const block of blocks) {
    const previous = cells.at(-1);
    if (
      block.layout.stackId &&
      previous?.[0].layout.stackId === block.layout.stackId
    )
      previous.push(block);
    else cells.push([block]);
  }

  const rows: DashboardBlock[][][] = [];
  let row: DashboardBlock[][] = [];
  let used = 0;
  for (const cell of cells) {
    const width = cell[0].layout.width;
    if (used > 0 && used + width > 12) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push(cell);
    used += width;
    if (used === 12) {
      rows.push(row);
      row = [];
      used = 0;
    }
  }
  if (row.length) rows.push(row);
  return rows;
}

function normalizeDashboardRowWidths(blocks: DashboardBlock[]) {
  const rows = dashboardLayoutRows(blocks);

  for (const cellsInRow of rows) {
    const total = cellsInRow.reduce(
      (sum, cell) => sum + cell[0].layout.width,
      0,
    );
    if (total === 12) continue;
    const ideals = cellsInRow.map((cell) =>
      Math.max(3, (12 * cell[0].layout.width) / total),
    );
    const widths = ideals.map((ideal) => Math.max(3, Math.floor(ideal)));
    let allocated = widths.reduce((sum, width) => sum + width, 0);
    while (allocated < 12) {
      let best = 0;
      for (let index = 1; index < widths.length; index += 1)
        if (ideals[index] - widths[index] > ideals[best] - widths[best])
          best = index;
      widths[best] += 1;
      allocated += 1;
    }
    while (allocated > 12) {
      let best = -1;
      for (let index = 0; index < widths.length; index += 1) {
        if (widths[index] <= 3) continue;
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
    cellsInRow.forEach((cell, index) => {
      const width = widths[index] as DashboardBlock["layout"]["width"];
      cell.forEach((block) => {
        block.layout.width = width;
      });
    });
  }
}

function validateLayoutWidth(value: unknown) {
  if (
    typeof value !== "number" ||
    !(LAYOUT_WIDTHS as readonly number[]).includes(value)
  )
    throw new TypeError(
      `layout width must be one of ${LAYOUT_WIDTHS.join(", ")}.`,
    );
}

function plainObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${label} must be an object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError(`${label} must be a plain object.`);
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new TypeError(`${label}.${unknown} is not allowed.`);
}

function rejectUndefinedExcept(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
) {
  const invalid = Object.keys(value).find(
    (key) => value[key] === undefined && !allowed.includes(key),
  );
  if (invalid) throw new TypeError(`${label}.${invalid} cannot be undefined.`);
}

function validateStringFields(
  value: Record<string, unknown>,
  fields: readonly string[],
) {
  fields.forEach((key) => {
    if (key in value && typeof value[key] !== "string")
      throw new TypeError(`${key} must be a string.`);
  });
}

function validateOptionalStringFields(
  value: Record<string, unknown>,
  fields: readonly string[],
) {
  fields.forEach((key) => {
    if (
      key in value &&
      value[key] !== undefined &&
      typeof value[key] !== "string"
    )
      throw new TypeError(`patch.${key} must be a string or undefined.`);
  });
}

function stringArray(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new TypeError(`${label} must be an array of strings.`);
}

function booleanValue(value: unknown, label: string) {
  if (typeof value !== "boolean")
    throw new TypeError(`${label} must be a boolean.`);
}

function finiteNumber(
  value: unknown,
  label: string,
  minimum = -Number.MAX_VALUE,
  maximum = Number.MAX_VALUE,
) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  )
    throw new TypeError(
      `${label} must be a finite number from ${minimum} to ${maximum}.`,
    );
}

function integerNumber(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
) {
  finiteNumber(value, label, minimum, maximum);
  if (!Number.isInteger(value))
    throw new TypeError(`${label} must be an integer.`);
}

function optionalFiniteNumber(
  value: Record<string, unknown>,
  key: string,
  label: string,
) {
  if (key in value && value[key] !== undefined) finiteNumber(value[key], label);
}

function enumValue(
  value: unknown,
  allowed: readonly (string | number)[],
  label: string,
) {
  if (!allowed.includes(value as string | number))
    throw new TypeError(`${label} is outside the allowed values.`);
}

function hexColor(value: unknown, label: string) {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value))
    throw new TypeError(`${label} must be a six-digit hex color.`);
}

function objectSchema(
  properties: Record<string, Record<string, unknown>>,
  required: string[] = [],
) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function stringProp(description: string, pattern?: string) {
  return {
    type: "string",
    description,
    maxLength: 8000,
    ...(pattern ? { pattern } : {}),
  };
}

function numberProp(description: string, minimum?: number, maximum?: number) {
  return {
    type: "number",
    description,
    ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
  };
}

function booleanProp(description: string) {
  return { type: "boolean", description };
}

function enumProp(description: string, values: Array<string | number>) {
  return {
    type: typeof values[0] === "number" ? "number" : "string",
    description,
    enum: values,
  };
}

function arrayProp(description: string, items: Record<string, unknown>) {
  return { type: "array", description, items, maxItems: 1000 };
}

function gaugeRangeProp() {
  return {
    type: "object",
    properties: {
      id: stringProp("Stable range id, such as risk or on_target"),
      label: stringProp("Optional visible range label"),
      from: numberProp("Inclusive range start"),
      to: numberProp("Inclusive range end"),
      color: stringProp("Range color", "^#[0-9A-Fa-f]{6}$"),
    },
    required: ["id", "label", "from", "to", "color"],
    additionalProperties: false,
  };
}

function scatterPointStylesProp() {
  return arrayProp(
    "Per-point appearance overrides. Select each point by exact label or one-based source row; unspecified appearance fields inherit chart defaults.",
    objectSchema({
      label: stringProp("Exact point label"),
      rowIndex: numberProp("One-based source row", 1),
      color: stringProp("Point color", "^#[0-9A-Fa-f]{6}$"),
      size: numberProp("Point radius in pixels", 2, 20),
      opacity: numberProp("Point opacity", 0.1, 1),
      shape: enumProp("Point shape", ["circle", "square", "diamond"]),
    }),
  );
}

function lineSeriesStylesProp() {
  return {
    ...arrayProp(
      "Optional keyed overrides for individual series. Each series may appear once; omitted properties inherit chart defaults.",
      objectSchema(
        {
          series: stringProp("Exact value field name", ".*\\S.*"),
          color: stringProp("Six-digit hex color", "^#[0-9A-Fa-f]{6}$"),
          lineWidth: numberProp("Line width in pixels", 1, 8),
          lineDash: enumProp("Stroke pattern", ["solid", "dashed", "dotted"]),
          opacity: numberProp("Series opacity", 0.1, 1),
          showPoints: booleanProp("Show markers for this series"),
          pointSize: numberProp("Marker radius in pixels", 1, 12),
          pointShape: enumProp("Marker shape", ["circle", "square", "diamond"]),
        },
        ["series"],
      ),
    ),
    maxItems: 8,
  };
}

function linePointStylesProp() {
  return {
    ...arrayProp(
      "Optional overrides for exact points, selected by series and rendered x-axis category. Use these for a single highlight or selective value label.",
      objectSchema(
        {
          series: stringProp("Exact value field name", ".*\\S.*"),
          category: stringProp(
            "Exact source category value bound to the x-axis, before any display abbreviation; matched case-sensitively",
            ".*\\S.*",
          ),
          color: stringProp("Point color", "^#[0-9A-Fa-f]{6}$"),
          pointSize: numberProp("Marker radius in pixels", 1, 12),
          pointShape: enumProp("Marker shape", ["circle", "square", "diamond"]),
          showLabel: booleanProp("Show the formatted value label"),
        },
        ["series", "category"],
      ),
    ),
    maxItems: 200,
  };
}

function donutSliceStylesProp() {
  return arrayProp("Sparse exact-slice overrides", {
    type: "object",
    properties: {
      category: stringProp("Exact rendered category label"),
      color: stringProp("Slice color", "^#[0-9A-Fa-f]{6}$"),
      opacity: numberProp("Slice opacity", 0.1, 1),
    },
    required: ["category"],
    additionalProperties: false,
  });
}

function treemapTileStylesProp() {
  return arrayProp("Sparse exact-tile overrides", {
    type: "object",
    properties: {
      category: stringProp("Exact rendered category label"),
      color: stringProp("Tile color", "^#[0-9A-Fa-f]{6}$"),
      textColor: stringProp("Tile label color", "^#[0-9A-Fa-f]{6}$"),
      opacity: numberProp("Tile opacity", 0.1, 1),
    },
    required: ["category"],
    additionalProperties: false,
  });
}

function barColorOverridesProp() {
  return {
    ...arrayProp(
      "Targeted bar colors. Each item recolors one exact category label; include series only to target one bar inside a grouped category. Send the complete desired override list. Use [] to clear all overrides.",
      objectSchema(
        {
          category: stringProp(
            "Exact rendered category label, matched case-sensitively",
            ".*\\S.*",
          ),
          series: stringProp(
            "Optional exact value field; omit to recolor this category in every series",
            ".*\\S.*",
          ),
          color: stringProp("Six-digit hex color", "^#[0-9A-Fa-f]{6}$"),
        },
        ["category", "color"],
      ),
    ),
    maxItems: 100,
  };
}

function heatmapCellStylesProp() {
  return {
    ...arrayProp(
      "Sparse targeted cells. Select a row by exact rowLabel, or by one-based rowIndex when labels repeat; column is the exact bound value field. Send the complete list, or use style_heatmap_cell for one tiny edit.",
      objectSchema(
        {
          rowLabel: stringProp(
            "Exact rendered row label; omit when rowIndex is used",
            ".*\\S.*",
          ),
          rowIndex: numberProp(
            "One-based source row; omit when rowLabel is used",
            1,
          ),
          column: stringProp(
            "Exact bound value field / column heading",
            ".*\\S.*",
          ),
          color: stringProp("Cell fill color", "^#[0-9A-Fa-f]{6}$"),
          textColor: stringProp("Cell value-label color", "^#[0-9A-Fa-f]{6}$"),
        },
        ["column"],
      ),
    ),
    maxItems: 250,
  };
}

function sankeyNodeOverrideProp() {
  return objectSchema(
    {
      node: stringProp("Exact node name from the bound source or target data"),
      color: stringProp("Node fill color", "^#[0-9A-Fa-f]{6}$"),
      label: stringProp("Optional display label; data identity is unchanged"),
      highlighted: booleanProp("Emphasize this node and its connected links"),
    },
    ["node"],
  );
}

function sankeyLinkOverrideProp() {
  return objectSchema(
    {
      source: stringProp("Exact source node name from the bound data"),
      target: stringProp("Exact target node name from the bound data"),
      color: stringProp("Solid link color", "^#[0-9A-Fa-f]{6}$"),
      opacity: numberProp("Link opacity", 0.05, 1),
      highlighted: booleanProp("Emphasize this link"),
    },
    ["source", "target"],
  );
}

function sourceWorkbookProp() {
  return objectSchema(
    {
      fileName: stringProp("Original workbook file name"),
      byteLength: numberProp("Original file size in bytes", 0),
      checksum: stringProp("Optional source checksum"),
      storageKey: stringProp(
        "Immutable object-storage key for the exact uploaded file",
      ),
      contentType: stringProp("Original file MIME type"),
      sheets: arrayProp(
        "Every parsed worksheet in source order",
        objectSchema(
          {
            name: stringProp("Worksheet name"),
            rowCount: numberProp("Worksheet row count", 0),
            columnCount: numberProp("Worksheet column count", 0),
            rows: {
              type: "array",
              description: "Raw worksheet rows",
              items: { type: "array", items: {} },
            },
            regions: arrayProp(
              "Confirmed or proposed regions",
              worksheetRegionProp(),
            ),
          },
          ["name", "rows"],
        ),
      ),
    },
    ["fileName", "sheets"],
  );
}

function worksheetRegionProp() {
  return objectSchema(
    {
      id: stringProp("Stable region ID"),
      sheet: stringProp("Exact worksheet name"),
      name: stringProp(
        "Short label shown on the worksheet outline, such as Facility detail or Ops notes",
      ),
      kind: enumProp(
        "table for rows and columns to clean; narrative for titles, commentary, or prose; footnote for footers, sources, or totals",
        ["table", "narrative", "footnote"],
      ),
      confidence: numberProp(
        "1 for the table that feeds this dataset; lower for secondary tables and non-table regions",
        0,
        1,
      ),
      canonicalName: stringProp(
        "Dataset name for the primary table; otherwise the region name",
      ),
      range: objectSchema(
        {
          startRow: numberProp("One-based inclusive start row", 1),
          startColumn: numberProp("One-based inclusive start column", 1),
          endRow: numberProp("One-based inclusive end row", 2),
          endColumn: numberProp("One-based inclusive end column", 1),
        },
        ["startRow", "startColumn", "endRow", "endColumn"],
      ),
    },
    ["name", "kind", "confidence", "canonicalName", "range"],
  );
}

function datasetVariableMappingProp() {
  return objectSchema(
    {
      source: stringProp("Exact source variable"),
      canonical: stringProp("Stable canonical variable"),
      confidence: numberProp("Mapping confidence", 0, 1),
      matchedFromPrevious: stringProp(
        "Prior approved variable that established the match",
      ),
      usedByCharts: booleanProp(
        "Whether an existing chart or KPI depends on this variable",
      ),
      confirmed: booleanProp("Whether the user explicitly confirmed it"),
    },
    ["source", "canonical", "confidence"],
  );
}

function datasetCleaningQuestionProp() {
  return objectSchema(
    {
      id: stringProp("Stable question ID"),
      prompt: stringProp("Short user-facing question"),
      detail: stringProp("Context explaining why the choice matters"),
      choices: arrayProp(
        "Two or more mutually exclusive choices",
        objectSchema(
          {
            id: stringProp("Choice ID"),
            label: stringProp("Short choice label"),
            description: stringProp("Impact of choosing this option"),
          },
          ["id", "label"],
        ),
      ),
      recommendedChoiceId: stringProp("Recommended choice ID"),
      answerChoiceId: stringProp("User-selected choice ID"),
    },
    ["id", "prompt", "choices"],
  );
}

function tableProp(description: string) {
  return {
    type: "object",
    description,
    properties: {
      columns: {
        ...arrayProp("Column names", stringProp("Column name")),
        maxItems: 500,
      },
      rows: {
        type: "array",
        description: "Table rows",
        items: { type: "array", items: {} },
      },
    },
    required: ["columns", "rows"],
    additionalProperties: false,
  };
}
