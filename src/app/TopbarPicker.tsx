import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface TopbarPickerOption {
  value: string;
  label: string;
}

interface TopbarPickerAction {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}

export function TopbarPicker({
  ariaLabel,
  listLabel,
  value,
  options,
  onSelect,
  icon,
  variant,
  triggerId,
  action,
}: {
  ariaLabel: string;
  listLabel: string;
  value: string;
  options: TopbarPickerOption[];
  onSelect: (value: string) => void;
  icon: ReactNode;
  variant: "project-picker" | "month-picker";
  triggerId?: string;
  action?: TopbarPickerAction;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selected = options[selectedIndex];

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus)
      window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const show = (index = selectedIndex) => {
    if (options.length === 0) return;
    setActiveIndex(Math.max(0, Math.min(index, options.length - 1)));
    setOpen(true);
  };

  const focusOption = (index: number) => {
    if (options.length === 0) return;
    const next = (index + options.length) % options.length;
    setActiveIndex(next);
    optionRefs.current[next]?.focus();
  };

  const choose = (option: TopbarPickerOption) => {
    if (option.value !== value) onSelect(option.value);
    close(true);
  };

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() =>
      optionRefs.current[activeIndex]?.focus(),
    );
  }, [activeIndex, open]);

  return (
    <div
      className={`topbar-picker ${variant}${open ? " is-open" : ""}`}
      ref={rootRef}
    >
      {icon}
      <button
        id={triggerId}
        ref={triggerRef}
        className={`topbar-picker__trigger ${variant}__trigger`}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-value={value}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            show(Math.min(selectedIndex + 1, options.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            show(Math.max(selectedIndex - 1, 0));
          } else if (event.key === "Home") {
            event.preventDefault();
            show(0);
          } else if (event.key === "End") {
            event.preventDefault();
            show(Math.max(0, options.length - 1));
          }
        }}
      >
        <span>{selected?.label ?? "Choose"}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {action ? (
        <button
          className={`topbar-picker__action ${variant}__new`}
          type="button"
          onClick={() => {
            close();
            action.onClick();
          }}
          aria-label={action.label}
          title={action.label}
        >
          {action.icon}
        </button>
      ) : null}
      {open ? (
        <div
          className={`topbar-picker__menu ${variant}__menu`}
          role="listbox"
          aria-label={listLabel}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <button
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                className={`topbar-picker__option ${variant}__option${isSelected ? " is-selected" : ""}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                tabIndex={index === activeIndex ? 0 : -1}
                key={option.value}
                onClick={() => choose(option)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    focusOption(index + 1);
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    focusOption(index - 1);
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    focusOption(0);
                  } else if (event.key === "End") {
                    event.preventDefault();
                    focusOption(options.length - 1);
                  } else if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    choose(option);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    close(true);
                  } else if (event.key === "Tab") {
                    close();
                  }
                }}
              >
                <span>{option.label}</span>
                {isSelected ? <Check size={13} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
