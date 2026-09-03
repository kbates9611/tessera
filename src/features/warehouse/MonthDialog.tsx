import { useMemo, useState } from "react";
import { FileSpreadsheet, LockKeyhole } from "lucide-react";
import type { CommandBus } from "../../domain/commands";
import type { CellValue, DataAsset, DataTable } from "../../domain/types";
import { parseDelimitedText, periodLabel } from "../../lib/csv";
import { Modal } from "../../app/Modal";
import {
  errorMessage,
  excelRowsToTable,
  formatCell,
  isValidPeriod,
  nextUploadPeriod,
  normalizeExcelCell,
  persistSourceFile,
} from "./model";

interface SheetDraft {
  name: string;
  rows: CellValue[][];
  table: DataTable;
}

/**
 * Adds one monthly version to a dataset. The upload is saved exactly as
 * received and becomes the immutable Original; cleaning happens afterwards in
 * the warehouse, by hand or with the agent.
 */
export function MonthDialog({
  asset,
  bus,
  onClose,
  onCreated,
}: {
  asset: DataAsset;
  bus: CommandBus;
  onClose: () => void;
  onCreated: (period: string) => void;
}) {
  const [period, setPeriod] = useState(nextUploadPeriod(asset));
  const [sourceName, setSourceName] = useState("Pasted data");
  const [sourceFile, setSourceFile] = useState<File>();
  const [raw, setRaw] = useState("");
  const [workbookSheets, setWorkbookSheets] = useState<SheetDraft[]>([]);
  const [sheetName, setSheetName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);

  const sheets = useMemo<SheetDraft[]>(() => {
    if (workbookSheets.length) return workbookSheets;
    const table = parseDelimitedText(raw);
    if (!table.columns.length) return [];
    return [
      { name: "Pasted data", table, rows: [table.columns, ...table.rows] },
    ];
  }, [raw, workbookSheets]);
  const activeSheet =
    sheets.find((sheet) => sheet.name === sheetName) ?? sheets[0];
  const periodTaken = asset.months.some((month) => month.period === period);
  const canSave =
    isValidPeriod(period) && !periodTaken && Boolean(activeSheet) && !saving;

  const readFile = async (file: File) => {
    setReading(true);
    setError("");
    setNotice("");
    setSourceName(file.name);
    setSourceFile(file);
    try {
      if (file.name.toLowerCase().endsWith(".xlsx")) {
        const { default: readExcelFile } =
          await import("read-excel-file/browser");
        const parsed = await readExcelFile(file);
        const next = parsed.map((sheet) => ({
          name: sheet.sheet,
          rows: sheet.data.map((row) => row.map(normalizeExcelCell)),
          table: excelRowsToTable(sheet.data),
        }));
        setWorkbookSheets(next);
        setSheetName(next[0]?.name ?? "");
        setRaw("");
      } else {
        setWorkbookSheets([]);
        setSheetName("Pasted data");
        setRaw(await file.text());
      }
    } catch (reason) {
      setError(errorMessage(reason, "This file could not be read."));
    } finally {
      setReading(false);
    }
  };

  const save = async () => {
    if (!activeSheet || !canSave) return;
    setSaving(true);
    setError("");
    try {
      let stored:
        | { storageKey: string; checksum: string; contentType: string }
        | undefined;
      if (sourceFile) {
        try {
          stored = await persistSourceFile(sourceFile);
        } catch {
          setNotice(
            "The exact file could not be stored, so only its rows were saved.",
          );
        }
      }
      await bus.execute("save_dataset_month_upload", {
        datasetId: asset.id,
        period,
        label: periodLabel(period),
        sourceName,
        original: activeSheet.table,
        workbook: {
          fileName: sourceName,
          ...(sourceFile ? { byteLength: sourceFile.size } : {}),
          ...stored,
          sheets: sheets.map((sheet) => ({
            name: sheet.name,
            rowCount: sheet.rows.length,
            columnCount: sheet.rows.reduce(
              (widest, row) => Math.max(widest, row.length),
              0,
            ),
            rows: sheet.rows,
            regions: [],
          })),
        },
      });
      onCreated(period);
    } catch (reason) {
      setError(errorMessage(reason, "This upload could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Add a month to ${asset.name}`}
      description="The upload is stored exactly as received and never changed. Cleaning creates a separate table that you approve before dashboards use it."
      onClose={onClose}
    >
      <div className="form-stack month-form">
        <div className="form-row">
          <label>
            Month
            <input
              type="month"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
              aria-invalid={!isValidPeriod(period) || periodTaken}
            />
            {periodTaken && (
              <small className="field-hint is-error">
                {periodLabel(period)} already exists for this dataset.
              </small>
            )}
            {!isValidPeriod(period) && (
              <small className="field-hint is-error">
                Use the YYYY-MM form.
              </small>
            )}
          </label>
          <label>
            Source name
            <input
              value={sourceName}
              onChange={(event) => setSourceName(event.target.value)}
            />
          </label>
        </div>
        <label>
          Paste CSV, TSV, or semicolon-separated data
          <textarea
            className="data-paste"
            value={raw}
            onChange={(event) => {
              setRaw(event.target.value);
              setWorkbookSheets([]);
              setSourceFile(undefined);
              setSheetName("Pasted data");
              setNotice("");
              if (sourceName !== "Pasted data" && !sourceFile)
                setSourceName("Pasted data");
            }}
            placeholder={
              "Region,Revenue,Target\nNorth,124000,120000\nSouth,98500,110000"
            }
          />
        </label>
        <label className="file-picker">
          <FileSpreadsheet size={14} />
          {reading ? "Reading file…" : "Or choose a .xlsx, .csv, or .tsv file"}
          <input
            type="file"
            accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/tab-separated-values,text/plain"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void readFile(file);
            }}
          />
        </label>
        {sheets.length > 1 && (
          <label>
            Sheet that holds the table
            <select
              value={activeSheet?.name}
              onChange={(event) => setSheetName(event.target.value)}
            >
              {sheets.map((sheet) => (
                <option key={sheet.name} value={sheet.name}>
                  {sheet.name} · {Math.max(0, sheet.rows.length - 1)} rows
                </option>
              ))}
            </select>
          </label>
        )}
        {activeSheet && <UploadPreview sheet={activeSheet} />}
        {notice && <p className="form-notice">{notice}</p>}
        {error && <p className="form-error">{error}</p>}
        <div className="modal__actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={!canSave}
            onClick={() => void save()}
          >
            <LockKeyhole size={13} />
            {saving ? "Saving original…" : "Save original"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function UploadPreview({ sheet }: { sheet: SheetDraft }) {
  const columns = sheet.table.columns.slice(0, 6);
  const rows = sheet.table.rows.slice(0, 4);
  return (
    <section className="upload-preview" aria-label="Upload preview">
      <header>
        <strong>
          {sheet.table.rows.length} rows · {sheet.table.columns.length} columns
        </strong>
        <span>
          {sheet.name === "Pasted data" ? "Detected from the text" : sheet.name}
        </span>
      </header>
      <table>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th key={index}>{column}</th>
            ))}
            {sheet.table.columns.length > 6 && <th>…</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((_, index) => (
                <td key={index}>{formatCell(row[index])}</td>
              ))}
              {sheet.table.columns.length > 6 && <td>…</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
