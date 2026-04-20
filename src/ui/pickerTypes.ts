import type { CaseTopic, MethodTopic, TheoryTopic } from "../registry/insightRegistry";

export type RegistryTopic = TheoryTopic | CaseTopic | MethodTopic;

export type RawDomain = "biotech" | "openclaw" | "ai" | "general";

export type TopicPickerState = null | {
  kind:
    | "theory"
    | "case"
    | "method"
    | "insight"
    | "raw"
    | "markitdown"
    | "doc"
    | "debug"
    | "system"
    | "case_by_domain";
};
