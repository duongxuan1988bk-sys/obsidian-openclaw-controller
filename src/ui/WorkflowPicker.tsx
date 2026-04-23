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
  onConvertToRaw: () => void;
  onConvertToPdf: () => void;
  onConvertToMarkItDown: () => void;
  onOrganizeLinks: () => void;
  onRewriteNote: () => void;
  onFixSchema: () => void;
};

// Map selected value → trigger the appropriate callback, then reset to default
function handleChange(
  value: string,
  opts: {
    onConvertToRaw: () => void;
    onConvertToPdf: () => void;
    onConvertToMarkItDown: () => void;
    onOrganizeLinks: () => void;
    onRewriteNote: () => void;
    onFixSchema: () => void;
    setQuickAction: (v: string) => void;
  }
) {
  const { setQuickAction, ...cbs } = opts;
  switch (value) {
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
    default:
      break;
  }
  // Reset dropdown to default label after firing
  setQuickAction("quick-actions");
}

export function WorkflowPicker({
  value,
  onChange,
  onConvertToRaw,
  onConvertToPdf,
  onConvertToMarkItDown,
  onOrganizeLinks,
  onRewriteNote,
  onFixSchema,
}: Props) {
  const setQuickAction = onChange;

  return (
    <MiniSelect
      value={value}
      icon={<Wand2 size={9} />}
      onChange={(v) =>
        handleChange(v, {
          onConvertToRaw,
          onConvertToPdf,
          onConvertToMarkItDown,
          onOrganizeLinks,
          onRewriteNote,
          onFixSchema,
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
        { value: "section-process", label: "Edit", type: "section" },
        { value: "rewrite-note", label: "Rewrite Note", description: "replace with a clearer version" },
        { value: "fix-schema", label: "Fix Schema", description: "repair current frontmatter" },
        { value: "organize-links", label: "Note Links", description: "review Related Notes candidates" },
        { value: "section-capture", label: "Capture", type: "section" },
        { value: "convert-to-raw", label: "WeChat Raw", description: "WeChat URL → raw note" },
        { value: "convert-to-pdf", label: "PDF Raw", description: "vault PDF → raw note" },
        { value: "convert-to-markitdown", label: "MarkItDown", description: "DOCX/PPT/XLSX/HTML → raw note" },
      ]}
    />
  );
}
