import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

type ModalLayer = {
  backdrop: HTMLElement;
  panel: HTMLElement;
  originalZIndex: string;
};

const modalLayers: ModalLayer[] = [];
const isolatedElements = new Map<
  HTMLElement,
  { inert: boolean; ariaHidden: string | null }
>();

function restoreIsolatedElements() {
  isolatedElements.forEach(({ inert, ariaHidden }, element) => {
    element.inert = inert;
    if (ariaHidden === null) element.removeAttribute("aria-hidden");
    else element.setAttribute("aria-hidden", ariaHidden);
  });
  isolatedElements.clear();
}

function syncModalIsolation() {
  restoreIsolatedElements();
  modalLayers.forEach(({ backdrop }, index) => {
    backdrop.style.zIndex = String(100 + index);
  });
  let branch: HTMLElement | null = modalLayers.at(-1)?.backdrop ?? null;

  while (branch?.parentElement) {
    for (const sibling of branch.parentElement.children) {
      if (
        sibling === branch ||
        !(sibling instanceof HTMLElement) ||
        sibling.matches("script, style, link")
      )
        continue;
      isolatedElements.set(sibling, {
        inert: sibling.inert,
        ariaHidden: sibling.getAttribute("aria-hidden"),
      });
      sibling.inert = true;
      sibling.setAttribute("aria-hidden", "true");
    }
    branch = branch.parentElement;
    if (branch === document.body) break;
  }
}

function focusFirstControl(panel: HTMLElement) {
  const first = panel.querySelector<HTMLElement>(
    "input, textarea, select, button:not(.icon-button), [tabindex]:not([tabindex='-1'])",
  );
  (first ?? panel).focus();
}

/**
 * Accessible dialog surface: closes on Escape or backdrop click, moves focus
 * inside on open, and returns it to the opener on close.
 */
export function Modal({
  title,
  description,
  describedById,
  role = "dialog",
  onClose,
  children,
}: {
  title: string;
  description?: string;
  describedById?: string;
  role?: "dialog" | "alertdialog";
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const backdrop = panel?.closest<HTMLElement>(".modal-backdrop");
    if (!panel || !backdrop) return;

    const layer = {
      panel,
      backdrop,
      originalZIndex: backdrop.style.zIndex,
    };
    modalLayers.push(layer);
    syncModalIsolation();
    focusFirstControl(panel);

    const handleKey = (event: KeyboardEvent) => {
      if (modalLayers.at(-1) !== layer) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key === "Tab") {
        const focusable = Array.from(
          panel.querySelectorAll<HTMLElement>(
            "a[href], area[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), [contenteditable='true'], [tabindex]:not([tabindex='-1'])",
          ),
        ).filter(
          (element) =>
            element.offsetParent !== null &&
            element.getAttribute("aria-hidden") !== "true",
        );
        const firstFocusable = focusable[0];
        const lastFocusable = focusable.at(-1);
        if (!firstFocusable || !lastFocusable) {
          event.preventDefault();
          panel.focus();
        } else if (
          event.shiftKey &&
          (document.activeElement === firstFocusable ||
            !panel.contains(document.activeElement))
        ) {
          event.preventDefault();
          lastFocusable.focus();
        } else if (
          !event.shiftKey &&
          document.activeElement === lastFocusable
        ) {
          event.preventDefault();
          firstFocusable.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      const wasTop = modalLayers.at(-1) === layer;
      const layerIndex = modalLayers.indexOf(layer);
      if (layerIndex >= 0) modalLayers.splice(layerIndex, 1);
      backdrop.style.zIndex = layer.originalZIndex;
      syncModalIsolation();
      if (!wasTop) return;
      if (opener?.isConnected && !opener.closest("[inert]")) opener.focus();
      else {
        const previous = modalLayers.at(-1);
        if (previous) focusFirstControl(previous.panel);
      }
    };
  }, []);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal"
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={
          [description ? descriptionId : undefined, describedById]
            .filter(Boolean)
            .join(" ") || undefined
        }
        tabIndex={-1}
        ref={panelRef}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
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
