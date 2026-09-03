import { useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleCheck,
  Clock3,
  LayoutDashboard,
  LockKeyhole,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { CommandBus } from "../../domain/commands";
import {
  dashboardPeriod,
  dashboardSeriesId,
  dashboardSeriesName,
} from "../../domain/dashboardPeriods";
import type {
  DataAsset,
  DatasetCleaningQuestion,
  DatasetMonth,
  TesseraProject,
} from "../../domain/types";
import { periodLabel, profileTable } from "../../lib/csv";
import { Modal } from "../../app/Modal";
import { AgentHint } from "../agent/AgentHint";
import { editionPrompt, recipePrompt, stagePrompt } from "../agent/prompts";
import {
  errorMessage,
  hasCleanDraft,
  processingForMonth,
  selectReadyMonth,
  type DataView,
} from "./model";

export function DatasetDialog({
  bus,
  onClose,
  onCreated,
}: {
  bus: CommandBus;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="New dataset"
      description="A dataset is one table that arrives every month. Name the business subject, not the file."
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          void bus
            .execute("create_dataset", { name: name.trim(), description })
            .then((result) => onCreated((result as DataAsset).id))
            .catch((reason) =>
              setError(
                errorMessage(reason, "The dataset could not be created."),
              ),
            )
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Dataset name
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Monthly sales"
          />
        </label>
        <label>
          What one row means
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="One row per store per month…"
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="modal__actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={!name.trim() || busy}>
            Create dataset
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * The decisions an agent refused to guess. Only a person can answer them;
 * afterwards the draft can be created by hand or by the agent.
 */
export function QuestionsDialog({
  asset,
  month,
  bus,
  agentConnected,
  onClose,
  onDraftCreated,
}: {
  asset: DataAsset;
  month: DatasetMonth;
  bus: CommandBus;
  agentConnected: boolean;
  onClose: () => void;
  onDraftCreated: () => void;
}) {
  const questions = processingForMonth(month).questions;
  const [answers, setAnswers] = useState<Record<string, string>>(
    Object.fromEntries(
      questions
        .filter((question) => question.answerChoiceId)
        .map((question) => [question.id, question.answerChoiceId!]),
    ),
  );
  const [submitted, setSubmitted] = useState(
    Boolean(questions.length) &&
      questions.every((question) => question.answerChoiceId),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await bus.execute("answer_dataset_month_questions", {
        datasetId: asset.id,
        period: month.period,
        answers: questions.map((question) => ({
          questionId: question.id,
          choiceId: answers[question.id],
        })),
      });
      setSubmitted(true);
    } catch (reason) {
      setError(errorMessage(reason, "The choices could not be saved."));
    } finally {
      setBusy(false);
    }
  };

  const createDraft = async () => {
    setBusy(true);
    setError("");
    try {
      await bus.execute("create_dataset_month_cleaning_draft", {
        datasetId: asset.id,
        period: month.period,
      });
      onDraftCreated();
    } catch (reason) {
      setError(errorMessage(reason, "The clean draft could not be created."));
    } finally {
      setBusy(false);
    }
  };

  const continuation = stagePrompt(asset, {
    ...month,
    processing: { ...processingForMonth(month), stage: "needs_input" },
  });

  return (
    <Modal
      title={submitted ? "Decisions saved" : "Your decision is needed"}
      description={
        submitted
          ? "The answers travel with this month. Create the clean draft now, or let your agent continue."
          : "These are the choices the agent would not guess. Answer them together; nothing changes until you do."
      }
      onClose={onClose}
    >
      <div className="cleaning-questions-dialog">
        {!submitted ? (
          <>
            <div className="cleaning-question-list">
              {questions.map((question, index) => (
                <QuestionCard
                  key={question.id}
                  question={question}
                  index={index}
                  value={answers[question.id]}
                  onChange={(choiceId) =>
                    setAnswers((current) => ({
                      ...current,
                      [question.id]: choiceId,
                    }))
                  }
                />
              ))}
            </div>
            {error && <p className="form-error">{error}</p>}
            <div className="modal__actions">
              <button className="secondary-button" onClick={onClose}>
                Finish later
              </button>
              <button
                className="primary-button"
                disabled={
                  busy || questions.some((question) => !answers[question.id])
                }
                onClick={() => void submit()}
              >
                {busy ? "Saving…" : "Submit all choices"}
              </button>
            </div>
          </>
        ) : (
          <div className="next-step-paths">
            <section className="next-step-paths__manual">
              <span className="eyebrow">BY HAND</span>
              <h3>Create the clean draft now</h3>
              <p>
                Applies the saved recipe and your answers, then runs the
                prior-month checks. You still approve the result.
              </p>
              {error && <p className="form-error">{error}</p>}
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void createDraft()}
              >
                <Sparkles size={13} />{" "}
                {busy ? "Working…" : "Create clean draft"}
              </button>
            </section>
            {continuation && (
              <AgentHint
                title={continuation.title}
                prompt={continuation.text}
                connected={agentConnected}
              />
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function QuestionCard({
  question,
  index,
  value,
  onChange,
}: {
  question: DatasetCleaningQuestion;
  index: number;
  value?: string;
  onChange: (choiceId: string) => void;
}) {
  return (
    <fieldset className="cleaning-question-card">
      <legend>
        <span>{index + 1}</span>
        <div>
          <b>{question.prompt}</b>
          {question.detail && <small>{question.detail}</small>}
        </div>
      </legend>
      <div>
        {question.choices.map((choice) => (
          <label
            key={choice.id}
            className={value === choice.id ? "is-selected" : ""}
          >
            <input
              type="radio"
              name={question.id}
              checked={value === choice.id}
              onChange={() => onChange(choice.id)}
            />
            <span>
              <b>
                {choice.label}
                {choice.id === question.recommendedChoiceId && (
                  <em>Recommended</em>
                )}
              </b>
              {choice.description && <small>{choice.description}</small>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Once every dataset has an approved version for a month, each dashboard can
 * get a new edition bound to that month. Editions are created here by hand
 * or handed to the agent.
 */
export function EditionDialog({
  project,
  period,
  bus,
  agentConnected,
  onClose,
}: {
  project: TesseraProject;
  period: string;
  bus: CommandBus;
  agentConnected: boolean;
  onClose: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const label = periodLabel(period);
  const dashboardRows = [
    ...new Set(
      project.dashboards.map((dashboard) =>
        dashboardSeriesId(project, dashboard),
      ),
    ),
  ].flatMap((seriesId) => {
    const versions = project.dashboards.filter(
      (dashboard) =>
        dashboardSeriesId(project, dashboard) === seriesId &&
        dashboard.blocks.length,
    );
    const existing = versions.find(
      (dashboard) => dashboardPeriod(project, dashboard) === period,
    );
    const source = versions
      .filter((dashboard) => {
        const versionPeriod = dashboardPeriod(project, dashboard);
        return versionPeriod && versionPeriod < period;
      })
      .sort((a, b) =>
        (dashboardPeriod(project, b) ?? "").localeCompare(
          dashboardPeriod(project, a) ?? "",
        ),
      )[0];
    const reference = existing ?? source;
    return reference
      ? [
          {
            seriesId,
            name: dashboardSeriesName(project, reference),
            source,
            existing,
          },
        ]
      : [];
  });

  const createEdition = async (sourceDashboardId: string) => {
    setBusyId(sourceDashboardId);
    setError("");
    try {
      await bus.execute("create_monthly_dashboard_edition", {
        sourceDashboardId,
        period,
      });
    } catch (reason) {
      setError(errorMessage(reason, "The edition could not be created."));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal
      title={`${label} is dashboard-ready`}
      description={`Every dataset has an approved ${label} version. Create a dashboard version for ${label}: the layout and styling are copied, the data binds to ${label}, and earlier months stay untouched.`}
      onClose={onClose}
    >
      <div className="edition-dialog">
        <section className="edition-dialog__list" aria-label="Dashboards">
          {dashboardRows.map(({ seriesId, name, source, existing }) => {
            const sourcePeriod = source
              ? dashboardPeriod(project, source)
              : undefined;
            return (
              <article key={seriesId} className="edition-row">
                <span>
                  <LayoutDashboard size={14} />
                </span>
                <div>
                  <b>{name}</b>
                  <small>
                    {(existing ?? source)?.blocks.length ?? 0} blocks
                    {sourcePeriod
                      ? ` · template: ${periodLabel(sourcePeriod)}`
                      : ` · ${label} dashboard`}
                  </small>
                </div>
                {existing ? (
                  <em>
                    <CircleCheck size={12} /> {label} edition created
                  </em>
                ) : (
                  <button
                    className="secondary-button"
                    disabled={busyId !== null}
                    onClick={() => source && void createEdition(source.id)}
                  >
                    {busyId === source?.id
                      ? "Creating…"
                      : `Create ${label} edition`}
                    <ArrowRight size={12} />
                  </button>
                )}
              </article>
            );
          })}
          {!dashboardRows.length && (
            <p className="recipe-detail__empty">
              Build a dashboard first; editions clone an existing page.
            </p>
          )}
          {error && <p className="form-error">{error}</p>}
        </section>
        <AgentHint
          title={`Let the agent draft the ${label} editions`}
          prompt={editionPrompt("all").text}
          detail="The agent clones each dashboard the same way, then rewrites the headlines and commentary for the new month."
          connected={agentConnected}
        />
        <footer className="modal__actions">
          <button className="secondary-button" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </Modal>
  );
}

/** Edit the reusable cleaning recipe: header map, name, and notes. */
export function RecipeEditorDialog({
  asset,
  bus,
  agentConnected,
  onClose,
  onOpenClean,
}: {
  asset: DataAsset;
  bus: CommandBus;
  agentConnected: boolean;
  onClose: () => void;
  onOpenClean?: () => void;
}) {
  const latest = selectReadyMonth(asset);
  const [name, setName] = useState(asset.recipe.name);
  const [rows, setRows] = useState(
    Object.entries(asset.recipe.headerMap).map(([from, to]) => ({
      id: crypto.randomUUID(),
      from,
      to,
    })),
  );
  const [notes, setNotes] = useState(asset.recipe.notes.join("\n"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const canonicalColumns = latest?.cleaned.columns ?? [];

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await bus.execute("update_dataset_recipe", {
        datasetId: asset.id,
        name: name.trim() || asset.recipe.name,
        headerMap: Object.fromEntries(
          rows
            .map((row) => [row.from.trim(), row.to.trim()])
            .filter(([from, to]) => from && to),
        ),
        notes: notes
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    } catch (reason) {
      setError(errorMessage(reason, "The recipe could not be saved."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`${asset.name} recipe`}
      description="The saved instructions reused whenever a new month arrives: which source headers become which canonical fields, and the notes that explain the cleanup."
      onClose={onClose}
    >
      <div className="recipe-detail">
        <div className="recipe-detail__summary">
          <span>
            <b>{rows.filter((row) => row.from && row.to).length}</b>
            <small>header mappings</small>
          </span>
          <span>
            <b>{canonicalColumns.length}</b>
            <small>canonical fields</small>
          </span>
          <span>
            <b>{latest?.label ?? "Not used yet"}</b>
            <small>last approved month</small>
          </span>
        </div>

        <label className="recipe-detail__name">
          Recipe name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <section className="recipe-detail__section">
          <header>
            <div>
              <span className="eyebrow">HEADER MAP</span>
              <h3>Source header → canonical field</h3>
            </div>
            <small>Applied to every new month</small>
          </header>
          <div className="recipe-editor__rows">
            {rows.map((row) => (
              <div key={row.id} className="recipe-editor__row">
                <input
                  aria-label="Source header"
                  placeholder="Header as it appears in the file"
                  value={row.from}
                  onChange={(event) =>
                    setRows((current) =>
                      current.map((item) =>
                        item.id === row.id
                          ? { ...item, from: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
                <ArrowRight size={12} />
                <input
                  aria-label="Canonical field"
                  placeholder="Canonical field"
                  list={`canonical-${asset.id}`}
                  value={row.to}
                  onChange={(event) =>
                    setRows((current) =>
                      current.map((item) =>
                        item.id === row.id
                          ? { ...item, to: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove mapping for ${row.from || "empty header"}`}
                  onClick={() =>
                    setRows((current) =>
                      current.filter((item) => item.id !== row.id),
                    )
                  }
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <datalist id={`canonical-${asset.id}`}>
              {canonicalColumns.map((column) => (
                <option key={column} value={column} />
              ))}
            </datalist>
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                setRows((current) => [
                  ...current,
                  { id: crypto.randomUUID(), from: "", to: "" },
                ])
              }
            >
              <Plus size={12} /> Add mapping
            </button>
          </div>
        </section>

        <section className="recipe-detail__section">
          <header>
            <div>
              <span className="eyebrow">NOTES</span>
              <h3>What the cleanup does</h3>
            </div>
            <small>One note per line</small>
          </header>
          <textarea
            className="recipe-editor__notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Removed the preliminary note rows; values are in thousands…"
          />
        </section>

        <AgentHint
          title={recipePrompt(asset).title}
          prompt={recipePrompt(asset).text}
          connected={agentConnected}
        />

        {error && <p className="form-error">{error}</p>}
        <footer className="recipe-detail__actions">
          <p>
            <LockKeyhole size={12} /> Recipes only shape the separate clean
            table. Uploaded originals are never changed.
          </p>
          <div>
            {latest && onOpenClean && (
              <button className="secondary-button" onClick={onOpenClean}>
                Open latest clean table <ArrowRight size={13} />
              </button>
            )}
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void save()}
            >
              {saved ? <Check size={13} /> : null}
              {busy ? "Saving…" : saved ? "Saved" : "Save recipe"}
            </button>
          </div>
        </footer>
      </div>
    </Modal>
  );
}

/** Quality, lineage, schema, and the cleaning record for one monthly version. */
export function TableDetailsDialog({
  month,
  view,
  onClose,
  onOpenClean,
}: {
  month: DatasetMonth;
  view: DataView;
  onClose: () => void;
  onOpenClean: () => void;
}) {
  const pending = month.status === "pending";
  const processing = processingForMonth(month);
  const drafted = hasCleanDraft(month);
  const table = view === "cleaned" && drafted ? month.cleaned : month.original;
  const profile = useMemo(() => profileTable(table), [table]);
  const cleanProfile = useMemo(
    () =>
      drafted && month.cleaned.columns.length
        ? profileTable(month.cleaned)
        : undefined,
    [month.cleaned, drafted],
  );
  const reviewItems = profile.issues.filter(
    (issue) => issue.severity === "review",
  );
  const numericFields = profile.columnProfiles.filter(
    (column) => column.minimum !== undefined,
  ).length;

  return (
    <Modal
      title={`${month.label} table details`}
      description="Quality, lineage, schema, and the saved cleaning record for this monthly version."
      onClose={onClose}
    >
      <aside className="warehouse-analysis">
        <header className="warehouse-analysis__header">
          <span
            className={
              pending || reviewItems.length ? "needs-review" : "is-ready"
            }
          >
            {pending || reviewItems.length ? (
              <Clock3 size={15} />
            ) : (
              <ShieldCheck size={15} />
            )}
          </span>
          <div>
            <strong>
              {pending
                ? processing.message
                : view === "original"
                  ? "Source preserved exactly as received"
                  : reviewItems.length
                    ? `${reviewItems.length} item${reviewItems.length === 1 ? "" : "s"} to review`
                    : "Clean table ready"}
            </strong>
            <p>
              {view === "original"
                ? "This monthly source is immutable. Cleaning happens in a separate version."
                : "The canonical table used by dashboards and the next monthly refresh."}
            </p>
          </div>
        </header>

        <section className="data-quality-strip" aria-label="Table analysis">
          <div>
            <span>Rows</span>
            <strong>{profile.rows.toLocaleString()}</strong>
          </div>
          <div>
            <span>Fields</span>
            <strong>{profile.columns}</strong>
          </div>
          <div>
            <span>Complete</span>
            <strong>{Math.round(profile.completeness * 100)}%</strong>
          </div>
          <div>
            <span>Numeric</span>
            <strong>{numericFields}</strong>
          </div>
          <div className={reviewItems.length ? "needs-review" : "is-ready"}>
            <span>{view === "original" ? "Analysis" : "Quality"}</span>
            <strong>
              {reviewItems.length
                ? `${reviewItems.length} review item${reviewItems.length === 1 ? "" : "s"}`
                : "Ready"}
            </strong>
          </div>
        </section>

        {!!profile.issues.length && (
          <section className="warehouse-analysis__section">
            <header>
              <span>PROFILE</span>
              <b>{profile.issues.length} findings</b>
            </header>
            <ul className="warehouse-analysis__issues">
              {profile.issues.map((issue) => (
                <li key={issue.title} className={`is-${issue.severity}`}>
                  <b>{issue.title}</b>
                  <small>{issue.detail}</small>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="warehouse-analysis__section">
          <header>
            <span>VERSION CHAIN</span>
            <b>{month.label}</b>
          </header>
          <div className="warehouse-version-chain">
            <div className="is-complete">
              <span>
                <LockKeyhole size={12} />
              </span>
              <div>
                <b>Original</b>
                <small>{month.sourceName}</small>
              </div>
              <Check size={13} />
            </div>
            <i />
            <div
              className={pending && !drafted ? "needs-review" : "is-complete"}
            >
              <span>
                <Sparkles size={12} />
              </span>
              <div>
                <b>Cleaned</b>
                <small>
                  {cleanProfile
                    ? `${cleanProfile.rows} rows · ${cleanProfile.columns} fields`
                    : "Waiting for an outline and a clean draft"}
                </small>
              </div>
              {pending ? <Clock3 size={13} /> : <Check size={13} />}
            </div>
          </div>
        </section>

        {cleanProfile && (
          <details className="warehouse-analysis__details warehouse-analysis__schema">
            <summary>
              <span>CANONICAL SCHEMA</span>
              <b>{cleanProfile.columns} fields</b>
              <ChevronRight size={12} />
            </summary>
            <div>
              {cleanProfile.columnProfiles.map((column) => (
                <span key={column.name}>
                  <b>{column.name}</b>
                  <small>{column.type}</small>
                </span>
              ))}
            </div>
          </details>
        )}

        {drafted && month.cleaningSummary.length > 0 && (
          <details className="warehouse-analysis__details warehouse-analysis__repairs">
            <summary>
              <span>CLEANING RECORD</span>
              <b>{month.cleaningSummary.length} steps</b>
              <ChevronRight size={12} />
            </summary>
            <ul>
              {month.cleaningSummary.map((item) => (
                <li key={item}>
                  <Check size={11} /> <span>{item}</span>
                </li>
              ))}
            </ul>
          </details>
        )}

        {view === "original" && drafted && (
          <footer className="warehouse-analysis__actions">
            <button
              className="primary-button warehouse-analysis__primary"
              onClick={onOpenClean}
            >
              <Sparkles size={14} /> Open the cleaned table
            </button>
            <small>The source remains unchanged.</small>
          </footer>
        )}
      </aside>
    </Modal>
  );
}
