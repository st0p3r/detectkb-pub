import { syncAllSysmonLinks, syncAutoSysmonLinks } from './sysmon-links';
import { syncAllLogLinks, syncLogLinks } from './log-links';
import { syncAllRuleStories, syncRuleStories } from './stories';
import { syncAllRuleTechniques, syncRuleTechniques } from './rule-techniques';

// Links derived from a page's content: Sysmon events, other log events,
// ATT&CK technique rows and (ESCU rules) analytic stories. Recomputed whenever
// a page is saved or imported.

export async function syncDerivedLinks(pageId: number): Promise<void> {
  await syncAutoSysmonLinks(pageId);
  await syncLogLinks(pageId);
  await syncRuleTechniques(pageId);
  await syncRuleStories(pageId);
}

/** Every page (at startup and after a restore). */
export async function syncAllDerivedLinks(): Promise<void> {
  await syncAllSysmonLinks();
  const logs = await syncAllLogLinks();
  const techniques = await syncAllRuleTechniques();
  const stories = await syncAllRuleStories();
  if (logs.added || logs.removed || techniques.added || techniques.removed || stories.added || stories.removed) {
    console.log(
      `[links] log events +${logs.added}/-${logs.removed}, ATT&CK techniques +${techniques.added}/-${techniques.removed}, analytic stories +${stories.added}/-${stories.removed}`
    );
  }
}
