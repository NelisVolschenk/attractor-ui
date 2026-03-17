/**
 * Extract the last meaningful LLM response from full turn history.
 *
 * response.md files contain the full backend output: tool calls, tool results,
 * intermediate messages, and the final response.  This function strips the
 * noise and returns only the last text section the user cares about.
 *
 * Strategy:
 *  1. Split on `---` separator lines OR `## Response` headers.
 *  2. Return the last non-empty section, trimmed.
 *  3. Fall back to the full trimmed content if no separator is found.
 */
export function extractLastResponse(content: string): string {
  if (!content) return content

  // Prepend a newline so that a separator at the very start of the string
  // is also matched (the split patterns all require a leading \n).
  const sections = ('\n' + content).split(/\n---+\n|\n## Response\n/)

  if (sections.length > 1) {
    // Return the last section, trimmed.
    // (If the last section is empty — e.g. content was just "---\n" — return "")
    const last = sections[sections.length - 1].trim()
    return last
  }

  // No separator found — return the full content trimmed
  return content.trim()
}
