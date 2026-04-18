import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Search } from "lucide-react";

export type PickerItem = {
  id: string;
  label: string;
  sublabel?: string;
};

export function PickerPopover(props: {
  open: boolean;
  title: string;
  items: PickerItem[];
  onPick: (id: string) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  const [q, setQ] = useState("");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setQ("");
    const t = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") props.onClose();
    }
    function onDown(e: MouseEvent) {
      const panel = panelRef.current;
      const anchor = props.anchorRef.current;
      if (!panel || !anchor) return;
      const t = e.target as Node;
      if (panel.contains(t) || anchor.contains(t)) return;
      props.onClose();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [props, props.open]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return props.items;
    return props.items.filter((it) => (it.label + " " + (it.sublabel ?? "")).toLowerCase().includes(qq));
  }, [props.items, q]);

  return (
    <AnimatePresence>
      {props.open ? (
        <motion.div
          ref={panelRef}
          className="oc-popover"
          style={{
            border: "1px solid var(--background-modifier-border)",
            background: "var(--background-primary)",
            borderRadius: 16,
            boxShadow: "var(--shadow-l)"
          }}
          initial={{ opacity: 0, y: 8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.97 }}
          transition={{ type: "spring", stiffness: 380, damping: 30, mass: 0.95 }}
        >
          {/* Header */}
          <div className="oc-popover-header">
            <div className="oc-popover-title">{props.title}</div>
            <div className="oc-popover-search-wrap">
              <span className="oc-popover-search-icon" aria-hidden="true">
                <Search size={12} />
              </span>
              <input
                ref={inputRef}
                className="oc-popover-input"
                placeholder="Search…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>

          {/* List */}
          <div className="max-h-60 overflow-auto oc-scrollbar oc-popover-list">
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-[12px]" style={{ color: "var(--text-muted)" }}>
                No matches
              </div>
            ) : (
              filtered.map((it) => (
                <button
                  key={it.id}
                  className="w-full text-left oc-popover-item"
                  onClick={() => props.onPick(it.id)}
                  type="button"
                >
                  <div className="truncate font-medium" style={{ color: "var(--text-normal)", fontSize: 12 }}>
                    {it.label}
                  </div>
                  {it.sublabel ? (
                    <div className="truncate" style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 1 }}>
                      {it.sublabel}
                    </div>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
