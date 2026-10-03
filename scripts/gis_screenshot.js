// Screenshot key regions of the client-design report for visual verification
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1240, height: 1000 } });
  await page.goto('file:///home/z/my-project/download/GlobalEIS_Report_EidFarag_EGP.html');
  await page.waitForTimeout(400);
  const shots = [
    ['.header', 'gis2_header'],
    ['.kpi-grid', 'gis2_kpis'],
    ['table.data-table', 'gis2_recon'],
    ['.analysis-grid', 'gis2_analysis'],
    ['.footer', 'gis2_footer'],
  ];
  for (const [sel, name] of shots) {
    const el = await page.$(sel);
    if (el) {
      await el.screenshot({ path: `/home/z/my-project/scripts/wafa_work/${name}.png` });
      console.log('shot:', name);
    } else {
      console.log('MISSING:', sel);
    }
  }
  await browser.close();
  console.log('done');
})();
