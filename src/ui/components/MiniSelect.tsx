import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";

export type MiniSelectOption = { value: string; label: string; description?: string; type?: "option" | "section" };

export function MiniSelect(props: {
  value: string;
  options: MiniSelectOption[];
  onChange: (value: string) => void;
  icon?: React.ReactNode;
  ariaLabel?: string;
  showDescriptionInButton?: boolean;
  placement?: "up" | "down";
  width?: string | number;
  menuMinWidth?: string | number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(() => props.options.find((o) => o.value === props.value) ?? props.options[0], [props.options, props.value]);

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  return (
    <div ref={ref} className="relative min-w-0" style={props.width != null ? { width: props.width } : undefined}>
      <button
        className="w-full oc-pill oc-select-trigger px-2 py-1 text-left text-[11px] inline-flex items-center justify-between gap-1.5"
        onClick={() => setOpen((v) => !v)}
        aria-label={props.ariaLabel ?? "Select"}
        type="button"
        data-open={open ? "true" : undefined}
      >
        <span className="min-w-0 truncate inline-flex items-center gap-1.5">
          {props.icon ? <span className="oc-select-leading-icon" aria-hidden="true">{props.icon}</span> : null}
          <span className="font-medium" style={{ color: "var(--text-normal)" }}>
            {selected?.label ?? props.value}
          </span>
          {props.showDescriptionInButton !== false && selected?.description ? (
            <span className="ml-2" style={{ color: "var(--text-muted)" }}>
              {selected.description}
            </span>
          ) : null}
        </span>
        <motion.span
          aria-hidden="true"
          className="flex-shrink-0"
          style={{ color: "var(--text-muted)", display: "inline-flex", alignItems: "center" }}
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 28 }}
        >
          <ChevronDown size={11} />
        </motion.span>
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            className="absolute z-50 overflow-hidden oc-select-menu"
            style={{
              width: "max-content",
              minWidth: props.menuMinWidth ?? "100%",
              maxWidth: "min(360px, calc(100vw - 32px))",
              ...(props.placement === "up" ? { bottom: "calc(100% + 6px)" } : { top: "calc(100% + 6px)" })
            }}
            initial={{ opacity: 0, y: props.placement === "up" ? 6 : -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: props.placement === "up" ? 6 : -6, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 420, damping: 28, mass: 0.9 }}
          >
            {props.options.map((o, i) => {
              const active = o.value === props.value;
              const isSection = o.type === "section";
              const prevIsSection = i > 0 && props.options[i - 1].type === "section";
              return (
                <React.Fragment key={o.value}>
                  {prevIsSection && !isSection ? <div className="oc-select-divider" aria-hidden="true" /> : null}
                  {isSection ? (
                    <div
                      style={{
                        padding: "6px 10px 3px",
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: "var(--text-muted)",
                        userSelect: "none",
                      }}
                    >
                      {o.label}
                    </div>
                  ) : (
                    <button
                      className="w-full oc-select-option"
                      style={{
                        background: active ? "var(--background-modifier-hover)" : "transparent",
                        color: "var(--text-normal)",
                        display: "flex",
                        flexDirection: "row",
                        alignItems: "flex-start",
                        padding: "7px 10px",
                        gap: 6,
                        textAlign: "left",
                      }}
                      onClick={() => {
                        props.onChange(o.value);
                        setOpen(false);
                      }}
                      type="button"
                    >
                      {/* check 占位列，固定 16px，始终存在保证文字列对齐 */}
                      <span style={{
                        width: 16,
                        minWidth: 16,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        paddingTop: 2,
                        color: active ? "var(--interactive-accent)" : "transparent",
                      }}>
                        <Check size={12} />
                      </span>
                      {/* label */}
                      <span style={{
                        fontSize: 12,
                        fontWeight: 500,
                        lineHeight: "16px",
                        color: active ? "var(--interactive-accent)" : "var(--text-normal)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        flex: 1,
                        minWidth: 0,
                      }}>
                        {o.label}
                      </span>
                    </button>
                  )}
                </React.Fragment>
              );
            })}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
