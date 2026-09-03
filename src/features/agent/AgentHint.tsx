import { useState } from "react";
import { Bot, Check, Copy } from "lucide-react";

export function AgentHint({
  title,
  prompt,
  detail,
  connected,
  onOpenAgent,
}: {
  title: string;
  prompt: string;
  detail?: string;
  connected: boolean;
  onOpenAgent?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <article className={`agent-hint${connected ? " is-live" : ""}`}>
      <button
        type="button"
        className={`agent-hint__copy${copied ? " is-copied" : ""}`}
        aria-label={copied ? "Copied" : "Copy request"}
        title={copied ? "Copied" : "Copy request"}
        onClick={() => {
          void navigator.clipboard
            .writeText(prompt)
            .then(() => setCopied(true))
            .catch(() => setCopied(false));
          window.setTimeout(() => setCopied(false), 1600);
        }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      <header>
        <strong>
          <Bot aria-hidden="true" size={13} />
          {title}
        </strong>
      </header>
      <blockquote>{prompt}</blockquote>
      {detail && <p>{detail}</p>}
      {onOpenAgent && (
        <footer>
          <button type="button" className="link-button" onClick={onOpenAgent}>
            What else can it do?
          </button>
        </footer>
      )}
    </article>
  );
}
