import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import MDEditor from '@uiw/react-md-editor';
import {
  getPage,
  createPage,
  updatePage,
  listPages,
  listCategories,
  upsertSplCommand,
  updateSplCommand,
  upsertRule,
  updateRule,
  type Page,
  type PageType,
  type SplCommandData,
  type DetectionRuleData,
  type Category,
  setPageSysmonLinks,
  apiErrorMessage,
} from '@/lib/api';
import { SplCommandForm } from '@/features/spl/SplCommandForm';
import { RuleForm } from '@/features/rules/RuleForm';
import { SysmonEventPicker } from '@/features/sysmon/SysmonEventPicker';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { usePageTypes } from '@/context/PageTypesContext';

interface AutocompleteState {
  open: boolean;
  query: string;
  /** caret position (start of [[ in the text) */
  triggerPos: number;
}

const CLOSED_AUTOCOMPLETE: AutocompleteState = { open: false, query: '', triggerPos: -1 };

const DEFAULT_RULE_DATA: Partial<DetectionRuleData> = {
  status: 'draft',
  severity: 'medium',
  splQuery: '',
  mitreTactics: '',
  mitreTechniques: '',
  dataSource: '',
  falsePositives: '',
  references: '',
  testNotes: '',
};

export function PageEditorPage() {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const isEdit = Boolean(slug);
  const { types: pageTypeOptions } = usePageTypes();

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState<Page | null>(null);

  const [title, setTitle] = useState('');
  const [type, setType] = useState<PageType>(
    () => (searchParams.get('type') as PageType) || 'NOTE'
  );
  const [tags, setTags] = useState('');
  const [isPinned, setIsPinned] = useState(false);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [contentMd, setContentMd] = useState('');

  // SPL Command extra fields
  const [splData, setSplData] = useState<Partial<SplCommandData>>({});

  // Detection Rule extra fields
  const [ruleData, setRuleData] = useState<Partial<DetectionRuleData>>(DEFAULT_RULE_DATA);

  // Sysmon events (manual selection; auto links come from the server)
  const [manualSysmon, setManualSysmon] = useState<number[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  // A new page created by a save whose later steps failed: retry by updating it
  const createdPageRef = useRef<Page | null>(null);

  // All page titles for autocomplete
  const [allPageTitles, setAllPageTitles] = useState<{ title: string; slug: string }[]>([]);
  const [autocomplete, setAutocomplete] = useState<AutocompleteState>(CLOSED_AUTOCOMPLETE);
  const [activeIndex, setActiveIndex] = useState(0);

  const editorWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listPages().then((pages) =>
      setAllPageTitles(pages.map((p) => ({ title: p.title, slug: p.slug })))
    );
    listCategories().then(setCategories).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isEdit || !slug) return;
    setLoading(true);
    getPage(slug)
      .then((p) => {
        setPage(p);
        setTitle(p.title);
        setType(p.type);
        setTags(p.tags.map(({ tag }) => tag.name).join(', '));
        setIsPinned(p.isPinned);
        setCategoryId(p.category?.id ?? null);
        setContentMd(p.contentMd);
        setManualSysmon(
          (p.sysmonEvents ?? []).filter((l) => l.source === 'manual').map((l) => l.sysmonEvent.eventId)
        );
        if (p.splCommand) {
          setSplData({
            id: p.splCommand.id,
            pageId: p.splCommand.pageId,
            command: p.splCommand.command,
            group: p.splCommand.group,
            syntax: p.splCommand.syntax,
            description: p.splCommand.description,
            examples: p.splCommand.examples,
            pitfalls: p.splCommand.pitfalls ?? '',
            isFavorite: p.splCommand.isFavorite,
          });
        }
        if (p.rule) {
          setRuleData({
            id: p.rule.id,
            pageId: p.rule.pageId,
            status: p.rule.status ?? 'draft',
            severity: p.rule.severity ?? 'medium',
            splQuery: p.rule.splQuery ?? '',
            mitreTactics: p.rule.mitreTactics ?? '',
            mitreTechniques: p.rule.mitreTechniques ?? '',
            dataSource: p.rule.dataSource ?? '',
            falsePositives: p.rule.falsePositives ?? '',
            references: p.rule.references ?? '',
            testNotes: p.rule.testNotes ?? '',
            sigmaYaml: p.rule.sigmaYaml ?? '',
            nativeQuery: p.rule.nativeQuery ?? '',
            nativeLanguage: p.rule.nativeLanguage ?? '',
            sourceFormat: p.rule.sourceFormat ?? null,
            sourceId: p.rule.sourceId ?? null,
          });
        }
      })
      .finally(() => setLoading(false));
  }, [slug, isEdit]);

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const tagNames = tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const payload = { title: title.trim(), type, isPinned, categoryId, contentMd, tagNames };

      let savedPage: Page;
      const existingPage = isEdit && page ? page : createdPageRef.current;
      if (existingPage) {
        savedPage = await updatePage(existingPage.id, payload);
      } else {
        savedPage = await createPage(payload);
        createdPageRef.current = savedPage;
      }

      // Save SPL Command data if type is SPL_COMMAND
      if (type === 'SPL_COMMAND' && splData.command) {
        const splPayload = {
          pageId: savedPage.id,
          command: splData.command ?? '',
          group: splData.group ?? 'Other',
          syntax: splData.syntax ?? '',
          description: splData.description ?? '',
          examples: splData.examples ?? '',
          pitfalls: splData.pitfalls,
          isFavorite: splData.isFavorite ?? false,
        };

        if (splData.id) {
          await updateSplCommand(splData.id, splPayload);
        } else {
          await upsertSplCommand(splPayload);
        }
      }

      // Save Detection Rule data if type is RULE
      if (type === 'RULE') {
        const rulePayload: Omit<DetectionRuleData, 'id'> = {
          pageId: savedPage.id,
          status: ruleData.status ?? 'draft',
          severity: ruleData.severity ?? 'medium',
          splQuery: ruleData.splQuery ?? '',
          mitreTactics: ruleData.mitreTactics || undefined,
          mitreTechniques: ruleData.mitreTechniques || undefined,
          dataSource: ruleData.dataSource || undefined,
          falsePositives: ruleData.falsePositives || undefined,
          references: ruleData.references || undefined,
          testNotes: ruleData.testNotes || undefined,
          sigmaYaml: ruleData.sigmaYaml ?? null,
          nativeQuery: ruleData.nativeQuery ?? null,
          nativeLanguage: ruleData.nativeLanguage ?? null,
        };
        if (ruleData.id) {
          await updateRule(ruleData.id, rulePayload);
        } else {
          await upsertRule(rulePayload);
        }
      }

      const hadSysmonLinks = (page?.sysmonEvents ?? []).some((l) => l.source === 'manual');
      if ((type === 'RULE' || type === 'DATA_SOURCE') && (manualSysmon.length || hadSysmonLinks)) {
        await setPageSysmonLinks(savedPage.id, manualSysmon);
      }

      navigate(`/pages/${savedPage.slug}`);
    } catch (err) {
      setSaveError(apiErrorMessage(err, 'Could not save the page'));
    } finally {
      setSaving(false);
    }
  }

  // Detect [[...]] trigger in editor textarea
  const handleEditorKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Close on Escape
      if (e.key === 'Escape') {
        setAutocomplete(CLOSED_AUTOCOMPLETE);
        return;
      }

      const textarea = (e.currentTarget as HTMLDivElement).querySelector('textarea');
      if (!textarea) return;

      const pos = textarea.selectionStart ?? 0;
      const text = textarea.value;

      // Look backwards from cursor for [[...
      const before = text.slice(0, pos);
      const triggerMatch = before.match(/\[\[([^\]\n]*)$/);
      if (triggerMatch) {
        const query = triggerMatch[1];
        const triggerPos = pos - query.length - 2; // position of [[
        setAutocomplete({ open: true, query, triggerPos });
        setActiveIndex(0);
      } else {
        setAutocomplete(CLOSED_AUTOCOMPLETE);
      }
    },
    []
  );

  // Intercept arrow keys and Enter when autocomplete is open
  function handleEditorKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
      if (!autocomplete.open) return;

      const filtered = allPageTitles.filter((p) =>
        p.title.toLowerCase().includes(autocomplete.query.toLowerCase())
      );

      if (filtered.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % filtered.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertSuggestion(filtered[activeIndex].title);
      }
  }

  function insertSuggestion(pageTitle: string) {
    const textarea = editorWrapRef.current?.querySelector('textarea');
    if (!textarea) return;

    const text = textarea.value;
    const pos = textarea.selectionStart ?? 0;
    // Replace from triggerPos to current cursor with [[pageTitle]]
    const before = text.slice(0, autocomplete.triggerPos);
    const after = text.slice(pos);
    const insertion = `[[${pageTitle}]]`;
    const newText = before + insertion + after;
    const newCursor = before.length + insertion.length;

    // Update React state
    setContentMd(newText);
    setAutocomplete(CLOSED_AUTOCOMPLETE);

    // Restore cursor after React re-render
    setTimeout(() => {
      const ta = editorWrapRef.current?.querySelector('textarea');
      if (ta) {
        ta.selectionStart = newCursor;
        ta.selectionEnd = newCursor;
        ta.focus();
      }
    }, 0);
  }

  const filteredSuggestions = autocomplete.open
    ? allPageTitles
        .filter((p) => p.title.toLowerCase().includes(autocomplete.query.toLowerCase()))
        .slice(0, 10)
    : [];

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="text-center py-20 text-muted-foreground text-sm">Loading...</div>
      </div>
    );
  }

  const breadcrumbItems = isEdit && page
    ? [{ label: 'Pages', to: '/pages' }, { label: `Edit: ${page.title}` }]
    : [{ label: 'Pages', to: '/pages' }, { label: 'New Page' }];

  return (
    <div className="max-w-4xl mx-auto">
      <Breadcrumbs items={breadcrumbItems} />
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          {isEdit ? 'Edit Page' : 'New Page'}
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(isEdit && page ? `/pages/${page.slug}` : '/pages')}
            className="px-4 py-2 rounded-md border border-border text-sm font-medium hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !title.trim()}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {saveError && (
        <div role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {saveError}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1.5">
            Title <span className="text-destructive">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Page title"
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-sm font-medium mb-1.5">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as PageType)}
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {pageTypeOptions.map((opt) => (
                <option key={opt.name} value={opt.name}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 min-w-[180px]">
            <label className="block text-sm font-medium mb-1.5">Category</label>
            <select
              value={categoryId ?? ''}
              onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="">— None —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="flex-1 min-w-[220px]">
            <label className="block text-sm font-medium mb-1.5">Tags (comma-separated)</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="e.g. splunk, alert, windows"
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm font-medium cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isPinned}
                onChange={(e) => setIsPinned(e.target.checked)}
                className="w-4 h-4 rounded border-border"
              />
              Pinned
            </label>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5">
            Content
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              Type <code className="bg-muted px-1 py-0.5 rounded text-xs">[[Page Title]]</code> to link pages
            </span>
          </label>
          {/* Wrapper catches key events from the editor textarea */}
          <div
            ref={editorWrapRef}
            className="relative"
            onKeyUp={handleEditorKeyUp}
            onKeyDown={handleEditorKeyDown}
          >
            <div data-color-mode="auto">
              <MDEditor
                value={contentMd}
                onChange={(val) => setContentMd(val ?? '')}
                height={480}
                preview="live"
              />
            </div>

            {/* Autocomplete dropdown */}
            {autocomplete.open && filteredSuggestions.length > 0 && (
              <div className="absolute z-50 mt-1 w-72 rounded-md border border-border bg-popover shadow-lg overflow-hidden"
                style={{ bottom: 'auto', left: '1rem', top: '50%' }}
              >
                <div className="px-3 py-1.5 border-b border-border text-xs text-muted-foreground bg-muted/50">
                  Wiki link — select a page
                </div>
                <ul className="max-h-52 overflow-y-auto">
                  {filteredSuggestions.map((p, i) => (
                    <li key={p.slug}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault(); // prevent textarea blur
                          insertSuggestion(p.title);
                        }}
                        className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                          i === activeIndex
                            ? 'bg-primary/10 text-primary'
                            : 'hover:bg-accent text-foreground'
                        }`}
                      >
                        {p.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* SPL Command extra fields */}
        {type === 'SPL_COMMAND' && (
          <SplCommandForm value={splData} onChange={setSplData} />
        )}

        {/* Detection Rule Form */}
        {type === 'RULE' && (
          <RuleForm value={ruleData} onChange={setRuleData} />
        )}

        {(type === 'RULE' || type === 'DATA_SOURCE') && (
          <SysmonEventPicker
            selected={manualSysmon}
            onChange={setManualSysmon}
            autoLinks={page?.sysmonEvents ?? []}
          />
        )}
      </div>
    </div>
  );
}
