# Tessera

**A dashboard workspace people and agents build once and maintain together.**

Tessera is a visual analytics workspace for recurring operational reporting.
People and WebMCP agents prepare data, build dashboards, and maintain the same
durable artifact through one validated command model.

## Why WebMCP

Generated dashboards are easy to create and hard to maintain. Source columns
change, new reporting periods arrive, and people rearrange or restyle the work
after it is generated. Tessera keeps those changes instead of rebuilding the
artifact from scratch.

There is no embedded chatbot or separate agent mode. The browser exposes
Tessera's native operations with
[`document.modelContext.registerTool(...)`](https://webmachinelearning.github.io/webmcp/).
An external agent and the person using the interface operate the same project,
datasets, recipes, dashboards, blocks, bindings, and revision history.

The native browser surface registers four high-value operations and a
three-operation discovery gateway. Through that gateway, an agent can discover
and invoke the complete catalog without flooding its context with dozens of
schemas. Two publication gates remain human-only: resolving ambiguous business
questions and approving a cleaned month for dashboards.

## Capabilities

- Preserve uploaded workbooks as immutable originals beside reviewed clean
  tables.
- Outline multiple source regions, map changing headers, resolve ambiguous
  fields, and save reusable monthly cleaning recipes.
- Build responsive dashboards from editable KPI, narrative, table,
  illustration, and chart blocks.
- Keep persistent dashboard editions by reporting month while preserving
  layout, styling, lineage, and manually created content.
- Trace a displayed metric back to its cleaned table and uploaded source.
- Use the same validation, undo history, and project state for manual and agent
  actions.
- Save through the included server, fall back to browser storage, or mirror
  readable project JSON and uploads to a user-selected folder.

The included Northstar Supply Chain workspace is fictional sample data for
exploring the complete monthly workflow.

## Run locally

Tessera requires Node.js 20.19 or newer (Node.js 22.12 or newer is also
supported).

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5178` in a WebMCP-capable browser. Local state is stored
under `.tessera-data/`, which is excluded from version control.

To exercise WebMCP, open the agent panel in Tessera, copy a suggested request,
and send it through the connected browser agent. Named operations appear in
the activity panel as they execute, and every mutation is immediately visible
in the same workspace.

## Verify

```bash
npm run check
```

The quality gate checks formatting, lint, the production build, unit tests,
and the Playwright end-to-end suite. Tests use an isolated in-memory backend
and do not modify local workspace data.

## Architecture

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

## License

Tessera is released under the [MIT License](LICENSE).
