/**
 * TopicPicker
 *
 * Topic selection card for theory/case workflows (biotech domain).
 * SEC, CEX, N_Glycan, Papers, Uncategorized.
 */

import React from "react";
import { X } from "lucide-react";
import type { TheoryTopic, CaseTopic, MethodTopic } from "../../registry/insightRegistry";

type RegistryTopic = TheoryTopic | CaseTopic | MethodTopic;

export type TopicOption = {
  value: RegistryTopic;
  label: string;
  description: string;
};

export const THEORY_TOPIC_OPTIONS: TopicOption[] = [
  { value: "SEC", label: "SEC", description: "Size-exclusion chromatography theory" },
  { value: "CEX", label: "CEX", description: "Cation-exchange chromatography theory" },
  { value: "N_Glycan", label: "N_Glycan", description: "N-glycan profiling and release theory" },
  { value: "Antibody", label: "Antibody", description: "Antibody characterization, developability, and engineering theory" },
  { value: "Papers", label: "Papers", description: "Paper-derived biotech theory notes" },
  { value: "Uncategorized", label: "Uncategorized", description: "Biotech theory notes awaiting classification" },
];

export const CASE_TOPIC_OPTIONS: TopicOption[] = [
  { value: "SEC", label: "SEC", description: "SEC-related biotech case" },
  { value: "CEX", label: "CEX", description: "CEX-related biotech case" },
  { value: "N_Glycan", label: "N_Glycan", description: "N-glycan related biotech case" },
  { value: "Antibody", label: "Antibody", description: "Antibody developability, stability, and characterization case" },
  { value: "Uncategorized", label: "Uncategorized", description: "Biotech case awaiting classification" },
];

export const METHOD_TOPIC_OPTIONS: TopicOption[] = [
  { value: "SEC", label: "SEC", description: "SEC method, platform setup, and method parameters" },
  { value: "CEX", label: "CEX", description: "CEX method, gradients, and assay setup" },
  { value: "N_Glycan", label: "N_Glycan", description: "N-glycan preparation and analysis method" },
  { value: "Antibody", label: "Antibody", description: "Antibody characterization or formulation method" },
  { value: "Uncategorized", label: "Uncategorized", description: "Biotech method awaiting classification" },
];

type Props = {
  title: string;
  options: TopicOption[];
  onPick: (topic: RegistryTopic) => void;
  onCancel: () => void;
};

export function TopicPicker(props: Props) {
  return (
    <div className="oc-topic-picker-card">
      <div className="oc-topic-picker-header">
        <div>
          <div className="oc-topic-picker-kicker">{props.title}</div>
          <div className="oc-topic-picker-title">Choose a biotech topic</div>
        </div>
        <button
          className="oc-topic-picker-close"
          type="button"
          onClick={props.onCancel}
          title="Cancel topic selection"
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
            <span className="oc-topic-picker-option-description">{option.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
