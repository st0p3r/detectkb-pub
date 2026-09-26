import React, { useRef, useState } from 'react';
import { Check, Copy, Download, WrapText } from 'lucide-react';
import { QUERY_LANGUAGE_LABELS, SOURCE_FORMAT_LABELS, saveBlob, type DetectionRuleData } from '@/lib/api';
import { SigmaPanel } from '@/features/sigma/SigmaPanel';

const TAB_KEY = 'detectkb.ruleQueryTab';
const SOURCE_EXT: Record<string, string> = { sigma: 'yml', escu: 'yml', elastic: 'toml', sentinel: 'yaml' };

interface Tab {
  id: string;
  label: string;
  /** Text to copy/download; the Sigma tab renders its own panel */
  text: string;
  fileName: string;
}

function readTab() {
  try {
    return localStorage.getItem(TAB_KEY);
  } catch {
    return null;
  }
}

function CodeView({ tab, wrap }: { tab: Tab; wrap: boolean }) {
  return (
    <pre
      className={`bg-zinc-900 text-zinc-100 px-4 py-3 text-xs font-mono leading-relaxed max-h-[32rem] overflow-auto ${
        wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
      }`}
    >
      {tab.text}
    </pre>
  );
}

/**
 * The rule's queries side by side: SPL, the native query of an imported rule
 * (KQL, EQL, ES|QL…), the Sigma source with conversions, and the original
 * imported file — each one click to copy or download.
 */
export function RuleQueryTabs({ rule, slug }: { rule: DetectionRuleData; slug: string }) {
  const tabs: Tab[] = [];
  if (rule.splQuery?.trim()) tabs.push({ id: 'spl', label: 'SPL', text: rule.splQuery, fileName: `${slug}.spl` });
  if (rule.nativeQuery?.trim()) {
    const lang = rule.nativeLanguage ?? 'query';
    tabs.push({ id: `native`, label: QUERY_LANGUAGE_LABELS[lang] ?? lang, text: rule.nativeQuery, fileName: `${slug}.${lang}` });
  }
  if (rule.sigmaYaml?.trim()) tabs.push({ id: 'sigma', label: 'Sigma', text: rule.sigmaYaml, fileName: `${slug}.yml` });
  // A Sigma import's original file is the Sigma tab already
  if (rule.sourceFormat && rule.sourceContent?.trim() && rule.sourceContent.trim() !== rule.sigmaYaml?.trim()) {
    tabs.push({
      id: 'source',
      label: `Original ${SOURCE_FORMAT_LABELS[rule.sourceFormat]}`,
      text: rule.sourceContent,
      fileName: `${slug}.${SOURCE_EXT[rule.sourceFormat] ?? 'txt'}`,
    });
  }

  // Remember the last tab picked, so browsing rules keeps showing e.g. KQL
  const [picked, setPicked] = useState(readTab);
  const [wrap, setWrap] = useState(true);
  const [copied, setCopied] = useState(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  if (!tabs.length) return null;
  const active = tabs.find((t) => t.id === picked) ?? tabs[0];
  const activeIndex = tabs.indexOf(active);

  function select(id: string) {
    setPicked(id);
    setCopied(false);
    try {
      localStorage.setItem(TAB_KEY, id);
    } catch {
      /* private mode: just don't remember */
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = (activeIndex + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
    select(tabs[next].id);
    tabRefs.current[next]?.focus();
  }

  function copy() {
    navigator.clipboard.writeText(active.text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const lines = active.text.split('\n').length;
  const iconBtn =
    'flex items-center gap-1 px-2 py-1 rounded text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 outline-none';

  return (
    <div className="px-6 py-4 border-b border-border/60">
      <div className="rounded-lg overflow-hidden border border-zinc-800 bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-zinc-800/80 px-2">
          <div role="tablist" aria-label="Rule queries" className="flex" onKeyDown={onKeyDown}>
            {tabs.map((t, i) => (
              <button
                key={t.id}
                ref={(el) => (tabRefs.current[i] = el)}
                role="tab"
                id={`rule-tab-${t.id}`}
                aria-selected={t === active}
                aria-controls="rule-tabpanel"
                tabIndex={t === active ? 0 : -1}
                onClick={() => select(t.id)}
                className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors outline-none focus-visible:bg-zinc-700 ${
                  t === active ? 'border-primary text-white' : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {active.id !== 'sigma' && (
            <div className="flex items-center gap-1 py-1">
              <span className="text-[11px] text-zinc-500 mr-1 tabular-nums">
                {lines} line{lines === 1 ? '' : 's'}
              </span>
              <button onClick={() => setWrap((w) => !w)} aria-pressed={wrap} title="Wrap long lines" className={iconBtn}>
                <WrapText className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => saveBlob(active.text, active.fileName, 'text/plain')} title={`Download ${active.fileName}`} className={iconBtn}>
                <Download className="w-3.5 h-3.5" />
              </button>
              <button onClick={copy} aria-label={copied ? 'Copied' : `Copy ${active.label}`} className={`${iconBtn} bg-zinc-700`}>
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          )}
        </div>
        <div role="tabpanel" id="rule-tabpanel" aria-labelledby={`rule-tab-${active.id}`}>
          {active.id === 'sigma' ? (
            <div className="bg-card p-3">
              <SigmaPanel sigmaYaml={active.text} />
            </div>
          ) : (
            <CodeView tab={active} wrap={wrap} />
          )}
        </div>
      </div>
    </div>
  );
}
