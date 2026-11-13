import { syncAllSysmonLinks, syncAutoSysmonLinks } from './sysmon-links';
import { syncAllLogLinks, syncLogLinks } from './log-links';
import { syncAllRuleStories, syncRuleStories } from './stories';
import { syncAllRuleTechniques, syncRuleTechniques } from './rule-techniques';
import { syncAllRuleFields, syncRuleFields } from './rule-field-links';

// Links derived from a page's content: Sysmon events, other log events,
// ATT&CK technique rows, the fields a rule reads and (ESCU rules) analytic stories. Recomputed whenever
// a page is saved or imported.

export async function syncDerivedLinks(pageId: number): Promise<void> {
  await syncAutoSysmonLinks(pageId);
  await syncLogLinks(pageId);
  await syncRuleTechniques(pageId);
  await syncRuleStories(pageId);
  await syncRuleFields(pageId);
}

/** Every page (at startup and after a restore). */
export async function syncAllDerivedLinks(): Promise<void> {
  await syncAllSysmonLinks();
  const logs = await syncAllLogLinks();
  const techniques = await syncAllRuleTechniques();
  const stories = await syncAllRuleStories();
  const fields = await syncAllRuleFields();
  if (fields.added || fields.removed) console.log(`[links] rule fields +${fields.added}/-${fields.removed}`);
  if (logs.added || logs.removed || techniques.added || techniques.removed || stories.added || stories.removed) {
    console.log(
      `[links] log events +${logs.added}/-${logs.removed}, ATT&CK techniques +${techniques.added}/-${techniques.removed}, analytic stories +${stories.added}/-${stories.removed}`
    );
  }
}
