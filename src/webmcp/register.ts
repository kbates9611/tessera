import type { CommandBus } from "../domain/commands";
import type { ToolDefinition } from "../domain/types";
import { validateInput } from "../domain/toolValidation";
import {
  TESSERA_MODEL_CONTEXT,
  TESSERA_MODEL_CONTEXT_VERSION,
} from "../domain/toolGuidance";

/**
 * WebMCP registration.
 *
 * Every Tessera operation lives on the command bus and is available to the
 * agent through one stable workspace catalog. Browsers that implement
 * `document.modelContext` natively keep a deliberately small tool budget, so
 * the catalog is exposed as four direct tools plus a three-tool gateway
 * (list → schema → run). Lightweight shims receive the flat catalog instead.
 */

/** Publication gates that only a person can pass, from the Tessera UI. */
export const HUMAN_ONLY_TOOLS = new Set([
  "answer_dataset_month_questions",
  "approve_dataset_month",
]);

/** Operations registered directly, outside the gateway. */
export const DIRECT_TOOLS = new Set([
  "get_project_context",
  "inspect_dashboard",
  "build_dashboard_fast",
  "add_generated_illustration_card",
]);

/** Tools whose mutations are followed by a project snapshot instead of a dashboard one. */
const WAREHOUSE_TOOLS = new Set([
  "create_dataset",
  "update_dataset_recipe",
  "save_dataset_month_upload",
  "start_dataset_month_processing",
  "propose_dataset_month_outline",
  "create_dataset_month_cleaning_draft",
  "update_cleaned_table",
  "clean_dataset_month",
  "create_monthly_dashboard_edition",
  "build_dashboard_from_dataset",
]);

const WEBMCP_CATALOG_VERSION = 11;

interface ModelContext {
  registerTool: (
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: Record<string, unknown>;
      annotations: Record<string, boolean>;
      execute: (
        args: Record<string, unknown>,
        options?: { signal?: AbortSignal },
      ) => Promise<unknown>;
    },
    options?: { signal?: AbortSignal },
  ) => void | Promise<void> | (() => void);
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
}

export interface WebMCPRegistration {
  available: boolean;
  /** Operations the agent can reach, directly or through the gateway. */
  toolCount: number;
  /** Tools registered on `document.modelContext`. */
  registeredCount: number;
  cleanup: () => void;
}

export function registerWebMCPTools(bus: CommandBus): WebMCPRegistration {
  const context = document.modelContext;
  const available = agentCatalog(bus);
  if (!context?.registerTool)
    return {
      available: false,
      toolCount: available.length,
      registeredCount: 0,
      cleanup: () => undefined,
    };
  const controller = new AbortController();
  const disposers: Array<() => void> = [];
  const definitions = hasNativeModelContext(context)
    ? compactDefinitions(bus, available)
    : available;
  definitions.forEach((definition) => {
    const result = context.registerTool(
      {
        name: definition.name,
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        annotations: {
          readOnlyHint: definition.readOnly,
          ...(definition.name.startsWith("remove_")
            ? { destructiveHint: true }
            : {}),
          ...(definition.readOnly ||
          /^(?:style_|update_|set_dashboard_layout$)/.test(definition.name)
            ? { idempotentHint: true }
            : {}),
          ...(/dataset|table|refresh|source|clean/.test(definition.name)
            ? { untrustedContentHint: true }
            : {}),
        },
        execute: async (args = {}, options) => {
          if (options?.signal?.aborted)
            throw new DOMException(
              "Tool execution was cancelled.",
              "AbortError",
            );
          validateInput(definition.inputSchema, args);
          return executeDefinition(bus, definition, args, "webmcp");
        },
      },
      { signal: controller.signal },
    );
    if (typeof result === "function") disposers.push(result);
    else if (result)
      void result.catch((error) => {
        if (!controller.signal.aborted)
          console.error(`[Tessera WebMCP] ${definition.name}`, error);
      });
  });
  return {
    available: true,
    toolCount: available.length,
    registeredCount: definitions.length,
    cleanup: () => {
      controller.abort();
      disposers.forEach((dispose) => dispose());
    },
  };
}

/** Every operation an agent may call. */
export function agentCatalog(bus: CommandBus) {
  return bus
    .list()
    .filter((definition) => !HUMAN_ONLY_TOOLS.has(definition.name));
}

function hasNativeModelContext(context: ModelContext) {
  return (
    Object.prototype.hasOwnProperty.call(context, "codexGetTools") ||
    Object.prototype.hasOwnProperty.call(context, "getTools")
  );
}

function compactDefinitions(
  bus: CommandBus,
  available: ToolDefinition[],
): ToolDefinition[] {
  const direct = available
    .filter((definition) => DIRECT_TOOLS.has(definition.name))
    .map((definition) =>
      definition.readOnly
        ? definition
        : withSnapshot(bus, definition, snapshotKind(definition.name)),
    );
  const findTool = (name: unknown) => {
    const definition = available.find(
      (candidate) => candidate.name === String(name),
    );
    if (!definition)
      throw new TypeError(
        `Unknown Tessera operation: ${String(name)}. Call list_tessera_tools first.`,
      );
    return definition;
  };
  return [
    ...direct,
    {
      name: "list_tessera_tools",
      title: "List Tessera operations",
      description:
        "List every Tessera operation for the open workspace: warehouse cleaning, dashboard building, and exact-element styling. Use this before choosing a chart, tile, data, or styling edit.",
      inputSchema: emptyObjectSchema(),
      readOnly: true,
      execute: () => ({
        catalogVersion: WEBMCP_CATALOG_VERSION,
        modelContextVersion: TESSERA_MODEL_CONTEXT_VERSION,
        modelContext: TESSERA_MODEL_CONTEXT,
        cachePolicy:
          "Schemas are stable for this page version. Reuse a schema after fetching it once.",
        workflow: [
          "Choose an operation from this list.",
          "Use a directly registered operation when available.",
          "For other operations, fetch its schema once, cache it, then call run_tessera_tool.",
          "Mutation results already include a fresh dashboard or project snapshot; do not make a separate verification call.",
        ],
        tools: available.map((definition) => ({
          name: definition.name,
          title: definition.title,
          description: catalogDescription(definition.description),
          readOnly: definition.readOnly,
        })),
      }),
    },
    {
      name: "get_tessera_tool_schema",
      title: "Get one Tessera operation schema",
      description:
        "Return the exact validated input contract for one operation from list_tessera_tools. Fetch only the operation you plan to run.",
      inputSchema: {
        type: "object",
        properties: {
          toolName: {
            type: "string",
            description: "Exact operation name returned by list_tessera_tools",
          },
        },
        required: ["toolName"],
        additionalProperties: false,
      },
      readOnly: true,
      execute: (args) => {
        const definition = findTool(args.toolName);
        return {
          catalogVersion: WEBMCP_CATALOG_VERSION,
          modelContextVersion: TESSERA_MODEL_CONTEXT_VERSION,
          cachePolicy: "Reuse this schema for the current page version.",
          name: definition.name,
          title: definition.title,
          description: definition.description,
          readOnly: definition.readOnly,
          inputSchema: definition.inputSchema,
        };
      },
    },
    {
      name: "run_tessera_tool",
      title: "Run one validated Tessera operation",
      description:
        "Run any non-direct operation after fetching its schema once. Mutations return their updated dashboard or project snapshot in the same response, so do not re-inspect afterward.",
      inputSchema: {
        type: "object",
        properties: {
          toolName: {
            type: "string",
            description: "Exact operation name returned by list_tessera_tools",
          },
          arguments: {
            type: "object",
            description:
              "Arguments that exactly match the schema returned by get_tessera_tool_schema",
            additionalProperties: true,
          },
        },
        required: ["toolName", "arguments"],
        additionalProperties: false,
      },
      readOnly: false,
      execute: async (args, source) => {
        const definition = findTool(args.toolName);
        const operationArgs = args.arguments as Record<string, unknown>;
        validateInput(definition.inputSchema, operationArgs);
        return executeWithSnapshot(
          bus,
          definition,
          operationArgs,
          source,
          snapshotKind(definition.name),
        );
      },
    },
  ];
}

type SnapshotKind = "dashboard" | "project";

function snapshotKind(toolName: string): SnapshotKind {
  return WAREHOUSE_TOOLS.has(toolName) ? "project" : "dashboard";
}

function withSnapshot(
  bus: CommandBus,
  definition: ToolDefinition,
  kind: SnapshotKind,
): ToolDefinition {
  return {
    ...definition,
    description: `${definition.description} Returns the updated ${kind} snapshot in the same response; do not inspect again.`,
    execute: (args, source) =>
      executeWithSnapshot(bus, definition, args, source, kind),
  };
}

async function executeWithSnapshot(
  bus: CommandBus,
  definition: ToolDefinition,
  args: Record<string, unknown>,
  source: "human" | "webmcp",
  kind: SnapshotKind,
) {
  await preflightGeneratedIllustration(definition.name, args);
  const result = await bus.execute(definition.name, args, source);
  if (definition.readOnly) return result;
  if (kind === "project") {
    const project = await bus.execute("get_project_context", {}, source);
    return { result: compactMutationResult(result), project };
  }
  const dashboard = await bus.execute(
    "inspect_dashboard",
    args.dashboardId ? { dashboardId: args.dashboardId } : {},
    source,
  );
  return {
    result: compactMutationResult(result),
    dashboard: compactDashboardSnapshot(dashboard),
  };
}

async function executeDefinition(
  bus: CommandBus,
  definition: ToolDefinition,
  args: Record<string, unknown>,
  source: "human" | "webmcp",
) {
  await preflightGeneratedIllustration(definition.name, args);
  return bus.list().some((candidate) => candidate === definition)
    ? bus.execute(definition.name, args, source)
    : definition.execute(args, source);
}

/**
 * Generated artwork must match the locked flat monoline style. The PNG alpha
 * mask is rasterised once and rejected when it is empty or too dense.
 */
async function preflightGeneratedIllustration(
  toolName: string,
  args: Record<string, unknown>,
) {
  if (toolName !== "add_generated_illustration_card") return;
  const encoded = args.maskPng;
  if (typeof encoded !== "string") return;
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([buffer], { type: "image/png" }));
  } catch {
    throw new TypeError(
      "maskPng must contain decodable PNG file bytes before Tessera can audit its style.",
    );
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context)
      throw new TypeError("Tessera could not inspect the illustration mask.");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const width = canvas.width;
    const height = canvas.height;
    const pixelCount = width * height;
    const isOn = (index: number) => pixels[index * 4 + 3] > 32;
    let onPixels = 0;
    let transitions = 0;
    for (let y = 0; y < height; y += 1) {
      const rowStart = y * width;
      for (let x = 0; x < width; x += 1) {
        const index = rowStart + x;
        const on = isOn(index);
        if (on) onPixels += 1;
        if (x && on !== isOn(index - 1)) transitions += 1;
        if (y && on !== isOn(index - width)) transitions += 1;
      }
    }
    const coverage = onPixels / pixelCount;
    const transitionRate = transitions / pixelCount;
    if (coverage < 0.003)
      throw new RangeError(
        "Tessera rejected this illustration because the transferred artwork is effectively empty. Regenerate the complete flat scene and resend its alpha mask.",
      );
    if (coverage > 0.26 || transitionRate > 0.075)
      throw new RangeError(
        "Tessera rejected this illustration as too dense or detailed for the locked style. Regenerate it with blank faceless figures, uniform minimal outlines, sparse solid fills, and absolutely no shading, texture, hatching, hair strands, fabric folds, or realistic detail, then resend the new alpha mask.",
      );
  } finally {
    bitmap.close();
  }
}

function catalogDescription(description: string) {
  const firstParagraph = description.split(/\n\s*\n/, 1)[0].trim();
  return firstParagraph.length <= 280
    ? firstParagraph
    : `${firstParagraph.slice(0, 277).trimEnd()}...`;
}

function compactMutationResult(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const item = value as Record<string, unknown>;
  if (typeof item.id === "string" && typeof item.type === "string") {
    const illustration =
      item.illustration && typeof item.illustration === "object"
        ? (item.illustration as Record<string, unknown>)
        : undefined;
    return {
      id: item.id,
      type: item.type,
      title: item.title,
      buildState: item.buildState,
      layout: item.layout,
      ...(illustration
        ? {
            illustration: {
              preset: illustration.preset,
              altText: illustration.altText,
              primaryColor: illustration.primaryColor,
              libraryAssetId: illustration.libraryAssetId,
              bitmapMask:
                illustration.bitmapMask &&
                typeof illustration.bitmapMask === "object"
                  ? omitBitmapPayload(
                      illustration.bitmapMask as Record<string, unknown>,
                    )
                  : undefined,
            },
          }
        : {}),
    };
  }
  if (Array.isArray(item.blocks)) return compactDashboardSnapshot(value);
  return value;
}

function omitBitmapPayload(mask: Record<string, unknown>) {
  const { bits: _bits, ...metadata } = mask;
  return metadata;
}

function compactDashboardSnapshot(value: unknown) {
  const dashboard = value as {
    id?: string;
    name?: string;
    updatedAt?: string;
    blocks?: Array<{
      id?: string;
      type?: string;
      title?: string;
      buildState?: string;
      layout?: { width?: number; minHeight?: number };
    }>;
  };
  const blocks = Array.isArray(dashboard.blocks) ? dashboard.blocks : [];
  return {
    id: dashboard.id,
    name: dashboard.name,
    updatedAt: dashboard.updatedAt,
    blockCount: blocks.length,
    blocks: blocks.map((block, index) => ({
      index,
      id: block.id,
      type: block.type,
      title: block.title,
      buildState: block.buildState,
      layout: block.layout,
    })),
  };
}

function emptyObjectSchema() {
  return {
    type: "object",
    properties: {},
    additionalProperties: false,
  };
}
