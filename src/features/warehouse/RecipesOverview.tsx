import { ArrowRight, GitBranch, Pencil, ShieldCheck } from "lucide-react";
import type { DataAsset, TesseraProject } from "../../domain/types";
import { selectReadyMonth } from "./model";

/**
 * One recipe per dataset: the header map and notes reused for every new
 * month. Recipes learn when a month is approved and can be edited directly.
 */
export function RecipesOverview({
  project,
  onEdit,
}: {
  project: TesseraProject;
  onEdit: (asset: DataAsset) => void;
}) {
  const mappedFields = project.warehouse.reduce(
    (total, item) => total + Object.keys(item.recipe.headerMap).length,
    0,
  );
  const savedRecipes = project.warehouse.filter(
    (item) =>
      Object.keys(item.recipe.headerMap).length || item.recipe.notes.length,
  ).length;

  return (
    <section className="warehouse-overview recipes-overview">
      <header className="warehouse-overview__intro">
        <div>
          <span className="eyebrow">CLEANING RECIPES</span>
          <h2>Clean next month the same way as this month</h2>
          <p>
            A recipe remembers how a dataset’s source headers become canonical
            fields. Every approval updates it, and you can edit it directly, so
            the next upload cleans itself while anything new is still shown to
            you.
          </p>
        </div>
        <div className="warehouse-overview__metrics">
          <span>
            <strong>{savedRecipes}</strong> saved recipe
            {savedRecipes === 1 ? "" : "s"}
          </span>
          <span>
            <strong>{mappedFields}</strong> header mapping
            {mappedFields === 1 ? "" : "s"}
          </span>
        </div>
      </header>

      <div className="recipe-explainer" aria-label="How a recipe works">
        <div>
          <span>1</span>
          <div>
            <b>New month arrives</b>
            <small>The original file stays unchanged</small>
          </div>
        </div>
        <ArrowRight size={16} />
        <div>
          <span>2</span>
          <div>
            <b>Recipe is applied</b>
            <small>Known headers map themselves; new ones wait for you</small>
          </div>
        </div>
        <ArrowRight size={16} />
        <div>
          <span>3</span>
          <div>
            <b>You approve</b>
            <small>The recipe learns the confirmed mappings</small>
          </div>
        </div>
      </div>

      <div className="recipe-library">
        <header className="recipe-library__header">
          <div>
            <span className="eyebrow">YOUR RECIPES</span>
            <h3>One recipe per dataset</h3>
          </div>
          <p>
            Edit a recipe to rename fields or add headers before they arrive.
          </p>
        </header>
        {project.warehouse.map((item) => {
          const latest = selectReadyMonth(item);
          const mappings = Object.entries(item.recipe.headerMap);
          const steps = latest?.cleaningSummary ?? item.recipe.notes;
          return (
            <article className="recipe-card recipe-row" key={item.id}>
              <div className="recipe-row__identity">
                <span className="recipe-card__icon">
                  <GitBranch size={16} />
                </span>
                <div>
                  <h3>{item.name}</h3>
                  <p>{item.recipe.name || `${item.name} cleaning recipe`}</p>
                </div>
              </div>
              <div className="recipe-row__summary">
                <span>
                  <b>{mappings.length}</b>
                  <small>header mappings</small>
                </span>
                <span>
                  <b>{steps.length}</b>
                  <small>cleanup steps</small>
                </span>
              </div>
              <div className="recipe-row__latest">
                <small>LAST APPROVED</small>
                <b>{latest?.label ?? "Not used yet"}</b>
                <span>
                  {item.months.length} stored month
                  {item.months.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="recipe-row__action">
                <button
                  className="secondary-button"
                  onClick={() => onEdit(item)}
                >
                  <Pencil size={13} /> Edit recipe
                </button>
              </div>
            </article>
          );
        })}
        {!project.warehouse.length && (
          <p className="recipe-detail__empty">
            Recipes appear here once a dataset exists.
          </p>
        )}
      </div>

      <aside className="recipe-help">
        <span>
          <ShieldCheck size={15} />
        </span>
        <div>
          <b>Recipes never change the uploaded source.</b>
          <p>
            They only shape the separate clean version, so every transformation
            can be checked against the original file.
          </p>
        </div>
      </aside>
    </section>
  );
}
