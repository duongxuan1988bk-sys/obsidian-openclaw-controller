import React from "react";
import { Check, X } from "lucide-react";

export type PermissionRequestModel = {
  id: string;
  title: string;
  kind: string;
  payloadPreview: string;
};

export function PermissionRequest(props: {
  req: PermissionRequestModel;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}) {
  return (
    <div className="px-2 py-2">
      <div className="rounded-md border p-2" style={{ borderColor: "var(--oc-border)", background: "var(--oc-surface-2)" }}>
        <div className="text-[11px] uppercase tracking-wide" style={{ color: "var(--oc-muted)" }}>
          Permission requested
        </div>
        <div className="mt-1 text-[13px] font-medium" style={{ color: "var(--text-normal)" }}>
          {props.req.title}
        </div>
        <div className="mt-1 text-[12px]" style={{ color: "var(--oc-muted)" }}>
          {props.req.kind}
        </div>
        <pre
          className="mt-2 p-2 rounded-md overflow-auto text-[11px] oc-scrollbar"
          style={{ background: "var(--background-primary)", border: `1px solid var(--oc-border)`, color: "var(--text-normal)" }}
        >
          {props.req.payloadPreview}
        </pre>
        <div className="mt-2 flex gap-2">
          <button
            className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 rounded-md"
            style={{ background: "var(--interactive-accent)", color: "var(--text-on-accent)" }}
            onClick={() => props.onApprove(props.req.id)}
          >
            <Check size={14} /> Approve
          </button>
          <button
            className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 rounded-md border"
            style={{ borderColor: "var(--oc-border)", background: "transparent", color: "var(--text-normal)" }}
            onClick={() => props.onDeny(props.req.id)}
          >
            <X size={14} /> Deny
          </button>
        </div>
      </div>
    </div>
  );
}

