// Screenshot each .page section of the GIS report for visual verification
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 940, height: 1200 } });
  await page.goto('file:///home/z/my-project/download/GlobalEIS_Report_EidFarag_EGP.html');
  await page.waitForTimeout(400);
  const pages = await page.$$('.page');
  console.log('sections:', pages.length);
  for (let i = 0; i < pages.length; i++) {
    await pages[i].screenshot({ path: `/home/z/my-project/scripts/wafa_work/gis_check_p${i + 1}.png` });
  }
  await browser.close();
  console.log('screenshots done');
})();
