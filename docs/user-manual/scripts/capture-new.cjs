// Captures the screenshots of the features added after the first edition of
// the manual (81-… in img/), cropped to the page area and saved as JPEG, and
// records their sizes in img/sizes.json. Needs a running DetectKB with rules,
// some knowledge pages, collection answers and an admin account:
//   KB_URL=http://localhost:5173 KB_USER=admin KB_PASSWORD=... node scripts/capture-new.cjs
// Set KB_RULE to the slug of a rule with triage steps and a few saved versions.
const fs = require('fs');
const path = require('path');

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    const root = require('child_process').execSync('npm root -g').toString().trim();
    return require(path.join(root, 'playwright'));
  }
}

const B = process.env.KB_URL || 'http://localhost:5173';
const USER = process.env.KB_USER || 'admin';
const PASSWORD = process.env.KB_PASSWORD;
const RULE = process.env.KB_RULE || 'lsass-memory-access-by-unusual-process';
if (!PASSWORD) {
  console.error('Set KB_PASSWORD (and KB_USER / KB_URL / KB_RULE if needed)');
  process.exit(1);
}
const IMG = path.join(__dirname, '..', 'img');
const sizesFile = path.join(IMG, 'sizes.json');
const sizes = JSON.parse(fs.readFileSync(sizesFile, 'utf8'));
// The page without the sidebar (240 px) and the top bar (56 px)
const PAGE = { x: 240, y: 56, width: 1200, height: 844 };

(async () => {
  const { chromium } = loadPlaywright();
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  // KB_ONLY=91-history,94-search retakes just those
  const only = (process.env.KB_ONLY || '').split(',').filter(Boolean);
  const shot = async (name, fn, { clip = PAGE, wait = 900, page = p } = {}) => {
    if (only.length && !only.includes(name)) return;
    try {
      await fn();
      await page.waitForTimeout(wait);
      await page.screenshot({ path: path.join(IMG, `${name}.jpg`), type: 'jpeg', quality: 86, clip: clip || undefined });
      const vp = page.viewportSize();
      sizes[name] = clip ? [clip.width, clip.height] : [vp.width, vp.height];
      console.log('ok  ', name);
    } catch (e) {
      console.log('FAIL', name, e.message.split('\n')[0]);
    }
  };
  const go = async (url, sel) => {
    await p.goto(B + url);
    if (sel) await p.waitForSelector(sel, { timeout: 20000 });
  };
  const scrollTo = (text) => p.evaluate((t) => Array.from(document.querySelectorAll('h2,h3,h4,label,span,p')).find((e) => e.textContent.trim().startsWith(t))?.scrollIntoView({ block: 'start' }), text);

  await go('/login', '#username');
  await p.fill('#username', USER);
  await p.fill('#password', PASSWORD);
  await p.click('button[type=submit]');
  await p.waitForURL(B + '/');

  await shot('81-menu-dashboard', () => go('/', 'text=Needs attention'), { clip: null, wait: 1500 });
  await shot('82-coverage-platforms', async () => {
    await go('/attack-coverage', 'text=Coverage over time');
    await p.click('button:has-text("All platforms")');
  }, { wait: 1500 });
  await shot('83-technique-guidance', async () => {
    await go('/attack-coverage', 'text=Coverage over time');
    await p.click('button:has-text("T1003")');
    await p.waitForSelector('text=How MITRE suggests detecting it');
    await scrollTo('OS Credential Dumping');
  }, { wait: 1200 });
  await shot('84-collection', () => go('/log-sources?source=windows-security', 'text=Ready to turn on'), { wait: 1500 });
  await shot('85-collection-events', async () => {
    await go('/log-sources?source=windows-security', 'text=Do you collect Windows Security?');
    await scrollTo('Windows Security');
  }, { wait: 1200 });
  await shot('86-fields', () => go('/log-sources?tab=fields', 'text=In your events?'), { wait: 1200 });
  await shot('87-rules-owner', () => go('/rules?sort=nextReviewAt&dir=asc', 'text=Owner · review'), { wait: 1200 });
  await shot('88-rule-page', () => go(`/pages/${RULE}`, 'text=Mark reviewed'), { wait: 1500 });
  await shot('89-runbook', () => go(`/runbook/${RULE}`, 'text=Check first'), { wait: 1500 });
  await shot('90-editor-runbook', async () => {
    await go(`/pages/${RULE}/edit`, '#rule-triage');
    await p.evaluate(() => document.querySelector('#rule-triage')?.closest('.rounded-md')?.scrollIntoView({ block: 'start' }));
  });
  await shot('91-history', async () => {
    await go(`/pages/${RULE}`, 'button:has-text("History")');
    await p.click('button:has-text("History")');
    await p.waitForSelector('[role="dialog"] ul li');
  }, { clip: null, wait: 1200 });
  await shot('92-editor-leave', async () => {
    await go(`/pages/${RULE}/edit`, 'input[placeholder="Page title"]');
    await p.waitForTimeout(800);
    await p.locator('input[placeholder="Page title"]').pressSequentially(' v2');
    await p.waitForTimeout(1100);
    await p.click('aside a[href="/rules"]');
    await p.waitForSelector('text=Leave without saving?');
  }, { clip: null });
  await p.click('button:has-text("Leave")').catch(() => {});
  await shot('93-editor-draft', () => go(`/pages/${RULE}/edit`, 'text=You have unsaved changes to this page'), { clip: { ...PAGE, height: 420 } });
  await p.click('button:has-text("Discard")').catch(() => {});
  await shot('94-search', () => go('/search?q=lsass+dump', 'mark'), { wait: 1200 });
  await shot('95-backups', () => go('/backups', 'text=Clean up…'), { wait: 1200, clip: { ...PAGE, height: 620 } });
  await shot('96-graph-wiki', async () => {
    await go('/graph', 'text=Linked only');
    await p.waitForTimeout(5000);
  });
  await shot('97-graph-explore-start', () => go('/graph?view=explore', 'text=Where do you want to start?'));
  await shot('98-graph-explore', async () => {
    await go('/graph?view=explore&focus=technique:T1003.001', 'text=Opened:');
    await p.waitForTimeout(7000);
  });
  await shot('99-impact-today', () => go('/graph?view=impact&collection=1', 'text=What you miss today'), { wait: 1500 });

  // Phone width: the menu is a drawer
  const phone = await (await b.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, storageState: await ctx.storageState() })).newPage();
  await shot('100-mobile-menu', async () => {
    await phone.goto(B + '/rules');
    await phone.waitForSelector('button[aria-label="Open menu"]');
    await phone.click('button[aria-label="Open menu"]');
  }, { clip: null, page: phone });
  if (!only.length || only.includes('100-mobile-menu')) sizes['100-mobile-menu'] = [780, 1560];

  fs.writeFileSync(sizesFile, JSON.stringify(sizes));
  await b.close();
})();
