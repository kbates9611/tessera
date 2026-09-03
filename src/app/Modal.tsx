import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Accessible dialog surface: closes on Escape or backdrop click, moves focus
 * inside on open, and returns it to the opener on close.
 */
export function Modal({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(
      "input, textarea, select, button:not(.icon-button), [tabindex]:not([tabindex='-1'])",
    );
    (first ?? panel)?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      opener?.focus?.();
    };
  }, []);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panelRef}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal__header">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
