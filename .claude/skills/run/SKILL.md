---
name: run
description: Launch, screenshot, and inspect the Parts Manager PM Electron app. Use when asked to run the app, take a screenshot, verify a UI change, check light/dark mode, or debug computed CSS values.
---

Parts Manager PM เป็น Electron + React + Vite app ที่ใช้ Playwright CJS driver เพื่อ launch และ screenshot แบบ headless บน macOS

## Prerequisites

```bash
# ไม่ต้อง apt-get — macOS มี everything แล้ว
# playwright-core อยู่ใน node_modules แล้ว
```

## Build (ก่อน screenshot)

```bash
cd "/Volumes/Untitled/Mac Offload/2026-06-04/Home/Downloads/mm"
npm run build   # builds to dist/renderer/
```

หรือถ้าแก้แค่ CSS ไม่ต้อง build main:
```bash
npx vite build  # faster — renderer only
```

## Driver template (CJS)

```js
// /tmp/mm-driver.cjs  — copy-paste และแก้ตาม task
const { _electron: electron } = require('/Volumes/Untitled/Mac Offload/2026-06-04/Home/Downloads/mm/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const APP_DIR = '/Volumes/Untitled/Mac Offload/2026-06-04/Home/Downloads/mm';
const SHOT_DIR = '/tmp/mm-shots';
const electronBin = path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
fs.mkdirSync(SHOT_DIR, { recursive: true });

(async () => {
  const app = await electron.launch({
    executablePath: electronBin,
    args: [APP_DIR],
    timeout: 30000,
    env: { ...process.env, NODE_ENV: 'production' },
  });
  await new Promise(r => setTimeout(r, 5000));   // รอ main process เปิด window

  let page = app.windows().find(w => !w.url().startsWith('devtools://'))
          ?? await app.firstWindow();
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await new Promise(r => setTimeout(r, 3000));   // รอ React render

  // ── เปลี่ยน theme ──────────────────────────────────────
  // IMPORTANT: ต้อง set localStorage ด้วย มิฉะนั้น React reset กลับ
  await page.evaluate(t => {
    localStorage.setItem('theme', t);
    document.documentElement.setAttribute('data-theme', t);
  }, 'light'); // หรือ 'dark'
  await new Promise(r => setTimeout(r, 1200));

  // ── full screenshot ─────────────────────────────────────
  await page.screenshot({ path: path.join(SHOT_DIR, 'full.png'), scale: 'device' });

  // ── zoom panel ─────────────────────────────────────────
  const box = await page.evaluate(sel => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, '.summary-strip'); // เปลี่ยน selector ตาม panel ที่ต้องการ
  if (box) await page.screenshot({ path: path.join(SHOT_DIR, 'strip.png'), clip: box, scale: 'device' });

  // ── debug computed styles ──────────────────────────────
  const info = await page.evaluate(() => {
    const g = (sel, prop) => {
      const el = document.querySelector(sel);
      return el ? window.getComputedStyle(el)[prop] : '—';
    };
    return {
      someColor: g('.metric-label', 'color'),
      someBg:    g('.metric-combo', 'background'),
    };
  });
  console.log(JSON.stringify(info, null, 2));

  await app.close();
})().catch(e => { console.error(e.message); process.exit(1); });
```

รัน:
```bash
node /tmp/mm-driver.cjs
```

## Panel selectors ที่ใช้บ่อย

| Panel | Selector |
|---|---|
| Summary strip | `.summary-strip` |
| Left machine list | `.result-panel` |
| Middle parts | `.parts-panel` |
| Right detail | `.detail-panel` |
| Part model list (expanded) | `.part-model-list` |
| Machine overview header | `.machine-overview` |

## Interactions ที่ใช้บ่อย

```js
// expand cluster
await page.evaluate(() => document.querySelector('.part-cluster-toggle')?.click());

// click metric button by index (0=combo, 1=MT store, 2=Second hand)
await page.evaluate(i => {
  document.querySelectorAll('.summary-strip .metric-button')[i]?.click();
}, 1);

// hover machine row (to show edit/delete)
await page.evaluate(sel => document.querySelector(sel)?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })), '.machine-row');
```

## Gotchas

- **Theme reset**: app เก็บ theme ใน localStorage — ต้อง `localStorage.setItem('theme', t)` พร้อมกับ `setAttribute` ไม่งั้น React reset กลับ
- **Timing**: รอ 5000ms หลัง launch + 3000ms หลัง loadState — ถ้าน้อยกว่านี้ window อาจยังไม่พร้อม
- **scale: 'device'**: ใส่ `scale: 'device'` เพื่อได้ Retina 2x screenshot ที่ชัดขึ้น ตัด clip ก่อนถ้าต้องการ zoom เฉพาะส่วน
- **Electron steals stdin**: ไม่ใช้ REPL — เขียน script สำเร็จรูปแล้วรัน node โดยตรงแทน
- **ไม่มี xvfb**: macOS ไม่ต้องการ xvfb — รัน Electron ตรงได้เลย
- **dist/ ต้อง up-to-date**: Electron load จาก `dist/renderer/` — ถ้าแก้ CSS แล้วไม่ build จะยัง screenshot เก่า

## Troubleshooting

- **Launch timeout**: `dist/renderer/index.html` หายไปหรือ main process build ยังไม่เสร็จ → รัน `npm run build` ก่อน
- **window not found**: เพิ่ม `await new Promise(r => setTimeout(r, 8000))` หลัง launch
- **theme ไม่เปลี่ยน**: ลืม `localStorage.setItem` — React อ่านจาก localStorage ตอน mount
