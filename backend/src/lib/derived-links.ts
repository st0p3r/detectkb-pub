import { syncAllSysmonLinks, syncAutoSysmonLinks } from './sysmon-links';
import { syncAllLogLinks, syncLogLinks } from './log-links';
import { syncAllRuleStories, syncRuleStories } from './stories';

// Links derived from a page's content: Sysmon events, other log events and
// (ESCU rules) analytic stories. Recomputed whenever a page is saved or imported.

export async function syncDerivedLinks(pageId: number): Promise<void> {
  await syncAutoSysmonLinks(pageId);
  await syncLogLinks(pageId);
  await syncRuleStories(pageId);
}

/** Every page (at startup and after a restore). */
export async function syncAllDerivedLinks(): Promise<void> {
  await syncAllSysmonLinks();
  const logs = await syncAllLogLinks();
  const stories = await syncAllRuleStories();
  if (logs.added || logs.removed || stories.added || stories.removed) {
    console.log(`[links] log events +${logs.added}/-${logs.removed}, analytic stories +${stories.added}/-${stories.removed}`);
  }
}
