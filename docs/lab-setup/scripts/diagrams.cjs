const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 820, height: 900 }, deviceScaleFactor: 2 });
  await p.goto('file://' + __dirname + "/diagrams.html");
  await p.waitForTimeout(500);
  for (const id of ['topology', 'flow']) await p.locator('#' + id).screenshot({ path: __dirname + `/../img/${id}.png` });
  await b.close();
})();
