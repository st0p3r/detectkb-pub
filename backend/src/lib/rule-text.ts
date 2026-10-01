import { parseSigmaDocuments } from './sigma';

/** The query text of a rule: SPL, native query and the Sigma detection block (no titles, descriptions, references). */
export function queryText(r: { splQuery: string; nativeQuery: string | null; sigmaYaml: string | null }): string {
  const detection = r.sigmaYaml
    ? parseSigmaDocuments(r.sigmaYaml)
        .map(({ doc }) => JSON.stringify(doc?.detection ?? {}))
        .join('\n')
    : '';
  return [r.splQuery, r.nativeQuery ?? '', detection].join('\n');
}
