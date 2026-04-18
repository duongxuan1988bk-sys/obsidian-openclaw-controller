export const FIX_FRONTMATTER_DATE_RULES = [
  "Always preserve or add created as a YYYY-MM-DD date field.",
  "If created is missing and date exists, set created equal to date.",
  "If both date and created are missing, set both to today's YYYY-MM-DD date.",
  "Do not include a time component in date or created."
];
