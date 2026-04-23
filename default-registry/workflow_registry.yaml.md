workflows:
  wechat_to_raw:
    input_types:
      - wechat_url
    output_type: raw
    schema: raw_schema
    prompt: wechat_to_raw_prompt
    path_key: raw_wechat
    executor_action: create_new_note
    filename_strategy: source_based
    backend_mode: local_script
    backend_skill: wechat-to-obsidian

  markitdown_to_raw:
    input_types:
      - vault_file
    output_type: raw
    schema: raw_schema
    prompt: markitdown_to_raw_prompt
    path_key: raw_markitdown
    executor_action: create_new_note
    filename_strategy: source_based
    backend_mode: local_script
    backend_skill: markitdown

  raw_to_insight:
    input_types:
      - raw_note
    output_type: insight
    executor_action: create_new_note
    filename_strategy: frontmatter_title
    domain_mapping:
      openclaw:
        schema: openclaw_insight_schema
        prompt: openclaw_raw_to_insight_prompt
        path_key: insight_openclaw
      ai:
        schema: ai_insight_schema
        prompt: ai_raw_to_insight_prompt
        path_key: insight_ai
      general:
        schema: general_insight_schema
        prompt: general_raw_to_insight_prompt
        path_key: insight_general

  rewrite_current_note:
    input_types:
      - current_note
    output_type: updated_note
    prompt: rewrite_note_prompt
    executor_action: replace_current_note
    filename_strategy: keep_current
    schema_mode: preserve_current

  fix_frontmatter:
    input_types:
      - current_note
    output_type: updated_note
    prompt: fix_frontmatter_prompt
    executor_action: replace_current_note
    filename_strategy: keep_current
    schema_mode: repair_current
