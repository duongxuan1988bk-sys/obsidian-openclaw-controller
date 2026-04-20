/**
 * WorkflowPicker
 *
 * The MiniSelect dropdown (quick-action menu) embedded in the input bar.
 * Shows the list of available workflow shortcuts:
 *   Convert to Insight / Theory / Case / Doc / Debug / System / Raw / PDF / MarkItDown
 *   Organize Note Links / Rewrite Note / Fix Schema
 *
 * This was previously inline JSX inside the oc-composer-pill in view.tsx.
 * Extracted to allow independent testing and future menu expansion.
 *
 * All conversion logic is passed in as callbacks — no internal business logic.
 */

import React from "react";
import { Wand2 } from "lucide-react";
import { MiniSelect } from "./components/MiniSelect";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onConvertToInsight: () => void;
  onConvertToTheory: () => void;
  onConvertToCase: () => void;
  onConvertToMethod: () => void;
  onConvertToDoc: () => void;
  onConvertToDebug: () => void;
  onConvertToSystem: () => void;
  onConvertToRaw: () => void;
  onConvertToPdf: () => void;
  onConvertToMarkItDown: () => void;
  onOrganizeLinks: () => void;
  onRewriteNote: () => void;
  onFixSchema: () => void;
  onTranslateNote: () => void;
};

// Map selected value → trigger the appropriate callback, then reset to default
function handleChange(
  value: string,
  opts: {
    onConvertToInsight: () => void;
    onConvertToTheory: () => void;
    onConvertToCase: () => void;
    onConvertToMethod: () => void;
    onConvertToDoc: () => void;
    onConvertToDebug: () => void;
    onConvertToSystem: () => void;
    onConvertToRaw: () => void;
    onConvertToPdf: () => void;
    onConvertToMarkItDown: () => void;
    onOrganizeLinks: () => void;
    onRewriteNote: () => void;
    onFixSchema: () => void;
    onTranslateNote: () => void;
    setQuickAction: (v: string) => void;
  }
) {
  const { setQuickAction, ...cbs } = opts;
  switch (value) {
    case "convert-to-insight":
      cbs.onConvertToInsight();
      break;
    case "convert-to-theory":
      cbs.onConvertToTheory();
      break;
    case "convert-to-case":
      cbs.onConvertToCase();
      break;
    case "convert-to-method":
      cbs.onConvertToMethod();
      break;
    case "convert-to-doc":
      cbs.onConvertToDoc();
      break;
    case "convert-to-debug":
      cbs.onConvertToDebug();
      break;
    case "convert-to-system":
      cbs.onConvertToSystem();
      break;
    case "convert-to-raw":
      cbs.onConvertToRaw();
      break;
    case "convert-to-pdf":
      cbs.onConvertToPdf();
      break;
    case "convert-to-markitdown":
      cbs.onConvertToMarkItDown();
      break;
    case "organize-links":
      cbs.onOrganizeLinks();
      break;
    case "rewrite-note":
      cbs.onRewriteNote();
      break;
    case "fix-schema":
      cbs.onFixSchema();
      break;
    case "translate-note":
      cbs.onTranslateNote();
      break;
    default:
      break;
  }
  // Reset dropdown to default label after firing
  setQuickAction("quick-actions");
}

export function WorkflowPicker({
  value,
  onChange,
  onConvertToInsight,
  onConvertToTheory,
  onConvertToCase,
  onConvertToMethod,
  onConvertToDoc,
  onConvertToDebug,
  onConvertToSystem,
  onConvertToRaw,
  onConvertToPdf,
  onConvertToMarkItDown,
  onOrganizeLinks,
  onRewriteNote,
  onFixSchema,
  onTranslateNote,
}: Props) {
  const setQuickAction = onChange;

  return (
    <MiniSelect
      value={value}
      icon={<Wand2 size={9} />}
      onChange={(v) =>
        handleChange(v, {
          onConvertToInsight,
          onConvertToTheory,
          onConvertToCase,
          onConvertToMethod,
          onConvertToDoc,
          onConvertToDebug,
          onConvertToSystem,
          onConvertToRaw,
          onConvertToPdf,
          onConvertToMarkItDown,
          onOrganizeLinks,
          onRewriteNote,
          onFixSchema,
          onTranslateNote,
          setQuickAction,
        })
      }
      ariaLabel="Quick actions"
      showDescriptionInButton={false}
      placement="up"
      width={108}
      menuMinWidth={280}
      options={[
        { value: "quick-actions", label: "Actions", description: "workflow shortcuts" },
        { value: "section-generate", label: "生成", type: "section" },
        { value: "convert-to-insight", label: "Insight", description: "raw → PARA Resources" },
        { value: "convert-to-theory", label: "Theory", description: "biotech→topic; openclaw/ai→direct" },
        { value: "convert-to-case", label: "Case", description: "biotech→topic; openclaw/ai→direct" },
        { value: "convert-to-method", label: "Method", description: "biotech method note" },
        { value: "convert-to-doc", label: "Doc", description: "openclaw/ai → documentation" },
        { value: "convert-to-debug", label: "Debug", description: "openclaw/ai → troubleshooting" },
        { value: "convert-to-system", label: "System", description: "openclaw/ai → system architecture" },
        { value: "section-process", label: "处理", type: "section" },
        { value: "rewrite-note", label: "Rewrite Note", description: "replace with a clearer version" },
        { value: "fix-schema", label: "Fix Schema", description: "repair current frontmatter" },
        { value: "translate-note", label: "Translate", description: "English → Chinese translation" },
        { value: "organize-links", label: "Note Links", description: "review Related Notes candidates" },
        { value: "section-capture", label: "抓取", type: "section" },
        { value: "convert-to-raw", label: "WeChat Raw", description: "WeChat URL → raw note" },
        { value: "convert-to-pdf", label: "PDF Raw", description: "vault PDF → raw note" },
        { value: "convert-to-markitdown", label: "MarkItDown", description: "DOCX/PPT/XLSX/HTML → raw note" },
      ]}
    />
  );
}
