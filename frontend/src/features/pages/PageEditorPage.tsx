import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import MDEditor from '@uiw/react-md-editor';
import rehypeSanitize from 'rehype-sanitize';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  getPage,
  savePage,
  saveConflict,
  searchPageTitles,
  listCategories,
  type SaveConflict,
  type Page,
  type PageType,
  type SplCommandData,
  type DetectionRuleData,
  type Category,
  apiErrorMessage,
} from '@/lib/api';
import { SplCommandForm } from '@/features/spl/SplCommandForm';
import { RuleForm } from '@/features/rules/RuleForm';
import { SysmonEventPicker } from '@/features/sysmon/SysmonEventPicker';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { usePageTypes } from '@/context/PageTypesContext';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { relativeTime } from '@/lib/time';

/** Everything the form holds, as saved in a draft and compared to tell whether there are changes. */
interface FormState {
  title: string;
  type: PageType;
  tags: string;
  isPinned: boolean;
  categoryId: number | null;
  contentMd: string;
  splData: Partial<SplCommandData>;
  ruleData: Partial<DetectionRuleData>;
  manualSysmon: number[];
}

interface Draft {
  savedAt: number;
  /** updatedAt of the page the draft was started from (null: a new page) */
  baseUpdatedAt: string | null;
  form: FormState;
}

const draftKey = (slug: string | undefined) => `detectkb.draft:${slug ?? 'new'}`;

function readDraft(key: string): Draft | null {
  try {
    const d = JSON.parse(localStorage.getItem(key) || 'null');
    return d && typeof d === 'object' && d.form && typeof d.form.title === 'string' ? (d as Draft) : null;
  } catch {
    return null;
  }
}

function writeDraft(key: string, draft: Draft | null) {
  try {
    if (draft) localStorage.setItem(key, JSON.stringify(draft));
    else localStorage.removeItem(key);
  } catch {
    // storage full or blocked: there is no draft, the leave warning still protects the edit
  }
}

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
  // Someone else saved the page while it was being edited here
  const [conflict, setConflict] = useState<SaveConflict | null>(null);

  // Unsaved changes: the form as it is now against the form as loaded / last saved
  const form: FormState = { title, type, tags, isPinned, categoryId, contentMd, splData, ruleData, manualSysmon };
  const formJson = JSON.stringify(form);
  const [baseline, setBaseline] = useState<string | null>(isEdit ? null : formJson);
  const dirty = baseline !== null && formJson !== baseline;
  const key = draftKey(slug);
  // A draft left behind by an earlier visit (closed tab, expired session, crash)
  const [foundDraft, setFoundDraft] = useState<Draft | null>(null);
  // Set while saving succeeded and the editor is being left on purpose
  const leaving = useRef(false);

  function applyForm(f: FormState) {
    setTitle(f.title);
    setType(f.type);
    setTags(f.tags);
    setIsPinned(f.isPinned);
    setCategoryId(f.categoryId);
    setContentMd(f.contentMd);
    setSplData(f.splData);
    setRuleData(f.ruleData);
    setManualSysmon(f.manualSysmon);
  }

  // The baseline is taken once the loaded page is in the form (new pages: at once)
  const loadedRef = useRef(!isEdit);
  useEffect(() => {
    if (loading || loadedRef.current) return;
    loadedRef.current = true;
    setBaseline(formJson);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when loading ends
  }, [loading]);
  useEffect(() => {
    if (baseline === null) return;
    const d = readDraft(key);
    if (d && JSON.stringify(d.form) !== baseline) setFoundDraft(d);
    else if (d) writeDraft(key, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the baseline exists
  }, [baseline === null]);

  // Keep a draft on this device while there are changes
  useEffect(() => {
    if (!dirty || foundDraft) return;
    const t = window.setTimeout(() => writeDraft(key, { savedAt: Date.now(), baseUpdatedAt: page?.updatedAt ?? null, form: JSON.parse(formJson) }), 800);
    return () => window.clearTimeout(t);
  }, [dirty, formJson, key, page?.updatedAt, foundDraft]);

  // Closing the tab or reloading with changes: the browser asks first
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Following a link inside the app with changes: ask first
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname);

  useDocumentTitle(isEdit ? (page ? `${dirty ? '● ' : ''}Edit: ${page.title}` : null) : `${dirty ? '● ' : ''}New page`);

  // All page titles for autocomplete
  const [autocomplete, setAutocomplete] = useState<AutocompleteState>(CLOSED_AUTOCOMPLETE);
  const [activeIndex, setActiveIndex] = useState(0);

  const editorWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
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
            triage: p.rule.triage ?? '',
            response: p.rule.response ?? '',
            ownerId: p.rule.ownerId ?? null,
            nextReviewAt: p.rule.nextReviewAt ?? null,
          });
        }
      })
      .finally(() => setLoading(false));
  }, [slug, isEdit]);

  async function handleSave(force = false) {
    if (!title.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const tagNames = tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const hadSysmonLinks = (page?.sysmonEvents ?? []).some((l) => l.source === 'manual');

      // The page, its rule or SPL command and its Sysmon links are saved together: all of it, or nothing
      const saved = await savePage(page?.id ?? null, {
        title: title.trim(),
        type,
        isPinned,
        categoryId,
        contentMd,
        tagNames,
        ...(type === 'RULE' && {
          rule: {
            status: ruleData.status ?? 'draft',
            severity: ruleData.severity ?? 'medium',
            splQuery: ruleData.splQuery ?? '',
            mitreTactics: ruleData.mitreTactics ?? '',
            mitreTechniques: ruleData.mitreTechniques ?? '',
            dataSource: ruleData.dataSource ?? '',
            falsePositives: ruleData.falsePositives ?? '',
            references: ruleData.references ?? '',
            testNotes: ruleData.testNotes ?? '',
            sigmaYaml: ruleData.sigmaYaml ?? null,
            nativeQuery: ruleData.nativeQuery ?? null,
            nativeLanguage: ruleData.nativeLanguage ?? null,
            triage: ruleData.triage ?? null,
            response: ruleData.response ?? null,
            ownerId: ruleData.ownerId ?? null,
            nextReviewAt: ruleData.nextReviewAt ?? null,
          },
        }),
        ...(type === 'SPL_COMMAND' &&
          splData.command && {
            splCommand: {
              command: splData.command,
              group: splData.group ?? 'Other',
              syntax: splData.syntax ?? '',
              description: splData.description ?? '',
              examples: splData.examples ?? '',
              pitfalls: splData.pitfalls,
              isFavorite: splData.isFavorite ?? false,
            },
          }),
        ...((type === 'RULE' || type === 'DATA_SOURCE') && (manualSysmon.length || hadSysmonLinks) && { sysmonEventIds: manualSysmon }),
        ...(page && { expectedUpdatedAt: page.updatedAt, force }),
      });

      writeDraft(key, null);
      leaving.current = true;
      navigate(`/pages/${saved.slug}`);
    } catch (err) {
      const other = saveConflict(err);
      if (other) setConflict(other);
      else setSaveError(apiErrorMessage(err, 'Could not save the page — nothing was changed'));
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

  // [[ autocomplete: titles are looked up on the server as you type
  const { data: titleMatches = [] } = useQuery({
    queryKey: ['page-titles', autocomplete.query],
    queryFn: () => searchPageTitles(autocomplete.query),
    enabled: autocomplete.open,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const filteredSuggestions = autocomplete.open ? titleMatches.filter((p) => p.slug !== slug) : [];

  // Intercept arrow keys and Enter when autocomplete is open
  function handleEditorKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
      if (!autocomplete.open) return;

      const filtered = filteredSuggestions;

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
          {dirty && <span className="text-xs text-muted-foreground" title="Kept as a draft on this device until you save">Unsaved changes</span>}
          <button
            onClick={() => navigate(isEdit && page ? `/pages/${page.slug}` : '/pages')}
            className="px-4 py-2 rounded-md border border-border text-sm font-medium hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => handleSave()}
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

      {foundDraft && (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <span className="flex-1 min-w-[16rem]">
            You have unsaved changes to this page from {relativeTime(new Date(foundDraft.savedAt).toISOString())}, kept on this device.
            {page && foundDraft.baseUpdatedAt && foundDraft.baseUpdatedAt !== page.updatedAt && ' The page was saved by someone since then: review before saving.'}
          </span>
          <button
            onClick={() => {
              applyForm(foundDraft.form);
              setFoundDraft(null);
            }}
            className="px-3 py-1 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90"
          >
            Restore them
          </button>
          <button
            onClick={() => {
              writeDraft(key, null);
              setFoundDraft(null);
            }}
            className="px-3 py-1 rounded-md border border-border text-xs font-medium hover:bg-accent"
          >
            Discard
          </button>
        </div>
      )}

      {conflict && page && (
        <div role="alert" className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm space-y-2">
          <p>
            <b>{conflict.updatedBy ?? 'Someone'}</b> saved this page {conflict.updatedAt ? relativeTime(conflict.updatedAt) : 'just now'}, after you opened it.
            Saving now would replace their version with yours. Nothing was saved yet; your changes are still here.
          </p>
          <div className="flex flex-wrap gap-2">
            <a href={`/pages/${page.slug}`} target="_blank" rel="noreferrer" className="px-3 py-1 rounded-md border border-border bg-background text-xs font-medium hover:bg-accent">
              Open their version in a new tab
            </a>
            <button
              onClick={() => {
                setConflict(null);
                void handleSave(true);
              }}
              className="px-3 py-1 rounded-md bg-red-600 text-white text-xs font-medium hover:bg-red-700"
            >
              Save mine anyway
            </button>
            <button onClick={() => setConflict(null)} className="px-3 py-1 rounded-md border border-border text-xs font-medium hover:bg-accent">
              Keep editing
            </button>
          </div>
          <p className="text-xs text-muted-foreground">Their version stays in the page history either way.</p>
        </div>
      )}

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title="Leave without saving?"
        message="Your changes are not saved yet. They are kept as a draft on this device, and offered again when you come back to this page."
        confirmLabel="Leave"
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1.5">
            Title <span className="text-destructive">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            dir="auto"
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
                // Persian and other right-to-left text: each paragraph in its own direction
                textareaProps={{ dir: 'auto' }}
                preview="live"
                // The preview renders raw HTML; strip scripts, event handlers and javascript: links
                previewOptions={{ rehypePlugins: [[rehypeSanitize]] }}
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
