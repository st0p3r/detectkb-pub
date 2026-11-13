import { parseSigmaDocuments } from './sigma';

// The fields a rule's detection reads ("ParentCommandLine", "process.name",
// "Processes.process_name"), taken from its Sigma detection, its SPL and its
// native query (KQL, EQL, ES|QL, Lucene). A rule whose event is collected
// still sees nothing when the field it filters on isn't in the event — the
// most common reason a deployed rule never fires.
//
// This is text analysis, not a parser for each language: it finds the fields
// a query compares or filters, and leaves out the ones it creates itself.

export type FieldSource = 'sigma' | 'spl' | 'native';

export interface RuleFieldRef {
  field: string;
  source: FieldSource;
}

const FIELD = '[A-Za-z_][\\w.]*(?:\\{\\})?';

// Not event fields: where to search and how, or what the event is (covered by the telemetry links)
const SPL_NOT_FIELDS = new Set([
  'index', 'sourcetype', 'source', 'host', 'eventtype', 'tag', 'splunk_server', 'earliest', 'latest', 'span', 'limit', 'maxsearches', 'summariesonly',
  'allow_old_summaries', 'prestats', 'local', 'append', 'fillnull_value', 'datamodel', 'nodename', 'eventcode', 'eventid', 'event_id', 'count', 'true', 'false',
  'usenull', 'useother', 'keepempty', 'consecutive', 'mode', 'type', 'field', 'max_match', 'delim', 'output', 'outputnew', 'as', 'by', 'and', 'or', 'not', 'in', 'like',
]);
const NATIVE_NOT_FIELDS = new Set([
  'and', 'or', 'not', 'in', 'where', 'by', 'on', 'with', 'like', 'true', 'false', 'null', 'let', 'extend', 'project', 'summarize', 'join', 'kind', 'sequence', 'until',
  'maxspan', 'runs', 'any', 'case', 'iff', 'iif', 'ago', 'now', 'bin', 'count', 'dcount', 'min', 'max', 'sum', 'avg', 'from', 'metadata', 'keep', 'stats', 'eval',
  'eventid', 'event.code', 'timegenerated', 'timestamp', '@timestamp', 'type', 'http', 'https',
]);

/** Text without string literals, so their content is never taken for a field. */
function withoutStrings(text: string): string {
  return text.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

function unique(fields: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of fields) {
    const name = f.replace(/\{\}$/, '');
    const key = name.toLowerCase();
    if (name.length < 2 || name.length > 120 || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Field names in a Sigma detection: the keys of its selections, without modifiers ("Image|endswith" → "Image"). */
export function sigmaDetectionFields(detection: unknown): string[] {
  if (!detection || typeof detection !== 'object' || Array.isArray(detection)) return [];
  const out: string[] = [];
  const fromSelection = (sel: unknown) => {
    // A list is either alternatives (maps) or keywords (strings: no field)
    if (Array.isArray(sel)) return sel.forEach(fromSelection);
    if (!sel || typeof sel !== 'object') return;
    for (const key of Object.keys(sel)) {
      const name = key.split('|')[0].trim();
      if (name) out.push(name);
    }
  };
  for (const [name, sel] of Object.entries(detection as Record<string, unknown>)) {
    if (name === 'condition' || name === 'timeframe') continue;
    fromSelection(sel);
  }
  return unique(out.filter((f) => !/^(eventid|event_id|eventcode)$/i.test(f)));
}

/**
 * Fields an SPL search filters on: comparisons in the base search and in
 * `search` / `where` / `regex` / `tstats … where` stages, and the arguments
 * of like() / match(). Fields the search makes itself (eval, rex, stats … as)
 * are not required from the event.
 */
export function splFields(spl: string | null | undefined): string[] {
  if (!spl?.trim()) return [];
  const text = withoutStrings(spl.replace(/```[\s\S]*?```/g, ' ')).replace(/`[^`]*`/g, ' ');
  const stages = text.split('|').map((s) => s.trim());
  const made = new Set<string>();
  const out: string[] = [];
  const add = (f: string) => {
    const key = f.toLowerCase();
    if (!SPL_NOT_FIELDS.has(key) && !made.has(key) && !/^\d/.test(f)) out.push(f);
  };
  stages.forEach((stage, i) => {
    const command = i === 0 && !/^(tstats|from|inputlookup|search)\b/i.test(stage) ? 'search' : (stage.match(/^[a-z_]+/i)?.[0] ?? '').toLowerCase();
    if (command === 'eval' || command === 'rex' || command === 'rename' || command === 'lookup') {
      // What this stage creates is not needed from the event
      for (const m of stage.matchAll(new RegExp(`(${FIELD})\\s*=(?!=)`, 'g'))) made.add(m[1].toLowerCase());
      for (const m of stage.matchAll(new RegExp(`\\bas\\s+(${FIELD})`, 'gi'))) made.add(m[1].toLowerCase());
      for (const m of stage.matchAll(/\(\?<([A-Za-z_]\w*)>/g)) made.add(m[1].toLowerCase());
      if (command !== 'eval') return;
    }
    if (/^(stats|eventstats|streamstats|timechart|chart|top|rare)$/.test(command)) {
      for (const m of stage.matchAll(new RegExp(`\\bas\\s+(${FIELD})`, 'gi'))) made.add(m[1].toLowerCase());
      return;
    }
    const filter = command === 'tstats' ? stage.slice(Math.max(stage.search(/\bwhere\b/i), 0)).replace(/\bby\b[\s\S]*$/i, '') : stage;
    if (!['search', 'where', 'regex', 'tstats', 'eval'].includes(command)) return;
    if (command !== 'eval') {
      for (const m of filter.matchAll(new RegExp(`(${FIELD})\\s*(?:!=|>=|<=|=|<|>)`, 'g'))) add(m[1]);
      for (const m of filter.matchAll(new RegExp(`(${FIELD})\\s+IN\\s*\\(`, 'gi'))) add(m[1]);
    }
    for (const m of filter.matchAll(new RegExp(`\\b(?:like|match|searchmatch|cidrmatch|isnotnull|isnull|len|lower|upper)\\s*\\(\\s*(?:""\\s*,\\s*)?(${FIELD})`, 'gi'))) add(m[1]);
  });
  return unique(out);
}

/** Fields a KQL / EQL / ES|QL / Lucene query compares. */
export function nativeQueryFields(query: string | null | undefined): string[] {
  if (!query?.trim()) return [];
  const text = withoutStrings(query.replace(/\/\/[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' '));
  const out: string[] = [];
  const ops = '==|=~|!=|!~|:|>=|<=|>|<|\\b(?:has_any|has_all|has_cs|has|contains_cs|contains|startswith|endswith|matches\\s+regex|in~|in|like|rlike|regex)\\b';
  for (const m of text.matchAll(new RegExp(`(${FIELD})\\s*(?:!\\s*)?(?:${ops})`, 'gi'))) {
    const f = m[1];
    // "process where …" (EQL event category) and "x = …" assignments don't reach here; keywords do
    if (NATIVE_NOT_FIELDS.has(f.toLowerCase()) || /^\d/.test(f)) continue;
    out.push(f);
  }
  return unique(out);
}

/** Every field a rule's detection reads, each once, with where it was found (Sigma first). */
export function ruleFieldRefs(rule: { sigmaYaml: string | null; splQuery: string | null; nativeQuery: string | null }): RuleFieldRef[] {
  const refs: RuleFieldRef[] = [];
  const seen = new Set<string>();
  const add = (fields: string[], source: FieldSource) => {
    for (const field of fields) {
      const key = field.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push({ field, source });
    }
  };
  if (rule.sigmaYaml) {
    for (const { doc } of parseSigmaDocuments(rule.sigmaYaml)) add(sigmaDetectionFields(doc?.detection), 'sigma');
  }
  add(splFields(rule.splQuery), 'spl');
  add(nativeQueryFields(rule.nativeQuery), 'native');
  return refs;
}

/** The key under which a field's availability is stored with the collection answers. */
export const fieldKey = (field: string) => `field:${field.toLowerCase()}`;
