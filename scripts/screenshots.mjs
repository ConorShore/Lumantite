// Capture README screenshots from a running Lumantite server (default http://localhost:8080).
// Usage: node scripts/screenshots.mjs [baseUrl]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:8080";
const out = new URL("../docs/screenshots/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const shots = [
  { name: "canvas", q: "project=dwdm-amplified/project.yaml&tab=canvas", after: (p) => selectOnCanvas(p, "A-sfp-c21") },
  { name: "results", q: "project=dwdm-amplified/project.yaml&tab=results", after: expandFirstRow },
  { name: "yaml", q: "project=dwdm-amplified/project.yaml&tab=yaml" },
  { name: "catalog", q: "project=dwdm-amplified/project.yaml&tab=catalog" },
  { name: "margins", q: "project=dwdm-amplified/project.yaml&tab=margins" },
  { name: "cwdm-ring", q: "project=cwdm-ring/project.yaml&tab=canvas", after: (p) => selectOnCanvas(p, "site1-sfp") },
];

// Select by clicking the device once the fibres have rendered: loading with `select=` in the URL
// can leave the canvas without any edges.
async function selectOnCanvas(page, id) {
  await page.waitForSelector(".react-flow__edge path", { timeout: 15000 }).catch(() => {});
  await page.getByRole("button", { name: /^fit$/i }).first().click();
  await page.waitForTimeout(800);
  await page.locator(`.react-flow__node[data-id="${id}"]`).click({ position: { x: 20, y: 8 } });
  await page.waitForTimeout(1000);
}
async function expandFirstRow(page) {
  const row = page.locator("table tbody tr").first();
  if (await row.count()) await row.click();
  await page.waitForTimeout(400);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", deviceScaleFactor: 2 });
const page = await ctx.newPage();
for (const s of shots) {
  await page.goto(`${base}/?${s.q}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.body.innerText.includes(" ms"), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
  if (s.after) await s.after(page);
  await page.screenshot({ path: `${out}${s.name}.png` });
  console.log("wrote", `${s.name}.png`);
}
await browser.close();
