// Screenshot QA for the redesigned portal report (client design).
const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const src = process.argv[2];
  const out = process.argv[3];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto("file://" + path.resolve(src));
  await page.waitForTimeout(400);
  // full page
  await page.screenshot({ path: out, fullPage: false });
  // key regions
  await page.screenshot({ path: out.replace(".png", "_header.png"), clip: { x: 0, y: 0, width: 1280, height: 340 } });
  const kpi = await page.$(".kpi-grid");
  if (kpi) await kpi.screenshot({ path: out.replace(".png", "_kpi.png") });
  const table = await page.$(".data-table");
  if (table) await table.screenshot({ path: out.replace(".png", "_table.png") });
  const card = await page.$(".analysis-card");
  if (card) await card.screenshot({ path: out.replace(".png", "_card.png") });
  const footer = await page.$(".footer");
  if (footer) await footer.screenshot({ path: out.replace(".png", "_footer.png") });
  // design assertions
  const checks = await page.evaluate(() => {
    const cs = getComputedStyle(document.body);
    const h1 = document.querySelector(".header h1");
    const sec = document.querySelector(".section-title");
    const before = sec ? getComputedStyle(sec, "::before").backgroundColor : "none";
    return {
      fontFamily: cs.fontFamily.slice(0, 30),
      bg: cs.backgroundColor,
      h1: h1 ? h1.textContent.trim() : null,
      h1Transform: h1 ? getComputedStyle(h1).textTransform : null,
      headerGradient: document.querySelector(".header") ? getComputedStyle(document.querySelector(".header")).backgroundImage.slice(0, 60) : null,
      sectionBar: before,
      kpiCount: document.querySelectorAll(".kpi-card").length,
      tagCount: document.querySelectorAll(".tag").length,
      alertCount: document.querySelectorAll(".alert-box").length,
      tableCount: document.querySelectorAll(".data-table").length,
      hasDownloadBtn: !!document.querySelector(".download-btn"),
      footerText: (document.querySelector(".footer") || {}).textContent ? document.querySelector(".footer").textContent.includes("Financial Intelligence Services") : false,
    };
  });
  console.log(JSON.stringify(checks, null, 2));
  await browser.close();
})();
