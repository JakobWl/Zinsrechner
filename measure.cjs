const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const logs = [];
  page.on('console', (msg) => {
    const t = msg.text();
    if (t.includes('tableScrollY')) logs.push(t);
  });
  await page.goto('http://127.0.0.1:7777/', { waitUntil: 'networkidle' });
  // trigger a resize to force scheduleResize
  await page.waitForTimeout(800);
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(1500);

  const m = await page.evaluate(() => {
    const el = document.querySelector('.table-region');
    const body = document.querySelector('.ant-table-body');
    return {
      innerH: window.innerHeight,
      regionH: el ? el.clientHeight : null,
      bodyMaxH: body ? getComputedStyle(body).maxHeight : null,
      bodyScrollH: body ? body.scrollHeight : null,
      bodyClientH: body ? body.clientHeight : null,
    };
  });
  console.log('MEASUREMENT:', JSON.stringify(m, null, 2));
  console.log('LOGS count:', logs.length);
  console.log('LOGS:', JSON.stringify(logs.slice(-8), null, 2));
  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });