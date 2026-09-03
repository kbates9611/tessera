import { useMemo, useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import type { CommandBus } from "../../domain/commands";
import type { DataAsset, DatasetMonth, DataTable } from "../../domain/types";
import { profileTable } from "../../lib/csv";
import {
  errorMessage,
  formatCell,
  isNumericLikeCell,
  parseCell,
} from "./model";

export function CleanedGrid({
  asset,
  month,
  bus,
  locked,
}: {
  asset: DataAsset;
  month: DatasetMonth;
  bus: CommandBus;
  locked?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EditableTable | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const table = month.cleaned;

  const startEditing = () => {
    setDraft(toEditable(table));
    setError("");
    setEditing(true);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      await bus.execute("update_cleaned_table", {
        datasetId: asset.id,
        period: month.period,
        table: fromEditable(draft),
      });
      setEditing(false);
      setDraft(null);
    } catch (reason) {
      setError(errorMessage(reason, "The cleaned table could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  const shown = editing && draft ? draft : toEditable(table);
  const profile = useMemo(
    () => profileTable(editing && draft ? fromEditable(draft) : table),
    [draft, editing, table],
  );

  return (
    <section className="month-table" aria-label="Cleaned table">
      <header className="month-table__meta">
        <div>
          <strong>Clean table</strong>
          <span>
            {month.status === "pending"
              ? "Draft · not yet used by dashboards"
              : "Approved · used by dashboards"}
          </span>
        </div>
        <div>
          <span>
            {shown.columns.length} columns · {shown.rows.length} rows
          </span>
          {!editing && !locked && (
            <button className="secondary-button" onClick={startEditing}>
              <Pencil size={13} /> Edit table
            </button>
          )}
          {editing && (
            <>
              <button
                className="secondary-button"
                onClick={() => {
                  setEditing(false);
                  setDraft(null);
                  setError("");
                }}
              >
                <X size={13} /> Cancel
              </button>
              <button
                className="primary-button"
                disabled={saving}
                onClick={() => void save()}
              >
                <Check size={13} /> {saving ? "Saving…" : "Save table"}
              </button>
            </>
          )}
        </div>
      </header>
      {error && <p className="form-error">{error}</p>}
      <div className="data-grid-wrap">
        <table className="data-grid">
          <thead>
            <tr>
              <th className="row-number">#</th>
              {shown.columns.map((column, index) => (
                <th
                  key={index}
                  aria-label={`${column}, ${profile.columnProfiles[index]?.type ?? "text"}`}
                >
                  <span className="data-grid__column-heading">
                    {editing ? (
                      <input
                        aria-label={`Rename column ${index + 1}`}
                        value={column}
                        onChange={(event) =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  columns: current.columns.map((item, at) =>
                                    at === index ? event.target.value : item,
                                  ),
                                }
                              : current,
                          )
                        }
                      />
                    ) : (
                      <b>{column}</b>
                    )}
                    <small>
                      {profile.columnProfiles[index]?.type ?? "text"}
                    </small>
                  </span>
                  {editing && (
                    <button
                      type="button"
                      className="data-grid__remove"
                      aria-label={`Remove column ${column}`}
                      title="Remove column"
                      onClick={() =>
                        setDraft((current) =>
                          current ? removeColumn(current, index) : current,
                        )
                      }
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th className="row-number">
                  {editing ? (
                    <button
                      type="button"
                      className="data-grid__remove"
                      aria-label={`Remove row ${rowIndex + 1}`}
                      title="Remove row"
                      onClick={() =>
                        setDraft((current) =>
                          current
                            ? {
                                ...current,
                                rows: current.rows.filter(
                                  (_, at) => at !== rowIndex,
                                ),
                              }
                            : current,
                        )
                      }
                    >
                      <Trash2 size={11} />
                    </button>
                  ) : (
                    rowIndex + 1
                  )}
                </th>
                {shown.columns.map((column, columnIndex) => (
                  <td
                    key={columnIndex}
                    className={
                      isNumericLikeCell(parseCell(row[columnIndex] ?? ""))
                        ? "numeric"
                        : ""
                    }
                  >
                    {editing ? (
                      <input
                        aria-label={`${column} row ${rowIndex + 1}`}
                        value={row[columnIndex] ?? ""}
                        onChange={(event) =>
                          setDraft((current) =>
                            current
                              ? setCell(
                                  current,
                                  rowIndex,
                                  columnIndex,
                                  event.target.value,
                                )
                              : current,
                          )
                        }
                      />
                    ) : (
                      row[columnIndex]
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {editing && (
          <div className="grid-actions">
            <button
              className="secondary-button"
              onClick={() =>
                setDraft((current) =>
                  current
                    ? {
                        ...current,
                        rows: [...current.rows, current.columns.map(() => "")],
                      }
                    : current,
                )
              }
            >
              <Plus size={13} /> Row
            </button>
            <button
              className="secondary-button"
              onClick={() =>
                setDraft((current) =>
                  current
                    ? {
                        columns: [
                          ...current.columns,
                          `Column ${current.columns.length + 1}`,
                        ],
                        rows: current.rows.map((row) => [...row, ""]),
                      }
                    : current,
                )
              }
            >
              <Plus size={13} /> Column
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

interface EditableTable {
  columns: string[];
  rows: string[][];
}

function toEditable(table: DataTable): EditableTable {
  return {
    columns: [...table.columns],
    rows: table.rows.map((row) =>
      table.columns.map((_, index) => formatCell(row[index])),
    ),
  };
}

function fromEditable(table: EditableTable): DataTable {
  return {
    columns: table.columns.map((column) => column.trim()),
    rows: table.rows.map((row) => row.map((cell) => parseCell(cell))),
  };
}

function setCell(
  table: EditableTable,
  row: number,
  column: number,
  value: string,
): EditableTable {
  return {
    ...table,
    rows: table.rows.map((cells, at) =>
      at === row
        ? cells.map((cell, index) => (index === column ? value : cell))
        : cells,
    ),
  };
}

function removeColumn(table: EditableTable, index: number): EditableTable {
  return {
    columns: table.columns.filter((_, at) => at !== index),
    rows: table.rows.map((row) => row.filter((_, at) => at !== index)),
  };
}
