# Tessera

Tessera is a visual analytics workspace where people and WebMCP agents build
and maintain the same dashboards over time. Data preparation, monthly updates,
dashboard editing, and agent actions all use one validated command model.

## Capabilities

- Preserve uploaded workbooks as immutable originals beside reviewed clean
  tables.
- Outline multiple source regions, map changing headers, resolve ambiguous
  fields, and save reusable monthly cleaning recipes.
- Build responsive dashboards from editable KPI, narrative, table,
  illustration, and chart blocks.
- Keep durable dashboard editions by reporting month while preserving layout,
  styling, lineage, and manually created content.
- Expose the application through WebMCP with the same validation and undo
  history used by manual controls.
- Save locally through the included server, fall back to browser storage, or
  sync readable project JSON and uploads to a user-selected folder.

The included Northstar Supply Chain workspace is fictional sample data for
exploring the complete monthly workflow.

## Development

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5178`. Local state is stored under `.tessera-data/`,
which is excluded from version control.

```bash
npm run build
npm start
npm run check
```

`npm run check` verifies formatting, lint, the production build, unit tests,
and the Playwright end-to-end suite. Tests use an isolated in-memory backend
and do not modify local workspace data.

## Structure

| Path                     | Responsibility                                            |
| ------------------------ | --------------------------------------------------------- |
| `src/app`                | Application shell, persistence, live sync, and history    |
| `src/domain`             | State types, defaults, validation, and command operations |
| `src/features/agent`     | WebMCP status, activity, and contextual requests          |
| `src/features/dashboard` | Canvas, blocks, charts, layout, and inspector             |
| `src/features/warehouse` | Uploads, source outlining, recipes, and monthly review    |
| `src/webmcp`             | WebMCP registration and compact tool gateway              |
| `server`                 | Local storage server and hosted runtime                   |
| `tests`                  | Unit and end-to-end coverage                              |

Hosted workspaces are isolated per visitor. State is revisioned, uploads are
scoped to the same workspace, and reset restores only that visitor's fictional
demo data.
