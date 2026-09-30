// Captures the raw screenshots used in the user manual into docs/user-manual/shots/.
// Needs a running DetectKB with data loaded, and an admin account:
//   KB_URL=http://localhost:5173 KB_USER=admin KB_PASSWORD=... npm run screenshots
// The images in img/ are cropped versions of these; re-crop by hand after re-capturing.
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
if (!PASSWORD) {
  console.error('Set KB_PASSWORD (and KB_USER / KB_URL if needed)');
  process.exit(1);
}
const O = path.join(__dirname, '..', 'shots');
const FIX = path.join(__dirname, '..', '..', '..', 'backend', 'test', 'fixtures');
fs.mkdirSync(O, { recursive: true });

(async () => {
  const { chromium } = loadPlaywright();
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const shot = async (name, fn, opts = {}) => {
    try {
      await fn();
      await p.waitForTimeout(opts.wait ?? 700);
      await p.screenshot({ path: `${O}/${name}.png`, clip: opts.clip });
      console.log('ok  ', name);
    } catch (e) {
      console.log('FAIL', name, e.message.split('\n')[0]);
    }
  };
  const go = async (url, sel) => {
    await p.goto(B + url);
    if (sel) await p.waitForSelector(sel, { timeout: 20000 });
  };
  const mainScroll = (dy) => p.evaluate((d) => document.querySelector('main')?.scrollBy(0, d), dy);

  await shot('01-login', () => go('/login', '#username'));
  await p.fill('#username', USER);
  await p.fill('#password', PASSWORD);
  await p.click('button[type=submit]');
  await p.waitForURL(B + '/');
  await shot('02-dashboard', () => go('/', 'text=Rules by Source'), { wait: 1500 });
  await shot('03-command-palette', async () => {
    await go('/', 'text=Rules by Source');
    await p.keyboard.press('Control+k');
    const input = p.locator('input[placeholder^="Search pages, rules"]');
    await input.waitFor();
    await input.fill('lsass');
    await p.waitForTimeout(1500);
  });
  await p.keyboard.press('Escape');

  // Rules
  await shot('04-rules', () => go('/rules', 'text=/Showing 1–50/'));
  await shot('05-rules-filtered', () => go('/rules?severity=critical&sort=title', 'text=/Showing/'));
  await shot(
    '06-rules-preview',
    async () => {
      await go('/rules?q=lsass', 'text=/Showing/');
      await p.locator('tbody tr').nth(1).locator('td:nth-child(2) a').click();
      await p.waitForSelector('aside[aria-label="Rule preview"] >> text=Open page');
    },
    { wait: 1200 }
  );
  await shot('07-rules-bulk', async () => {
    await go('/rules', 'text=/Showing 1–50/');
    const boxes = p.locator('tbody input[type=checkbox]');
    for (const i of [0, 1, 2]) await boxes.nth(i).check();
    await p.click('[role=toolbar] >> text=Status');
  });
  await p.keyboard.press('Escape');
  await shot(
    '08-save-view',
    async () => {
      await go('/rules?status=draft&severity=high', 'text=/Showing/');
      await p.click('button:has-text("Save view")');
      await p.fill('input[placeholder^="e.g."]', 'High-severity drafts');
    },
    { clip: { x: 700, y: 60, width: 740, height: 360 } }
  );

  // One rule of each source to show the rule page
  const slugs = await p.evaluate(async () => {
    const h = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
    const one = async (q) => (await (await fetch('/api/rules?page=1&pageSize=1&' + q, { headers: h })).json()).items[0]?.page.slug;
    return { elastic: await one('source=elastic&q=lsass'), sigma: await one('source=sigma&q=lsass'), escu: await one('source=escu&q=lsass') };
  });
  await shot('09-rule-page', () => go('/pages/' + slugs.sigma, '[role=tablist]'), { wait: 1200 });
  await shot('10-rule-sigma-convert', async () => {
    await go('/pages/' + slugs.sigma, '[role=tablist]');
    await p.click('[role=tab]:has-text("Sigma")');
    await p.selectOption('select[aria-label="Conversion target"]', 'kusto_sentinel');
    await p.click('button:has-text("Convert")');
    await p.waitForTimeout(2000);
    await p.locator('button:has-text("Convert")').scrollIntoViewIfNeeded();
  });
  await shot('11-rule-page-elastic', () => go('/pages/' + slugs.elastic, '[role=tablist]'), { wait: 1200 });
  await shot('12-rule-editor', () => go('/pages/' + slugs.escu + '/edit', 'textarea'), { wait: 1600 });
  await shot('13-rule-editor-rulefields', async () => {
    await go('/pages/' + slugs.escu + '/edit', 'text=Detection Rule Details');
    await p.waitForTimeout(800);
    await p.evaluate(() => {
      const h = [...document.querySelectorAll('*')].find((e) => e.textContent?.trim() === 'Detection Rule Details');
      h?.scrollIntoView({ block: 'start' });
      document.querySelector('main')?.scrollBy(0, -20);
    });
  });
  await shot('13b-rule-editor-rulefields2', () => mainScroll(800));
  await shot('13c-rule-editor-rulefields3', () => mainScroll(800));

  // Import
  await shot('14-import-dialog', async () => {
    await go('/rules', 'text=/Showing/');
    await p.click('button:has-text("Import rules")');
    await p.locator('input[type=file][accept]').setInputFiles(fs.readdirSync(FIX).map((f) => path.join(FIX, f)));
  });
  await shot('15-import-review', async () => {
    await p.click('button:has-text("Review")');
    await p.waitForSelector('[role=tab]:has-text("Changed")');
  });
  await shot('16-import-review-changed', async () => {
    await p.click('[role=dialog] [role=tab]:has-text("Changed")');
    await p.locator('[role=dialog] li button').first().click();
  });
  await p.keyboard.press('Escape');
  await p.goto(B + '/');

  // ATT&CK, Sysmon, attacker tools
  await shot('17-attack-coverage', () => go('/attack-coverage', 'text=Techniques covered'), { wait: 1200 });
  await shot('18-attack-technique', async () => {
    await go('/attack-coverage', 'text=Techniques covered');
    await p.click('button[title^="T1003 "]');
    await p.waitForSelector('text=/Rules mapped to T1003 \\(/');
    await p.locator('text=/Rules mapped to T1003/').scrollIntoViewIfNeeded();
    await p.mouse.wheel(0, -150);
  });
  await shot('19-sysmon', () => go('/sysmon-events', 'text=Sysmon Event IDs'), { wait: 1000 });
  await shot('20-sysmon-event', () => go('/sysmon-events?event=10', 'text=/Detection rules using this event/'), { wait: 1500 });
  await shot('21-attacker-tools', async () => {
    await go('/attacker-tools', 'text=AccCheckConsole.exe');
    await p.waitForLoadState('networkidle');
  }, { wait: 1500 });
  await shot('22-attacker-tool-detail', () => go('/attacker-tools?kind=lolbas&key=certutil.exe', 'text=/Detection rules mentioning it/'), { wait: 1500 });

  // Knowledge graph
  await shot('23-graph-wiki', () => go('/graph', 'text=Knowledge Graph'), { wait: 4000 });
  await shot('24-graph-explore', () => go('/graph?view=explore&focus=technique:T1003', 'text=Knowledge Graph'), { wait: 6000 });
  await shot('25-graph-chain', () => go('/graph?view=chain&technique=T1003', 'text=Knowledge Graph'), { wait: 3000 });
  await shot('26-graph-paths', () => go('/graph?view=paths&from=technique:T1003.001&to=lolbas:rundll32.exe', 'text=/shortest path/'), { wait: 800 });
  await shot('27-graph-impact', () => go('/graph?view=impact&sysmon=10', 'text=Rules lost'), { wait: 1200 });
  await shot('28-graph-flows', () => go('/graph?view=flows', 'svg[aria-label="Detection flows"]'), { wait: 1200 });
  await shot('29-graph-gaps', () => go('/graph?view=gaps', 'text=Tools no rule mentions'), { wait: 1200 });
  await shot(
    '30-graph-export',
    async () => {
      await go('/graph?view=flows', 'svg[aria-label="Detection flows"]');
      await p.click('button:has-text("Export")');
    },
    { clip: { x: 900, y: 60, width: 540, height: 300 } }
  );

  // Knowledge pages
  await shot('31-all-pages', () => go('/pages', 'text=/Showing 1–50/'));
  await shot('32-page-view', () => go('/pages/lsass-credential-dumping', 'text=LSASS Credential Dumping'), { wait: 1200 });
  await shot('33-page-editor-autocomplete', async () => {
    await go('/pages/lsass-credential-dumping/edit', 'textarea');
    await p.locator('textarea').first().click();
    await p.keyboard.press('Control+End');
    await p.keyboard.type('\n\nSee [[lsass mem');
    await p.waitForTimeout(1200);
  });
  await p.goto(B + '/'); // leave the editor without saving
  await shot('34-concepts', () => go('/concepts', 'text=Concepts'), { wait: 1200 });
  await shot('35-data-sources', () => go('/data-sources', 'text=Data Sources'), { wait: 1200 });
  await shot('36-spl-library', () => go('/spl-library', 'text=SPL Library'), { wait: 1200 });
  await shot('37-search', async () => {
    await go('/search', 'input');
    await p.locator('input').last().fill('mimikatz');
    await p.waitForTimeout(1500);
  });
  await shot('38-docs', () => go('/docs', 'text=/Select all/'), { wait: 1000 });

  // Administration
  await shot('39-settings', () => go('/settings', 'text=Settings'), { wait: 1000 });
  await shot('40-users', () => go('/settings/users', 'text=User Management'), { wait: 1000 });
  await shot('41-tags', () => go('/settings/tags', 'text=Tag Management'), { wait: 1000 });
  await shot('42-page-types', () => go('/settings/types', 'text=Page Types'), { wait: 1000 });
  await shot('43-backups', () => go('/backups', 'text=Backups'), { wait: 1000 });
  await shot('44-activity', () => go('/activity', 'text=User Activity'), { wait: 1500 });
  await shot('45-broken-links', () => go('/broken-links', 'text=Broken Links'), { wait: 1000 });
  await shot('46-shortcuts', async () => {
    await go('/rules', 'text=/Showing/');
    await p.locator('body').click({ position: { x: 5, y: 600 } });
    await p.keyboard.press('?');
    await p.waitForSelector('text=Keyboard Shortcuts');
  });
  await p.keyboard.press('Escape');
  await shot('47-dark-mode', async () => {
    await p.evaluate(() => localStorage.setItem('darkMode', 'true'));
    await go('/', 'text=Rules by Source');
  }, { wait: 1500 });
  await p.evaluate(() => localStorage.setItem('darkMode', 'false'));

  console.log('page errors:', errors.length, errors.slice(0, 3).join(' | '));
  await b.close();
})();
