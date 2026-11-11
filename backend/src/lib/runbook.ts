// The analyst's view of a rule: what fired, what to check, what is usually
// benign and what to do next. Triage and response steps are written on the
// rule; for imported rules without them, the investigation guide that came
// with the rule (Elastic's "note") is used.

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

/** The text before the first heading: what the rule is about. */
export function overview(md: string): string {
  const lines = md.split('\n');
  // Imports append what the rule is and where it came from ("**Author:** …",
  // "_Imported from Sigma…_"): that isn't what the alert means
  const end = lines.findIndex((l) => HEADING.test(l) || /^\*\*[^*]+:\*\*/.test(l.trim()) || /^[_*]Imported from /.test(l.trim()));
  return (end < 0 ? lines : lines.slice(0, end)).join('\n').trim();
}

/**
 * The body of the first heading whose title matches, up to the next heading
 * of the same or a higher level.
 */
export function section(md: string, title: RegExp): string | null {
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(HEADING);
    if (!m || !title.test(m[2])) continue;
    const level = m[1].length;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const h = lines[j].match(HEADING);
      if (h && h[1].length <= level) {
        end = j;
        break;
      }
    }
    const body = lines.slice(i + 1, end).join('\n').trim();
    return body || null;
  }
  return null;
}

export interface ImportedGuide {
  triage: string | null;
  response: string | null;
}

/**
 * Triage and response steps from an imported investigation guide in the page
 * body. Elastic guides have "Possible investigation steps" and "Response and
 * remediation"; a guide without those parts is used whole as triage.
 */
export function importedGuide(contentMd: string): ImportedGuide {
  const guide = section(contentMd, /^investigation guide$/i);
  if (!guide) return { triage: null, response: null };
  const triage = section(guide, /investigation steps|triage steps|how to investigate/i);
  const response = section(guide, /response and remediation|^response$|remediation/i);
  if (triage || response) return { triage, response };
  // No recognisable parts: drop the false-positive part (shown on its own) and keep the rest
  const fp = section(guide, /false positive/i);
  const rest = (fp ? guide.replace(fp, '').replace(/^#{1,6}\s+false positive.*$/im, '') : guide)
    // Elastic's wrapper heading says nothing
    .replace(/^#{1,6}\s+triage and analysis\s*$/im, '');
  return { triage: rest.trim() || null, response: null };
}

/** Days between reviews when "Mark reviewed" doesn't say otherwise (REVIEW_INTERVAL_DAYS). */
export const REVIEW_INTERVAL_DAYS = Math.min(Math.max(Number(process.env.REVIEW_INTERVAL_DAYS) || 180, 1), 3650);

export function nextReviewDate(from = new Date(), days = REVIEW_INTERVAL_DAYS): Date {
  return new Date(from.getTime() + days * 86400000);
}
