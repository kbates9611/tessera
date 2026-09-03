import { useMemo, useState } from "react";
import {
  Bot,
  Check,
  Copy,
  Database,
  LayoutDashboard,
  Palette,
  Sparkles,
  TerminalSquare,
  Wand2,
} from "lucide-react";
import type { CommandBus } from "../../domain/commands";
import type {
  ActivityEntry,
  TesseraProject,
  ToolDefinition,
} from "../../domain/types";
import { Modal } from "../../app/Modal";
import { agentCatalog } from "../../webmcp/register";
import { suggestedPrompts, type PromptContext } from "./prompts";

const TOOL_GROUPS: Array<{
  name: string;
  icon: typeof Database;
  match: RegExp;
}> = [
  {
    name: "Data warehouse",
    icon: Database,
    match: /dataset|month|refresh|source|clean|recipe|analyze/,
  },
  {
    name: "Dashboards and layout",
    icon: LayoutDashboard,
    match:
      /project|dashboard|placeholder|layout|move_block|remove_block|duplicate_block|update_block|illustrations$/,
  },
  { name: "Story blocks and charts", icon: Wand2, match: /^add_/ },
  {
    name: "Exact styling",
    icon: Palette,
    match: /^style_|^set_table_sort$/,
  },
];

export function AgentPanel({
  bus,
  project,
  context,
  connected,
  registeredCount,
  onClose,
}: {
  bus: CommandBus;
  project: TesseraProject;
  context: PromptContext;
  connected: boolean;
  registeredCount: number;
  onClose: () => void;
}) {
  const catalog = useMemo(() => agentCatalog(bus), [bus]);
  const groups = useMemo(() => groupTools(catalog), [catalog]);
  const prompts = useMemo(
    () => suggestedPrompts(project, context),
    [project, context],
  );
  const recent = project.activity
    .filter((entry) => entry.source === "webmcp")
    .slice(0, 5);

  return (
    <Modal
      title="Work with your agent"
      description="Tessera registers its operations with the browser through WebMCP. A connected agent can read this workspace and make the same changes you can, with every result validated before it lands on the page."
      onClose={onClose}
    >
      <div className="agent-panel">
        <section
          className={`agent-panel__status${connected ? " is-live" : ""}`}
        >
          <span className="agent-panel__badge">
            <Sparkles size={14} />
            {connected ? "Agent connected" : "Waiting for an agent"}
          </span>
          <div>
            <strong>
              {catalog.length} operations
              {connected
                ? ` · ${registeredCount} registered in this browser`
                : ""}
            </strong>
            <p>
              {connected
                ? "Ask in your agent's chat while this tab stays open. Changes appear here as they happen and can be undone like any edit."
                : "Open this page in a browser that supports WebMCP and the operations register automatically. Nothing to configure."}
            </p>
          </div>
        </section>

        <div className="agent-panel__columns">
          <section
            className="agent-panel__prompts"
            aria-label="Suggested requests"
          >
            <h3>
              <Bot size={14} /> Try asking
            </h3>
            <p>Suggestions follow what is open right now.</p>
            {prompts.map((prompt) => (
              <PromptCard
                key={prompt.title}
                title={prompt.title}
                text={prompt.text}
              />
            ))}
          </section>

          <section
            className="agent-panel__catalog"
            aria-label="Agent operations"
          >
            <h3>
              <TerminalSquare size={14} /> What the agent can do
            </h3>
            {groups.map((group) => (
              <details key={group.name} open={group.name === "Data warehouse"}>
                <summary>
                  <group.icon size={13} />
                  <span>{group.name}</span>
                  <small>{group.items.length}</small>
                </summary>
                <ul>
                  {group.items.map((tool) => (
                    <li key={tool.name} title={tool.description.split("\n")[0]}>
                      <code>{tool.name}</code>
                      <span>{tool.title}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
            <section
              className="agent-panel__activity"
              aria-label="Recent agent activity"
            >
              <h3>Recent agent activity</h3>
              {recent.length ? (
                recent.map((entry) => (
                  <ActivityRow key={entry.id} entry={entry} />
                ))
              ) : (
                <p>
                  Nothing yet. Agent actions are listed here as they happen.
                </p>
              )}
            </section>
          </section>
        </div>

        <footer className="agent-panel__footer">
          <Check size={13} />
          <span>
            Everything the agent can do, you can also do by hand. Approving
            cleaned data, answering cleaning questions, and confirming deletions
            stay with you.
          </span>
        </footer>
      </div>
    </Modal>
  );
}

function PromptCard({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <article className="agent-prompt">
      <header>
        <strong>{title}</strong>
        <button
          type="button"
          className={`agent-prompt__copy${copied ? " is-copied" : ""}`}
          onClick={() => {
            void navigator.clipboard
              .writeText(text)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
            window.setTimeout(() => setCopied(false), 1600);
          }}
          aria-label={`Copy request: ${title}`}
          title={copied ? "Copied" : "Copy request"}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </header>
      <blockquote>{text}</blockquote>
    </article>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  return (
    <div className="agent-activity-row">
      <code>{entry.tool}</code>
      <span>{entry.summary}</span>
    </div>
  );
}

function groupTools(catalog: ToolDefinition[]) {
  const assigned = new Set<string>();
  const groups = TOOL_GROUPS.map((group) => {
    const items = catalog.filter(
      (tool) => !assigned.has(tool.name) && group.match.test(tool.name),
    );
    items.forEach((tool) => assigned.add(tool.name));
    return { ...group, items };
  });
  const rest = catalog.filter((tool) => !assigned.has(tool.name));
  if (rest.length)
    groups.push({
      name: "Workspace",
      icon: Database,
      match: /./,
      items: rest,
    });
  return groups.filter((group) => group.items.length);
}
