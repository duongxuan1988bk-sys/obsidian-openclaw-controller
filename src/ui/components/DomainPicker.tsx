/**
 * DomainPicker
 *
 * Domain selection card for insight/doc/debug/system/case_by_domain workflows.
 * biotech, openclaw, ai, general.
 */

import React from "react";
import { X } from "lucide-react";

export type InsightDomainOption = {
  value: "biotech" | "openclaw" | "ai" | "general";
  label: string;
  description: string;
};

export const INSIGHT_DOMAIN_OPTIONS: InsightDomainOption[] = [
  { value: "biotech", label: "Biotech", description: "Biotechnology and life sciences" },
  { value: "openclaw", label: "OpenClaw", description: "OpenClaw ecosystem and tools" },
  { value: "ai", label: "AI", description: "Artificial intelligence and machine learning" },
  { value: "general", label: "General", description: "General-purpose notes" },
];

type Props = {
  title: string;
  options: InsightDomainOption[];
  onPick: (domain: InsightDomainOption["value"]) => void;
  onCancel: () => void;
};

export function DomainPicker(props: Props) {
  return (
    <div className="oc-topic-picker-card">
      <div className="oc-topic-picker-header">
        <div>
          <div className="oc-topic-picker-kicker">{props.title}</div>
          <div className="oc-topic-picker-title">Choose a domain</div>
        </div>
        <button
          className="oc-topic-picker-close"
          type="button"
          onClick={props.onCancel}
          title="Cancel domain selection"
        >
          <X size={14} />
        </button>
      </div>
      <div className="oc-topic-picker-grid">
        {props.options.map((option) => (
          <button
            key={option.value}
            className="oc-topic-picker-option"
            type="button"
            onClick={() => props.onPick(option.value)}
          >
            <span className="oc-topic-picker-option-label">{option.label}</span>
            <span className="oc-topic-picker-option-desc">{option.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
