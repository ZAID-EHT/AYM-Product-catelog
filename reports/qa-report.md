# AYM catalogue — verified delivery

Date: 20 October 2026 (Asia/Colombo)

## Default light theme and fullscreen actions

Light mode now starts on a white background regardless of the device theme. The top options menu offers Light and Dark radio choices, persists an explicit choice under `aym.theme.v1`, applies it before paint, and updates browser chrome color. Save and Share are beside the fullscreen product name and follow the product reached by swipe or arrows. The share dialog returns to fullscreen; its keyboard handling cannot navigate the underlying viewer. Dialog labels are unique for the nested sharing flow.

The production build, all 18 unit/import checks, focused sharing checks and mobile regressions pass in Chromium/WebKit. Added mobile checks verify a white default on dark-mode devices, remembered theme and chrome colors, fullscreen Save on the current product, a real downloaded PNG containing only that product's name/photo, and return from sharing without moving the viewer. Increased text size remains supported. Original photos/workbook are unchanged.

## iPhone layout and fullscreen browsing correction

Corrected the root foreground/background to use the active theme, so dark-mode text and icons no longer inherit light-mode ink. Pinned the photograph button inside its constrained frame to prevent Safari percentage-height overflow into the product name. Phone tabs occupy their own layout row below scrolling content, with safe-area spacing and larger Save/Share/tab labels. Fullscreen now displays the product name and position, supports left-to-next/right-to-previous swipes, keyboard and visible product arrows, and resets zoom when changing products. At increased zoom, dragging continues to pan instead of navigating. Home persistence and exploration isolation are preserved.

Validation against the production build: 18 unit/import tests, all 25 existing Chromium/WebKit browser workflow checks, focused numeric Jump/pinch and photo-and-name-only sharing regressions, and the new `npm run test:mobile` checks pass. Mobile checks cover light/dark colors, photo containment, separate tabs at 393 × 620/650/852, simulated 59px top/34px bottom safe areas, Save and actual PNG downloads, fullscreen names/swipes/arrows/keyboard/boundaries, zoom/pan isolation, viewport resizing, and the longest real product name at 150% text size. No uncaught runtime errors were observed. Screenshots are in `test-results/`. These are browser emulations, not physical iPhone or real native share-sheet tests.

Swipe preference update: left now advances to the next product; right returns to the previous product. The hint, drag boundary resistance and transition direction match. Production build and all 18 unit/import tests pass. `npm run test:swipe` passes in Chromium and WebKit, including both directions, first/last boundaries, vertical-scroll rejection, reload persistence and preserved Home position. Evidence: `test-results/swipe-results.json`.

Export preference update: downloaded/shared images now contain only the product photo and full name. Prices, codes, branding and all other added text are excluded. The updated production build, all 18 unit/import tests, and focused export tests in Chromium and WebKit pass. The saved preference is in the project `AGENTS.md`. Earlier full-workflow results below remain evidence for unchanged catalogue features; export assertions in the test suite were updated to this new requirement.

## Result

Production build succeeds. **18 unit/import tests pass**, **25 browser workflow checks pass**, and **2 focused browser regression groups pass**. No uncaught application runtime errors were observed in either browser engine. Source formatting checks pass.

The final numeric Jump correction was verified with its additional TypeScript test and focused Chromium/WebKit production regressions after the full workflow suite. The focused tests also verify the longest actual workbook product name in a generated PNG and emulated two-finger pinch in Chromium.

## Source integrity and import

| Check | Result |
| --- | --- |
| Worksheets inspected | Products, 2,275 rows including header, 9 columns |
| Product records | 2,274; every name, number, SKU and source price compared with Excel |
| Original image files | 2,220; all decoded, associated using explicit workbook paths and SHA-256 checked |
| Products with photos | 2,220 |
| Missing photographs | 54, all reported and represented by placeholders |
| Duplicate SKU groups | 6, reported; generated catalogue identities are unique |
| Suspicious source fields | 55, retained and reported |
| Ambiguous image associations | 0 |
| Unreadable photographs | 0 |
| Main price / Price 2 fallback / old-price fallback | 1,537 / 64 / 673 |
| Categories and descriptions | Not present in the workbook; none invented |
| Repeat import | Succeeds with the same dataset version (`8951e4de4e483c31`) |
| Original source preservation | Workbook and all 2,220 image SHA-256 checks pass |

See [import-report.md](import-report.md) for the human-readable issues and [import-report.json](import-report.json) for the complete mappings, checksums, invalid fields and metadata.

## Functional coverage

| Area | Verified behavior |
| --- | --- |
| Single-product viewer | Exactly one main product; actual workbook name, SKU, exact price and fallback label |
| Swipes | Updated preference: left = next, right = previous; vertical drags rejected |
| Desktop controls | Visible arrows, mouse drag and keyboard arrows |
| Resume | 100 forward navigations from product 1 reach product 101; synchronous stable-ID storage survives reload, closed tab and fresh-context storage restore |
| Catalogue changes | Unit tests restore by stable ID after reordering; removed IDs use a clamped nearby index |
| Search | Partial/case-insensitive name, SKU and category matching; 50,000-entry filter test; 40-card bounded rendering and incremental results |
| Home isolation | Search product 600, Saved viewer, direct links and Jump leave Home at product 101 |
| History | Back returns to search results with the query preserved; browser Back works |
| Saved | Immediate bookmark feedback, no duplicates, search, remove, viewer, reload persistence and sharing |
| PNG export | Updated PNG decoded; 1080px wide, source photograph retained; Canvas text equals only the full product name, with no added prices, codes, branding or other text |
| Long-name export | Longest real product name (73 characters) appears in full inside exported image; no truncated name |
| Native sharing | Stubbed feature detection and real PNG `File` payload; a fresh active user gesture is verified before invoking sharing |
| Fallback sharing | Unsupported native image sharing downloads a real PNG; selectable URL fallback supports blocked clipboard access |
| Product URLs | Individual stable-ID links open the intended product and retain Home position |
| Jump | Plain `600` opens product 600; `sku:600` opens SKU 600 (product 2,189); duplicate code `2516-SP` is rejected with recovery guidance; opening a unique workbook number succeeds |
| Zoom | Fullscreen dialog, zoom controls, Escape dismissal; emulated two-finger pinch increases zoom in Chromium |
| Missing photos | Workbook product 103 shows its own photograph-unavailable state, without a substitute photo |
| Responsive layout | 393×852, 375×667, 852×393, 768×1024 and 1440×1000; no horizontal overflow; primary targets at least 44px |
| Safe areas | CSS inset simulation of 59px top and 34px bottom; brand clears top inset and product controls remain above bottom navigation |
| Accessibility | Semantic controls, labelled fields, keyboard navigation, native dialog focus trapping, reduced motion, light/dark styles and 150% root text sizing checked |
| Storage failures | Actual browser storage blocking shows a warning while navigation and in-memory Saved remain usable; corrupted records recover |
| Offline reopening | First-visit and subsequent offline reloads retain shell, catalogue, current position and viewed photo |
| Cache limit | Photo cache seeded beyond 80 entries; eviction verified to reduce it to at most 80 |
| Explicit Restart | Returns Home to product 1; independent bookmark storage is retained |

## Commands and evidence

```powershell
npm test
npm run build
npm run test:e2e
npm run test:regression
npm run test:share
npx --no-install prettier --check src index.html vite.config.ts tsconfig.json package.json README.md public/sw.js public/manifest.webmanifest
```

Browser tests require the production preview on `http://127.0.0.1:4173` (`npm run preview`).

- `test-results/browser-results.json`: 25 passed workflow groups, no failures, no recorded console errors.
- `test-results/focused-results.json`: focused final regressions in Chromium and WebKit, both passed.
- `test-results/share-export-results.json`: updated photo-and-name-only export checks, passed in Chromium and WebKit.
- `test-results/*photo-and-name-only.png`: newly downloaded exports with the updated format.
- `test-results/*iphone14pro*.png`: light, dark and safe-area layout evidence.
- `test-results/*small-phone.png`, `*landscape.png`, `*tablet.png`, `*desktop.png`: responsive screenshots.
- `test-results/*product-card.png` and `*long-name-card.png`: real exported PNGs inspected during QA.

The final JavaScript bundle is about 259.4 kB (81.5 kB gzip); CSS is about 26.8 kB (6.2 kB gzip). The complete catalogue JSON is 1,040,731 bytes (144,298 bytes gzip). Optimized photographs total about 171 MiB and are requested on demand; the entire photo collection is not downloaded at startup.

## Practical limits

**No physical iPhone was tested.** WebKit runs on Windows; Chromium uses mobile viewport/touch emulation. Safe-area tests inject equivalent CSS inset values, rather than measuring a physical Dynamic Island or home indicator. Real iPhone Safari installation, keyboard behavior, device suspension and the operating-system share sheet still need a device pass. The native share API was stubbed to inspect its PNG payload and user activation; no actual WhatsApp, Messages, AirDrop or other destination was opened.

Persistence depends on this browser retaining site data. Clearing site data or operating-system eviction can remove local progress and Saved. Offline access covers the shell and recently requested photographs, not unseen photographs. The source’s missing current prices, placeholder SKUs and missing photos remain explicit source limitations.

No deployment, GitHub push or unrelated project changes were performed. The original workbook and original image folder are unchanged.
