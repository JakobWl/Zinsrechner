const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto('http://127.0.0.1:7777/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const result = await page.evaluate(() => {
    // Check if ResizeObserver fires - observe body
    let roFired = false;
    const ro = new ResizeObserver(() => { roFired = true; });
    ro.observe(document.querySelector('.table-region'));
    window.dispatchEvent(new Event('resize'));
    return new Promise(resolve => setTimeout(() => { ro.disconnect(); resolve({ roFired }); }, 1000));
  });
  console.log('RESULT:', JSON.stringify(result));
  // Now check: is scheduleResize even attached? Try to find via React fiber? Too complex.
  // Instead, just call a forced re-layout by changing viewport
  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });