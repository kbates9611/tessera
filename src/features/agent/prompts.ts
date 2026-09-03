import type {
  DataAsset,
  DatasetMonth,
  TesseraProject,
} from "../../domain/types";
import { selectedReadyMonth } from "../../domain/selectors";
import { dashboardPeriod } from "../../domain/dashboardPeriods";

export interface PromptContext {
  view: "dashboard" | "warehouse";
  datasetId?: string;
  period?: string;
}

export interface SuggestedPrompt {
  title: string;
  text: string;
}

export function suggestedPrompts(
  project: TesseraProject,
  context: PromptContext,
): SuggestedPrompt[] {
  const prompts: SuggestedPrompt[] = [];
  const dataset =
    project.warehouse.find((asset) => asset.id === context.datasetId) ??
    project.warehouse[0];
  const pending = pendingMonths(project);
  const dashboard =
    project.dashboards.find(
      (candidate) => candidate.id === project.activeDashboardId,
    ) ?? project.dashboards[0];
  const hasApprovedData = project.warehouse.some((asset) =>
    Boolean(selectedReadyMonth(asset)),
  );

  if (context.view === "warehouse") {
    const focus =
      pending.find(
        (item) =>
          item.asset.id === context.datasetId &&
          item.month.period === context.period,
      ) ?? pending[0];
    if (focus) {
      const prompt = stagePrompt(focus.asset, focus.month);
      if (prompt) prompts.push(prompt);
    }
    if (dataset && hasApprovedData) prompts.push(PROFILE_PROMPT);
    if (dataset) prompts.push(RECIPES_PROMPT);
    if (!project.warehouse.length) prompts.push(START_DATASET_PROMPT);
  } else {
    if (hasApprovedData) prompts.push(BUILD_PROMPT);
    if (dashboard?.blocks.length)
      prompts.push(EXCEPTION_PROMPT, HIGHLIGHT_PROMPT, REORDER_PROMPT);
    const approvedPeriod = latestFullyApprovedPeriod(project);
    if (
      dashboard &&
      approvedPeriod &&
      dashboardPeriod(project, dashboard) !== approvedPeriod
    )
      prompts.push(editionPrompt("open"));
    if (pending[0]) {
      const prompt = stagePrompt(pending[0].asset, pending[0].month);
      if (prompt) prompts.push(prompt);
    }
  }

  return prompts.slice(0, 5);
}

export function stagePrompt(
  _asset: DataAsset,
  month: DatasetMonth,
): SuggestedPrompt | undefined {
  const stage = month.processing?.stage ?? "uploaded";
  if (stage === "uploaded" || stage === "outlining")
    return {
      title: "Clean the pending upload",
      text: "Process the pending monthly upload in this Tessera project. Start the visible analysis, inspect every worksheet, outline the real table, match the fields already used by charts before anything else, and ask me in Tessera about any choice you should not guess.",
    };
  if (stage === "needs_input")
    return {
      title: "Continue after my answers",
      text: "I answered the cleaning questions in Tessera. Read the saved answers for the pending upload, create the clean draft, run the quality checks, and leave it waiting for my approval.",
    };
  if (stage === "outlined")
    return {
      title: "Create the clean draft",
      text: "Create the clean draft for the outlined upload in this Tessera project from the confirmed outline and the saved recipe, run the prior-month checks, and leave it for my approval.",
    };
  if (stage === "review")
    return {
      title: "Check the draft",
      text: "Review the clean draft waiting for approval in this Tessera project: compare it with the prior approved month, flag values that moved more than expected, and fix any field that is obviously mislabeled.",
    };
  return undefined;
}

export function editionPrompt(scope: "open" | "all"): SuggestedPrompt {
  const target =
    scope === "open"
      ? "a new version of the open dashboard"
      : "a new version of each dashboard series in this project";
  return {
    title:
      scope === "open" ? "Create the next edition" : "Create the next editions",
    text: `The newest month is approved. Please make ${target} for it, using the most recent earlier month as the template. Keep the layout, styling, and illustrations, switch the cards to the new data, refresh the headlines and commentary, and leave it as a draft for me.`,
  };
}

export function recipePrompt(_asset: DataAsset): SuggestedPrompt {
  return {
    title: "Improve this recipe",
    text: "Review the cleaning recipe I have open in Tessera. Suggest clearer canonical field names, add any header the source is likely to rename next month, and save the updated header map.",
  };
}

const PROFILE_PROMPT: SuggestedPrompt = {
  title: "Profile the approved data",
  text: "Analyze the latest approved tables in this Tessera project. Tell me the strongest story angles, the fields worth charting, and anything that looks like a data quality problem.",
};

const RECIPES_PROMPT: SuggestedPrompt = {
  title: "Tune the cleaning recipes",
  text: "Review the cleaning recipes in this Tessera project. Rename awkward canonical fields to clear business names and update each saved header map so next month cleans the same way.",
};

const START_DATASET_PROMPT: SuggestedPrompt = {
  title: "Start a dataset",
  text: "Create a dataset in this Tessera project for the table I report every month. Name it after the business subject, describe what one row means, and tell me what to upload first.",
};

const BUILD_PROMPT: SuggestedPrompt = {
  title: "Build a leadership dashboard",
  text: "Inspect this Tessera project and build an editorial dashboard from its approved data: a decision-oriented header, a row of four KPIs, one overview chart, one focused explanation with commentary, and an evidence table at the bottom.",
};

const EXCEPTION_PROMPT: SuggestedPrompt = {
  title: "Explain the biggest exception",
  text: "On the dashboard that is open in Tessera, find the metric furthest from its target and add a short commentary tile beside it explaining what changed and what to do next.",
};

const HIGHLIGHT_PROMPT: SuggestedPrompt = {
  title: "Highlight one finding",
  text: "On the open Tessera dashboard, emphasize the single chart element that proves the main finding (one bar, point, slice, or Sankey link) and keep everything else in the base palette.",
};

const REORDER_PROMPT: SuggestedPrompt = {
  title: "Reorder for executives",
  text: "Reorder the open Tessera dashboard so the news comes first: KPIs, then the broadest trend, then the driver, then the evidence table. Keep every block and all styling.",
};

function pendingMonths(project: TesseraProject) {
  return project.warehouse.flatMap((asset) =>
    asset.months
      .filter((month) => month.status === "pending")
      .map((month) => ({ asset, month })),
  );
}

export function latestFullyApprovedPeriod(project: TesseraProject) {
  if (!project.warehouse.length) return undefined;
  const periods = [
    ...new Set(
      project.warehouse.flatMap((asset) =>
        asset.months
          .filter((month) => month.status !== "pending")
          .map((month) => month.period),
      ),
    ),
  ].sort();
  return periods
    .reverse()
    .find((period) =>
      project.warehouse.every((asset) =>
        asset.months.some(
          (month) => month.period === period && month.status !== "pending",
        ),
      ),
    );
}
