# AYM — The Collection

A mobile-first, single-product catalogue built from the supplied Excel workbook and photographs. React 19, TypeScript and Vite. No accounts, database, paid services or external runtime requests.

## Run locally

Requirements: Node.js 22.12+ (or 20.19+), Python 3.10+, and npm.

```powershell
npm ci
python -m pip install -r requirements.txt
# The generated catalogue and optimized media are already supplied.
npm run dev
```

Open the URL printed by Vite, normally **http://127.0.0.1:5173**. Use the IPv4 address if `localhost` resolves incorrectly on your computer.

```powershell
npm run build
npm run preview
```

The production preview is **http://127.0.0.1:4173**. The service worker is enabled in production/preview only. Local development always uses live source assets.

## Update the products

1. Replace or edit `AYM_Products.xlsx` and put original photographs in `images/`. The importer never modifies either source.
2. Keep the `No` values and SKUs stable. Keep `Destination` references relative to this project, e.g. `images/123.jpg`. Subfolders are supported.
3. Run `npm run import`, inspect `reports/import-report.md` and the detailed JSON report, then run `npm run check` and `npm run build`.
4. Publish the new `dist/` folder to your static host when ready.

The importer inspects every worksheet. Worksheets with `No` and `Product Name` columns are imported in workbook order. Other sheet names and headers are included in the report. Current source: one `Products` worksheet, 2,274 product rows, 2,220 original JPGs. All original names, numbers, SKUs and prices are retained. There are no supplied categories or descriptions; none are inferred.

Image matching uses explicit `Destination`, Image or Photo column references. Multiple explicit photos can be separated by semicolons, or added in columns such as `Photo 2`. An exact unique SKU filename is used only if no explicit image reference is present. The importer never guesses by similar product names or silently substitutes another product’s photo. Missing, corrupt or ambiguous associations show a placeholder. Shared references are flagged and withheld until corrected. This workbook has one photograph per mapped product; gallery controls appear only when an update supplies multiple images.

WebP display images (maximum 1440px) and 320px thumbnails are content-addressed and generated incrementally in `public/media/`. Originals are approximately 723 MiB; generated images and thumbnails total about 171 MiB, fetched only as needed. The import reports every original file checksum, size and mapping. Old generated media can remain across imports; only current catalogue references ship logically, though Vite copies any retained files in `public/`. For a fresh release with obsolete media removed, generate in a clean copy of the project rather than deleting original images.

### Source issues and price policy

The source contains **54 missing photographs**, **6 duplicate SKU groups**, and **55 suspicious fields** (including placeholder SKUs and numeric-only names). Every row remains visible; see `reports/import-report.json` for exact entries.

The workbook has three different price columns, with no explanation of the relationship between Price and Price 2. The website does not infer discounts or price tiers:

| Primary displayed value              |  Rows | Visible label     |
| ------------------------------------ | ----: | ----------------- |
| `Price (LKR)` if valid               | 1,537 | Price             |
| Otherwise `Price 2 (LKR)` if valid   |    64 | Price 2           |
| Otherwise `Old Price (LKR)` if valid |   673 | Last listed price |

Fallback rows explicitly explain that the main current price was not supplied. If both Price and Price 2 differ, the alternate Price 2 is also displayed. These prices remain on the website; downloaded/shared PNGs exclude them. Old prices are never silently treated as confirmed current prices. Currency is LKR and precision is two decimals, as supplied in the workbook headers and formats. Missing/invalid prices remain unavailable rather than becoming zero.

## Browsing, progress and Saved

- Exactly one product is shown in the main viewer. **Swipe left = next; swipe right = previous.** Drag the photo, use the visible arrows, or press the keyboard arrow keys. Vertical scrolling, two-finger gestures and screen-edge gestures are excluded from product swipes.
- Finger swipes work across the product photograph, name and details, and across the fullscreen photograph/name area. Touch navigation uses its own non-passive move/end listeners, so a cancelled pointer stream cannot drop the release. Controls keep their normal taps, vertical gestures scroll, and zoomed fullscreen images pan. Listeners reattach when the viewer returns from Search or Saved.
- Main Home progress is written synchronously after each navigation to `aym.home.v1` in localStorage. It stores the stable product ID, previous index and catalogue version. The visible product is restored exactly; after navigating forward 100 times from product 1, it reopens on product 101.
- Unique valid SKUs are stable IDs; duplicated, missing or placeholder SKUs use the workbook `No`. Reordering preserves unique SKU progress. If a product disappears, the old index is clamped to an appropriate remaining position. Changing a duplicate SKU into a unique SKU can change its identity; preserve `No` and SKU where possible.
- Search, Saved details, direct product URLs and Jump are exploration views. They **never write Home’s browsing position**. Home always returns to the original place. Back restores search results and input; browser Back is supported. In Jump, plain numbers mean workbook product numbers; use `sku:600` for a numeric SKU. Duplicate SKU matches require a product number or selection through Search.
- Bookmark IDs are independently persisted under `aym.saved.v1`; entries are deduplicated. Removed catalogue IDs remain in stored bookmarks, so a temporarily removed product reappears in Saved if restored with the same ID.
- Storage errors show a visible session-only warning; the app continues in memory. Browser site-data clearing/private mode may remove persistence. No website can preserve localStorage after the user or operating system deletes site data.
- Catalogue options include Continue Browsing and the explicit Start from Beginning action. Restart only resets Home progress.

## Export Saved to Excel

Open **Saved → Export all Saved to Excel**, wait for preparation, then choose **Download Excel**. This exports the entire Saved collection at the time you start, including products hidden by a search or the 40-card display limit. Closing the dialog cancels preparation without changing Saved or Home progress.

The `.xlsx` contains one product per row with embedded photos, the full name, SKU, all three original price columns, workbook number/page, original destination references, the displayed price and its label, category/description and a product link. Prices are numeric with two decimal places; unavailable prices stay blank and missing photos are explicitly marked. Multiple photos fit within the same product row. Pictures are embedded as JPEGs, preserving their complete appearance and aspect ratio at up to 640px, so the file's photos work offline. Failed photo downloads show an error and Retry rather than silently producing an incomplete file.

Excel creation runs locally in the browser. The Excel library loads only when an export is opened. Original source files and the existing photo-and-name-only PNG exports remain unchanged.

## Product sharing

Share generates a **real PNG using Canvas**, not a screenshot. Following the user's saved preference, exported images contain **only the actual product photograph and full product name**. No added prices, currency, SKUs, branding, headers, footers or other text. Text already embedded in an original product photograph is preserved. The website still displays prices and codes. Cards are 1080px wide and grow vertically for long names. Images are served on the same origin; no third-party image CORS dependency is required.

The Share button opens a preview while generating the PNG. After it is prepared, tap **Share image** to pass a real `File` to `navigator.share`. This extra fresh tap preserves iOS Safari user activation, which can expire if image generation is awaited before invoking the share sheet. Applications offered (WhatsApp, Messages, AirDrop, etc.) are controlled by the operating system. Cancellation is harmless. Download Image is always available; it becomes the primary action if `navigator.canShare({files})` is unsupported. Copy Product Link has a selectable URL fallback if clipboard permissions are unavailable.

`?product=<stable-id>` opens the correct product without moving the saved Home place. Copy Product Link creates this URL. All images, scripts and data must be served over HTTP(S); opening `index.html` directly as a local file is unsupported.

## iPhone, accessibility and offline use

- Optimized at 393 × 852 CSS pixels, with safe-area insets, `viewport-fit=cover`, dynamic viewport units, semantic buttons, 44px targets, focus management, native dialog trapping, reduced motion and automatic light/dark colors.
- Tap the photo to open fullscreen viewing with the product's full name. Swipe left for the next product and right for the previous product, or use the visible arrows and keyboard. At more than 100% zoom, dragging pans the image instead of changing products; pinch or use the zoom controls. Changing products resets image zoom. Native page zoom remains enabled outside the photo zoom modal.
- On phones, the header and bottom tabs have reserved space around a scrolling content area. Product names and Save/Share controls stay separate from the photograph, including in dark mode and when Safari's toolbars reduce the visible viewport.
- Light mode is the default, including on devices using dark mode. Open the top-right catalogue options menu to choose Light or Dark; the explicit choice is remembered on this browser. Fullscreen has Save and Share beside the product name, and both follow the currently viewed product. Closing its share dialog returns to the same fullscreen product.
- In Safari, Share → Add to Home Screen installs the PWA. HTTPS is required on a phone for the service worker and native file-sharing APIs. HTTP `localhost`/`127.0.0.1` is a secure-context exception on the development computer; a phone visiting a LAN HTTP address is not.
- The production service worker caches the app shell and catalogue, then keeps at most **80 photo requests** using bounded recent-use caching. It does not precache all 2,220 photos. Previously opened images can work offline; unseen images show the photograph-unavailable state until connected.
- App shell updates are fetched online. A newly installed worker waits for existing tabs to close before activation, so a future version does not replace assets beneath an open session. Close/reopen all AYM tabs after publishing a new application version. The dataset is requested network-first on each load, with offline fallback.

## Tests

```powershell
npm test
npm run build
python -m playwright install chromium webkit
# In another terminal:
npm run preview
# Then:
npm run test:e2e
npm run test:regression
npm run test:share
npm run test:swipe
npm run test:mobile
npm run test:touch
npm run test:excel
```

`npm test` runs TypeScript behavior tests and Python importer/source-integrity tests. Python verifies all 2,274 source rows, every image association, missing/duplicate reporting, actual source SHA-256 checksums, and strict/fallback matching. TypeScript covers search (including 50,000 entries), gesture intent, price precision, corrupt/blocked storage and native file-sharing detection.

Browser QA runs against the production build in Chromium and WebKit, with a 393 × 852 touch-enabled context. It covers product 101 after 100 navigations, reload/tab reopen, Search/Saved isolation and persistence, history, direct links, jump, missing photos, zoom, actual PNG downloads and decoded image content, canvas text, native-sharing file payload/user activation with a stub, responsive sizes, dark mode, restart, and offline reload. Screenshots and results are written to `test-results/`. See `reports/qa-report.md` for the verified results and limitations.

The focused regression command also verifies numeric SKU/workbook number collisions, duplicate-SKU recovery, the longest actual product name in an exported PNG, and an emulated two-finger pinch in Chromium.

`npm run test:share` verifies photo-and-name-only exports in Chromium and WebKit, including actual PNG downloads, native file payloads, long names, missing photos, and retention of prices/codes on the website.

`npm run test:swipe` checks left-to-next and right-to-previous navigation, catalogue boundaries, vertical-scroll rejection, on-screen hints and progress persistence in Chromium and WebKit.

`npm run test:mobile` checks light/dark foregrounds, photo containment, separate bottom navigation at 393px widths and 620/650/852px heights, simulated safe areas, Save and PNG download, fullscreen names, swipes, keyboard/arrows, boundaries, pan isolation, resizing and independent Home progress in Chromium and WebKit. Screenshots are emulation evidence; physical iPhone testing remains a separate check.

`npm run test:touch` adds browser-dispatched Chromium finger gestures and synthetic Touch Events fallback checks in Chromium/WebKit. It covers both directions on photos/names/details, pointer cancellation, vertical scrolling, returning from Search/Saved, missing photos, fullscreen, zoom isolation and boundaries. Synthetic WebKit checks exercise the touch handler directly; they are not physical Safari touch tests.

`npm run test:excel` downloads and inspects real `.xlsx` exports in Chromium and WebKit: 48 saved records including products beyond the display limit, filters, exact numeric prices/blanks, internally embedded JPEGs, row-contained gallery anchors, leading-zero codes, literal text, missing photos, cancellation and retry. Exported files and test previews stay in `test-results/`.

**No physical iPhone Safari or actual operating-system share sheet was tested.** WebKit automation on Windows approximates Safari’s rendering engine but is not a device test. Device-level safe areas, keyboard behavior, suspension, installation and share destinations still merit a real iPhone pass before a public launch.

## Deploy from GitHub

Repository: [ZAID-EHT/AYM-Product-catelog](https://github.com/ZAID-EHT/AYM-Product-catelog). The repository includes the application, workbook, original `images/` photographs and the complete optimized `public/media/` collection. Build output and installed dependencies are generated rather than committed.

**Vercel:** choose Add New → Project, import this GitHub repository and deploy the `main` branch. Keep the root directory at the repository root. The included `vercel.json` supplies the Vite preset, `npm ci`, `npm run build`, and output folder `dist`. No environment variables or Python import step are needed to deploy the supplied catalogue. `public/catalogue.json` and every image in `public/media/` are copied into the build, so photos and PNG sharing work on the hosted HTTPS origin.

The original workbook and original photo folder are kept in GitHub for complete backups and repeatable imports; they are outside `public/` and are not served by the site. `.vercelignore` also excludes them from Vercel CLI uploads. Runtime photos use the optimized WebP files, so no Git LFS setup or external image service is required. Nothing has been deployed to a hosting provider by this project task.

For another static host:

1. Run `npm ci`, `npm run import` if sources changed, and `npm run build`.
2. Upload the contents of `dist/` to a static HTTPS host. Do not publish the source workbook, original image folder, tests or reports.
3. Serve `/`, `/index.html`, `/sw.js` and `/catalogue.json` with revalidation (`Cache-Control: no-cache`). Hashed `/assets/*` and content-addressed `/media/*` can use `public, max-age=31536000, immutable`.
4. Ensure `.webmanifest` uses `application/manifest+json`, WebP uses `image/webp`, and JavaScript is served with a JavaScript MIME type. URLs use query parameters, so no SPA subpath rewrite is needed beyond serving `index.html` at the site root.
5. For subdirectory hosting, set Vite’s `base` (for example `base: '/catalogue/'`), rebuild and serve that folder. Relative manifest and service-worker scope are supported.

Application source lives in `src/`; importer and asset pipeline in `scripts/`; generated runtime content in `public/`; validation evidence in `reports/`.

## Design references

No installed skill named Apple Design was available. The design follows the requested fallback: Apple’s official [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines), including [gestures](https://developer.apple.com/design/human-interface-guidelines/gestures), [tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars) and [layout/safe areas](https://developer.apple.com/design/human-interface-guidelines/layout). The installed UI/UX Pro Max and webapp-testing skills were also used. System typography, restrained materials, comfortable targets, persistent navigation and alternatives to gestures guide the implementation. The left-to-next gesture is explained in the interface.
