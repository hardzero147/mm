/**
 * Smoke test: launch Electron app, take screenshots, report issues.
 * Run: node scripts/smoke-test.mjs
 */
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'scripts', 'smoke-shots');
fs.mkdirSync(SHOTS, { recursive: true });

const electronBin = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

let errors = [];
let app, page;

async function shot(name) {
  const f = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: f });
  console.log(`  📸 ${name}.png`);
  return f;
}

async function eval_(expr) {
  return page.evaluate(expr);
}

async function wait(sel, timeout = 8000) {
  await page.waitForSelector(sel, { timeout });
}

async function click(sel) {
  await page.evaluate(s => document.querySelector(s)?.click(), sel);
  await page.waitForTimeout(300);
}

async function run() {
  console.log('\n=== Parts Manager PM — Smoke Test ===\n');

  // ── Launch ──────────────────────────────────────────────────────────────
  console.log('Launching Electron...');
  app = await electron.launch({
    executablePath: electronBin,
    args: ['--no-sandbox', ROOT],
    timeout: 45000,
  });

  // Collect renderer console errors
  app.on('window', (win) => {
    win.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = `[console.error] ${msg.text()}`;
        errors.push(text);
        console.warn('  ⚠', text);
      }
    });
  });

  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await new Promise(r => setTimeout(r, 2000));
  console.log(`  window url: ${page.url()}`);

  // ── 1. Initial load ──────────────────────────────────────────────────────
  console.log('\n[1] Initial load');
  await shot('01-initial');

  // Check app shell renders
  const hasShell = await eval_(() => Boolean(document.querySelector('.app-shell')));
  if (!hasShell) errors.push('BUG: .app-shell not found — app may have crashed on startup');
  else console.log('  ✓ app-shell rendered');

  // Check topbar
  const hasTopbar = await eval_(() => Boolean(document.querySelector('.topbar')));
  if (!hasTopbar) errors.push('BUG: .topbar not found');
  else console.log('  ✓ topbar rendered');

  // ── 2. Wait for data to load ─────────────────────────────────────────────
  console.log('\n[2] Waiting for data...');
  try {
    await wait('.machine-row', 10000);
    const machineCount = await eval_(() => document.querySelectorAll('.machine-row').length);
    console.log(`  ✓ machine list loaded — ${machineCount} rows`);
    await shot('02-loaded');
  } catch {
    errors.push('BUG: machine list never appeared (timeout 10s)');
    await shot('02-load-failed');
  }

  // ── 3. Select a machine ───────────────────────────────────────────────────
  console.log('\n[3] Selecting first machine');
  await click('.machine-content');
  await page.waitForTimeout(500);
  const hasParts = await eval_(() => Boolean(document.querySelector('.parts-panel')));
  if (!hasParts) errors.push('BUG: .parts-panel not shown after selecting machine');
  else console.log('  ✓ parts-panel visible');
  await shot('03-machine-selected');

  // ── 4. Accordion — open first cluster ────────────────────────────────────
  console.log('\n[4] Accordion: open first cluster');
  const clusterCount = await eval_(() => document.querySelectorAll('.part-cluster').length);
  console.log(`  clusters found: ${clusterCount}`);

  if (clusterCount > 0) {
    await click('.part-cluster-main');
    await page.waitForTimeout(400);

    const expandedCount = await eval_(() => document.querySelectorAll('.part-cluster.is-expanded').length);
    console.log(`  expanded after click: ${expandedCount}`);
    if (expandedCount !== 1) errors.push(`BUG: expected 1 expanded cluster, got ${expandedCount}`);
    else console.log('  ✓ exactly 1 cluster expanded');
    await shot('04-cluster-open');
  }

  // ── 5. Accordion — open second cluster (if exists) ────────────────────────
  console.log('\n[5] Accordion: open second cluster');
  if (clusterCount >= 2) {
    const buttons = await eval_(() =>
      [...document.querySelectorAll('.part-cluster-main')].map((b, i) => i)
    );
    // Click the second cluster header
    await page.evaluate(() => {
      const btns = document.querySelectorAll('.part-cluster-main');
      btns[1]?.click();
    });
    await page.waitForTimeout(400);

    const expandedAfter = await eval_(() => document.querySelectorAll('.part-cluster.is-expanded').length);
    const stillOpen0 = await eval_(() => {
      const clusters = document.querySelectorAll('.part-cluster');
      return clusters[0]?.classList.contains('is-expanded');
    });

    if (expandedAfter !== 1) errors.push(`BUG: accordion — expected 1 expanded, got ${expandedAfter} after clicking second cluster`);
    else console.log('  ✓ accordion: only 1 cluster expanded after clicking second');
    if (stillOpen0) errors.push('BUG: first cluster still expanded after opening second — accordion not working');
    else console.log('  ✓ first cluster correctly closed');
    await shot('05-accordion-second');
  } else {
    console.log('  (only 1 cluster — skip multi-open test)');
  }

  // ── 6. Close cluster (click same header again) ────────────────────────────
  console.log('\n[6] Accordion: close active cluster');
  const activeBtn = await eval_(() => {
    const expanded = document.querySelector('.part-cluster.is-expanded');
    return expanded ? expanded.querySelector('.part-cluster-main') !== null : false;
  });
  if (activeBtn) {
    await page.evaluate(() => {
      const expanded = document.querySelector('.part-cluster.is-expanded');
      expanded?.querySelector('.part-cluster-main')?.click();
    });
    await page.waitForTimeout(400);
    const expandedNow = await eval_(() => document.querySelectorAll('.part-cluster.is-expanded').length);
    if (expandedNow !== 0) errors.push(`BUG: close failed — still ${expandedNow} clusters expanded`);
    else console.log('  ✓ cluster closed by clicking same header');
    await shot('06-cluster-closed');
  }

  // ── 7. Search ─────────────────────────────────────────────────────────────
  console.log('\n[7] Search');
  await page.evaluate(() => {
    const input = document.querySelector('input[placeholder*="ค้นหา"]');
    input?.focus();
    const nativeInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    nativeInput?.set?.call(input, 'OMRON');
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(600);
  const filteredCount = await eval_(() => document.querySelectorAll('.machine-row').length);
  console.log(`  ✓ search "OMRON" → ${filteredCount} rows`);
  await shot('07-search');

  // Reset search
  await page.evaluate(() => {
    const input = document.querySelector('input[placeholder*="ค้นหา"]');
    const nativeInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    nativeInput?.set?.call(input, '');
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(400);

  // ── 8. Add Machine modal ──────────────────────────────────────────────────
  console.log('\n[8] Add Machine modal');
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    btns.find(b => b.textContent?.includes('Add Machine'))?.click();
  });
  await page.waitForTimeout(500);
  const hasModal = await eval_(() => Boolean(document.querySelector('.modal-backdrop, .part-modal')));
  if (!hasModal) errors.push('BUG: Add Machine modal did not open');
  else console.log('  ✓ Add Machine modal opened');
  await shot('08-add-machine-modal');

  // Close modal
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // ── 9. Final screenshot ───────────────────────────────────────────────────
  console.log('\n[9] Final state');
  await shot('09-final');

  // ── Report ────────────────────────────────────────────────────────────────
  console.log('\n=== Results ===');
  console.log(`Screenshots saved to: ${SHOTS}`);

  if (errors.length === 0) {
    console.log('\n✅ All checks passed — no bugs found\n');
  } else {
    console.log(`\n❌ Found ${errors.length} issue(s):\n`);
    errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
    console.log('');
  }
}

run()
  .catch(err => {
    console.error('\nFATAL:', err.message);
    errors.push(`FATAL: ${err.message}`);
  })
  .finally(async () => {
    if (app) await app.close().catch(() => {});
    process.exit(errors.length > 0 ? 1 : 0);
  });
