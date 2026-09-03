import {
  ArrowRight,
  CircleCheck,
  Clock3,
  FilePlus2,
  LayoutDashboard,
  LockKeyhole,
  Plus,
  Table2,
} from "lucide-react";
import type { DataAsset, TesseraProject } from "../../domain/types";
import { dashboardsForPeriod } from "../../domain/dashboardPeriods";
import { periodLabel, profileTable } from "../../lib/csv";
import { latestFullyApprovedPeriod } from "../agent/prompts";
import {
  advancePeriod,
  processingForMonth,
  selectMonth,
  selectReadyMonth,
  shortStageLabel,
} from "./model";

/**
 * The monthly refresh board: where every dataset stands for the newest
 * reporting month, what happens next for each, and the edition step once the
 * month is fully approved.
 */
export function RefreshOverview({
  project,
  onAddMonth,
  onOpen,
  onEditions,
}: {
  project: TesseraProject;
  onAddMonth: (asset: DataAsset) => void;
  onOpen: (asset: DataAsset, period: string) => void;
  onEditions: (period: string) => void;
}) {
  const periods = [
    ...new Set(
      project.warehouse.flatMap((item) =>
        item.months.map((month) => month.period),
      ),
    ),
  ].sort();
  const latestPeriod = periods.at(-1);
  const currentCount = latestPeriod
    ? project.warehouse.filter((item) =>
        item.months.some(
          (month) =>
            month.period === latestPeriod && month.status !== "pending",
        ),
      ).length
    : 0;
  const pendingCount = project.warehouse.length - currentCount;
  const nextPeriod = latestPeriod ? advancePeriod(latestPeriod) : undefined;
  const nextLabel = nextPeriod ? periodLabel(nextPeriod) : "next month";
  const approvedPeriod = latestFullyApprovedPeriod(project);
  const editions = approvedPeriod
    ? dashboardsForPeriod(project, approvedPeriod).length
    : 0;

  return (
    <section className="warehouse-overview refresh-overview">
      <header className="warehouse-overview__intro">
        <div>
          <span className="eyebrow">MONTHLY REFRESH</span>
          <h2>Bring in the next month without rebuilding anything</h2>
          <p>
            Add each new source to its dataset, outline and clean it (yourself
            or with your agent), approve it, then create dashboard editions
            bound to the new month. Earlier months and dashboards stay exactly
            as they were.
          </p>
        </div>
        <div className="warehouse-overview__metrics">
          <span>
            <strong>{currentCount}</strong> of {project.warehouse.length} ready
            for {latestPeriod ? periodLabel(latestPeriod) : "review"}
          </span>
          <span>
            <strong>{pendingCount}</strong> need attention
          </span>
        </div>
      </header>

      <div className="refresh-flow" aria-label="How monthly refresh works">
        <div>
          <span>1</span>
          <div>
            <b>Add the new source</b>
            <small>Stored as the immutable original</small>
          </div>
        </div>
        <ArrowRight size={16} />
        <div>
          <span>2</span>
          <div>
            <b>Outline, map, and clean</b>
            <small>Recipe first · questions only when needed</small>
          </div>
        </div>
        <ArrowRight size={16} />
        <div>
          <span>3</span>
          <div>
            <b>Approve, then create editions</b>
            <small>Dashboards keep their design, only the month changes</small>
          </div>
        </div>
      </div>

      <div className="refresh-progress-card">
        <header>
          <div>
            <span className="eyebrow">CURRENT COVERAGE</span>
            <h3>
              {latestPeriod
                ? `${periodLabel(latestPeriod)} reporting set`
                : "No reporting month yet"}
            </h3>
          </div>
          <span
            className={`refresh-summary${pendingCount ? " needs-review" : " is-ready"}`}
          >
            {pendingCount ? <Clock3 size={14} /> : <CircleCheck size={14} />}
            {pendingCount
              ? `${currentCount} of ${project.warehouse.length} ready`
              : "All datasets ready"}
          </span>
        </header>
        <div className="refresh-progress-track" aria-hidden="true">
          <span
            style={{
              width: `${project.warehouse.length ? (currentCount / project.warehouse.length) * 100 : 0}%`,
            }}
          />
        </div>
        <div className="refresh-board">
          <div className="refresh-board__head">
            <span>Dataset</span>
            <span>Latest approved table</span>
            <span>What happens next</span>
            <span>Status and action</span>
          </div>
          {project.warehouse.map((item) => {
            const latest = selectMonth(item);
            const latestReady = selectReadyMonth(item);
            const current = Boolean(
              latestPeriod &&
              latest?.period === latestPeriod &&
              latest.status !== "pending",
            );
            const pendingUpload = Boolean(
              latest && latest.status === "pending",
            );
            const stage = latest ? processingForMonth(latest).stage : undefined;
            const latestProfile = latestReady
              ? profileTable(latestReady.cleaned)
              : undefined;
            const itemNextPeriod = latestReady
              ? advancePeriod(latestReady.period)
              : nextPeriod;
            const itemNextLabel = itemNextPeriod
              ? periodLabel(itemNextPeriod)
              : "the next month";

            return (
              <article className="refresh-row" key={item.id}>
                <div className="refresh-row__dataset">
                  <span>
                    <Table2 size={14} />
                  </span>
                  <div>
                    <b>{item.name}</b>
                    <small>{item.recipe.name}</small>
                  </div>
                </div>
                <div className="refresh-row__latest">
                  <b>{latestReady?.label ?? "No approved month yet"}</b>
                  <small>
                    {latestProfile
                      ? `${latestProfile.rows} rows · ${latestProfile.columns} fields`
                      : "Waiting for a first approved month"}
                  </small>
                </div>
                <p className="refresh-row__next">
                  {pendingUpload && latest
                    ? stage === "needs_input"
                      ? `${latest.label} is waiting on your answer to a cleaning question.`
                      : stage === "review"
                        ? `${latest.label} has a clean draft. Review the checks and approve it.`
                        : stage === "outlined"
                          ? `${latest.label} is outlined and mapped. Create the clean draft.`
                          : `${latest.label} is uploaded. Outline the table or quick-clean it with the recipe.`
                    : latestReady
                      ? `Add the ${itemNextLabel} source; the saved recipe is applied first.`
                      : "Add the first source to create an original and a clean version."}
                </p>
                <div className="refresh-row__review">
                  <span
                    className={`refresh-status${current ? " is-current" : " needs-review"}`}
                  >
                    {current ? <CircleCheck size={12} /> : <Clock3 size={12} />}
                    {current
                      ? "Ready"
                      : pendingUpload
                        ? shortStageLabel(stage)
                        : "Source needed"}
                  </span>
                  <div>
                    {latest && (
                      <button onClick={() => onOpen(item, latest.period)}>
                        {pendingUpload ? "Open upload" : "Open"}{" "}
                        <ArrowRight size={11} />
                      </button>
                    )}
                    <button onClick={() => onAddMonth(item)}>
                      <Plus size={11} /> Add month
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {approvedPeriod && (
        <section className="refresh-editions" aria-label="Dashboard editions">
          <span>
            <LayoutDashboard size={15} />
          </span>
          <div>
            <b>{periodLabel(approvedPeriod)} is fully approved.</b>
            <p>
              {editions
                ? `${editions} dashboard edition${editions === 1 ? "" : "s"} already bound to ${periodLabel(approvedPeriod)}.`
                : `No dashboard edition is bound to ${periodLabel(approvedPeriod)} yet.`}{" "}
              Editions copy a dashboard’s design and bind it to the approved
              month.
            </p>
          </div>
          <button
            className="secondary-button"
            onClick={() => onEditions(approvedPeriod)}
          >
            Create editions <ArrowRight size={12} />
          </button>
        </section>
      )}

      <div className="refresh-footer">
        <aside className="refresh-guardrail">
          <span>
            <LockKeyhole size={15} />
          </span>
          <div>
            <b>Your dashboard design is protected during refresh.</b>
            <p>
              Layout, typography, colors, chart types, and block order stay
              locked. Only reviewed data, periods, labels, and commentary
              update.
            </p>
          </div>
        </aside>
        <button
          className="primary-button"
          onClick={() => {
            const next =
              project.warehouse.find((item) => {
                const latest = selectMonth(item);
                return (
                  !latestPeriod ||
                  latest?.period !== latestPeriod ||
                  latest.status === "pending"
                );
              }) ?? project.warehouse[0];
            if (!next) return;
            const latest = selectMonth(next);
            if (latest?.status === "pending") onOpen(next, latest.period);
            else onAddMonth(next);
          }}
        >
          <FilePlus2 size={14} />
          {pendingCount ? "Open the next pending upload" : `Start ${nextLabel}`}
        </button>
      </div>
    </section>
  );
}
