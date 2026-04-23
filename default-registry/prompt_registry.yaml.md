prompts:
  wechat_to_raw_prompt:
    workflows:
      - wechat_to_raw
    domain: general
    purpose: convert a WeChat URL into a raw Obsidian note using the local extraction script
    constraints:
      - preserve the original source content as much as possible
      - output a raw note only
      - do not add analysis beyond minimal structure
    output_style: raw_capture

  markitdown_to_raw_prompt:
    workflows:
      - markitdown_to_raw
    domain: general
    purpose: convert a local file into a raw Obsidian note using MarkItDown
    constraints:
      - preserve the extracted source content as much as possible
      - output a raw note only
      - do not add analysis beyond minimal structure
    output_style: raw_capture

  general_raw_to_insight_prompt:
    workflows:
      - raw_to_insight
    domain: general
    purpose: convert a raw note into a structured insight note
    constraints:
      - preserve the original meaning
      - remove obvious noise and improve clarity
      - extract reusable takeaways
      - rebuild frontmatter instead of inheriting source metadata
      - follow general_insight_schema
    output_style: concise_structured_general

  openclaw_raw_to_insight_prompt:
    workflows:
      - raw_to_insight
    domain: openclaw
    purpose: convert an OpenClaw raw note into a structured insight note
    constraints:
      - focus on reusable understanding of tools, workflows, architecture, or implementation logic
      - preserve core technical meaning
      - remove noise and improve clarity
      - rebuild frontmatter instead of inheriting source metadata
      - follow openclaw_insight_schema
    output_style: concise_structured_technical

  ai_raw_to_insight_prompt:
    workflows:
      - raw_to_insight
    domain: ai
    purpose: convert an AI raw note into a structured insight note
    constraints:
      - focus on reusable understanding of models, prompting, evaluation, retrieval, or system behavior
      - preserve core technical meaning
      - remove noise and improve clarity
      - rebuild frontmatter instead of inheriting source metadata
      - follow ai_insight_schema
    output_style: concise_structured_technical

  rewrite_note_prompt:
    purpose: rewrite the current note into a clearer, more structured version
    constraints:
      - preserve factual meaning
      - improve clarity and organization
      - do not invent unsupported details
    output_style: structured_rewrite

  fix_frontmatter_prompt:
    purpose: repair the current note so its frontmatter matches the target schema
    constraints:
      - focus on schema compliance
      - do not rewrite the body unless required for structural validity
      - preserve existing meaning
    output_style: schema_repair
