/**
 * A URL/path-safe slug: lowercase ASCII letters, digits and hyphens only,
 * capped length, never empty. Used for the readable half of a society's
 * storage folder name — SAFE_ID (storage-path.service.ts) requires exactly
 * this charset, so accents are stripped rather than kept and non-ASCII
 * input (a name with no Latin letters at all) falls back to "society"
 * rather than producing an empty or invalid segment.
 */
export function slugify(input: string, maxLength = 40): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents: "Ångström" -> "Angstrom"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, ''); // slice() can leave a dangling hyphen mid-word

  return slug || 'society';
}
