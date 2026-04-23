schemas:
  raw_schema:
    required_frontmatter:
      - type
      - status
      - date
      - tags
      - source
      - domain
      - workflow
    fixed_values:
      type: raw
      status: draft
    optional_frontmatter:
      - title
    body_sections:
      - Source
      - Original Content

  general_insight_schema:
    required_frontmatter:
      - type
      - status
      - date
      - tags
      - source
      - domain
      - workflow
    fixed_values:
      type: insight
      status: draft
      workflow: raw_to_insight
    optional_frontmatter:
      - topic
    body_sections:
      - Summary
      - Key Points
      - Notes
      - Related Notes

  openclaw_insight_schema:
    required_frontmatter:
      - type
      - status
      - date
      - tags
      - source
      - domain
      - workflow
    fixed_values:
      type: insight
      status: draft
      domain: openclaw
      workflow: raw_to_insight
    optional_frontmatter:
      - topic
      - component
      - tool
    body_sections:
      - Summary
      - Key Points
      - Practical Relevance
      - Potential Directions
      - Related Notes

  ai_insight_schema:
    required_frontmatter:
      - type
      - status
      - date
      - tags
      - source
      - domain
      - workflow
    fixed_values:
      type: insight
      status: draft
      domain: ai
      workflow: raw_to_insight
    optional_frontmatter:
      - topic
      - model
      - technique
    body_sections:
      - Summary
      - Key Points
      - Practical Relevance
      - Potential Directions
      - Related Notes
