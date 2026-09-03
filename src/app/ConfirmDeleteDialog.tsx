import { useId, useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { Modal } from "./Modal";

export function ConfirmDeleteDialog({
  title,
  description,
  impactTitle,
  impact,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  impactTitle: string;
  impact: ReactNode;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const impactId = useId();

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "This item could not be deleted.",
      );
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      description={description}
      describedById={impactId}
      role="alertdialog"
      onClose={busy ? () => undefined : onClose}
    >
      <div className="delete-confirmation" id={impactId}>
        <span className="delete-confirmation__icon" aria-hidden="true">
          <Trash2 size={18} />
        </span>
        <div>
          <strong>{impactTitle}</strong>
          <p>{impact}</p>
        </div>
      </div>
      <p className="delete-confirmation__undo">
        You can undo this from the top bar until you close or reload the
        workspace.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal__actions">
        <button
          type="button"
          className="secondary-button"
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className="danger-button"
          onClick={() => void confirm()}
          disabled={busy}
        >
          <Trash2 size={13} /> {busy ? "Deleting…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
