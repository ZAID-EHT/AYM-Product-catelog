"""Read-only Excel import. Exact workbook references take priority; no fuzzy matching."""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import math
from pathlib import Path
import re
import sys
from datetime import datetime, timezone
from PIL import Image, ImageOps, ImageDraw, ImageFont
import openpyxl

ROOT = Path(__file__).resolve().parents[1]

def text(value):
    return '' if value is None else str(value).strip()

def valid_price(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0

def choose_price(row):
    for key, label in [('Price (LKR)', 'Price'), ('Price 2 (LKR)', 'Price 2'), ('Old Price (LKR)', 'Last listed price')]:
        if valid_price(row.get(key)):
            return row[key], key, label
    return None, None, 'Price unavailable'

def stable_id(sku, number, counts):
    if sku and sku.upper() not in ('LKR', '0', '0000') and counts[sku] == 1:
        return f'sku-{sku}'
    return f'aym-{number}'

def map_references(row, root, file_index):
    """Only explicit references or exact unique SKU basenames. Never row-number guesses."""
    refs = []
    for key, value in row.items():
        if re.search(r'destination|image|photo', key, re.I) and value:
            refs.extend(text(value).split(';'))
    found, missing, ambiguous = [], [], []
    for ref in refs:
        ref = ref.strip().replace('\\', '/').removeprefix('./')
        if not ref or ref.lower() == '(image missing)':
            continue
        candidate = (root / ref).resolve()
        image_root = (root / 'images').resolve()
        if candidate.is_relative_to(image_root) and candidate.is_file():
            if candidate not in found:
                found.append(candidate)
        else:
            missing.append(ref)
    # An explicit broken/missing destination must not silently select a different photo.
    if not refs:
        sku = text(row.get('SKU'))
        matches = file_index.get(sku.casefold(), []) if sku else []
        if len(matches) == 1:
            found = matches
        elif len(matches) > 1:
            ambiguous = [str(p.relative_to(root)) for p in matches]
    return found, missing, ambiguous

def optimize_image(path, root, output):
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    prefix = digest[:20]
    view, thumb = output / f'{prefix}.webp', output / f'{prefix}-thumb.webp'
    with Image.open(path) as original:
        image = ImageOps.exif_transpose(original).convert('RGB')
        width, height = image.size
        if not view.exists():
            sized = image.copy()
            sized.thumbnail((1440, 1440), Image.Resampling.LANCZOS)
            sized.save(view, 'WEBP', quality=88, method=4)
        if not thumb.exists():
            small = image.copy()
            small.thumbnail((320, 320), Image.Resampling.LANCZOS)
            small.save(thumb, 'WEBP', quality=78, method=4)
    return {'src': f'media/{view.name}', 'thumbnail': f'media/{thumb.name}', 'width': width, 'height': height,
            'source': path.relative_to(root).as_posix(), 'sha256': digest, 'sourceBytes': len(raw)}

def import_catalogue(root=ROOT, workbook='AYM_Products.xlsx', workers=6):
    root = Path(root).resolve()
    public = root / 'public'
    output = public / 'media'
    reports = root / 'reports'
    output.mkdir(parents=True, exist_ok=True)
    reports.mkdir(parents=True, exist_ok=True)
    path = root / workbook
    book = openpyxl.load_workbook(path, data_only=True, read_only=True)
    rows, sheets = [], []
    for sheet in book:
        values = iter(sheet.values)
        headers = [text(v) for v in next(values, [])]
        relevant = 'Product Name' in headers and 'No' in headers
        sheets.append({'name': sheet.title, 'rows': sheet.max_row, 'columns': headers, 'imported': relevant})
        if relevant:
            for number, values_row in enumerate(values, 2):
                row = dict(zip(headers, values_row))
                if any(v is not None and v != '' for v in values_row):
                    row['_sheet'], row['_row'] = sheet.title, number
                    rows.append(row)
    book.close()
    if not rows:
        raise ValueError('No product rows found. Expected headers: No, Product Name, SKU and LKR price columns.')
    files = sorted(p.resolve() for p in (root / 'images').rglob('*') if p.is_file())
    file_index = defaultdict(list)
    for p in files:
        file_index[p.stem.casefold()].append(p)
    sku_counts = Counter(text(r.get('SKU')) for r in rows if text(r.get('SKU')))
    no_counts = Counter(text(r.get('No')) for r in rows)
    duplicates = [{'sku': s, 'count': n, 'productNumbers': [r['No'] for r in rows if text(r.get('SKU')) == s]}
                  for s, n in sku_counts.items() if n > 1]
    missing, ambiguities, invalid, mappings, used = [], [], [], [], set()
    ids = set()
    for row in rows:
        name, sku, number = text(row.get('Product Name')), text(row.get('SKU')), text(row.get('No'))
        if not number or no_counts[number] > 1:
            raise ValueError(f'Duplicate/missing No at {row["_sheet"]}:{row["_row"]}; cannot produce stable identity.')
        if not name:
            invalid.append({'number': number, 'issue': 'Missing product name'})
        if name.isdigit():
            invalid.append({'number': number, 'issue': 'Numeric-only product name', 'value': name})
        if not sku or sku.upper() in ('LKR', '0', '0000'):
            invalid.append({'number': number, 'issue': 'Suspicious or missing SKU', 'value': sku})
        for col in ['Price (LKR)', 'Price 2 (LKR)', 'Old Price (LKR)']:
            if row.get(col) is not None and not valid_price(row[col]):
                invalid.append({'number': number, 'issue': f'Invalid {col}', 'value': text(row[col])})
        matched, broken, ambiguous = map_references(row, root, file_index)
        if ambiguous:
            ambiguities.append({'number': number, 'candidates': ambiguous})
        if not matched:
            missing.append({'number': number, 'sku': sku, 'name': name, 'reference': text(row.get('Destination')), 'brokenReferences': broken})
        elif broken:
            invalid.append({'number': number, 'issue': 'Some gallery references are missing', 'references': broken})
        mappings.append(matched)
        used.update(matched)
    # Conflicting explicit ownership is reported rather than guessed.
    owners = defaultdict(list)
    for row, paths in zip(rows, mappings):
        for p in paths:
            owners[p].append(row['No'])
    shared = {p for p, ns in owners.items() if len(ns) > 1}
    for p in shared:
        ambiguities.append({'source': p.relative_to(root).as_posix(), 'productNumbers': owners[p], 'issue': 'Shared image reference; withheld pending correction'})
    errors, assets = [], {}
    def convert(p):
        try:
            return p, optimize_image(p, root, output), None
        except Exception as exc:
            return p, None, str(exc)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for p, asset, error in pool.map(convert, files):
            if error:
                errors.append({'source': p.relative_to(root).as_posix(), 'error': error})
            else:
                assets[p] = asset
    products = []
    for row, paths in zip(rows, mappings):
        number, sku = text(row['No']), text(row.get('SKU'))
        pid = stable_id(sku, number, sku_counts)
        if pid in ids:
            raise ValueError(f'Identity collision: {pid}')
        ids.add(pid)
        price, price_source, price_label = choose_price(row)
        photos = [{k: v for k, v in assets[p].items() if k not in ('sha256', 'sourceBytes')} for p in paths if p in assets and p not in shared]
        if paths and not photos:
            missing.append({'number': number, 'sku': sku, 'name': text(row.get('Product Name')), 'reference': text(row.get('Destination')), 'reason': 'Unreadable or ambiguous image'})
        products.append({'id': pid, 'number': row['No'], 'name': text(row.get('Product Name')), 'sku': sku,
                         'price': price, 'priceSource': price_source, 'priceLabel': price_label,
                         'prices': {k: row.get(k) if valid_price(row.get(k)) else None for k in ('Old Price (LKR)', 'Price (LKR)', 'Price 2 (LKR)')},
                         'category': text(row.get('Category')), 'description': text(row.get('Description')),
                         'page': row.get('Page'), 'images': photos,
                         'source': {'sheet': row['_sheet'], 'row': row['_row']}})
    version = hashlib.sha256(json.dumps(products, sort_keys=True).encode()).hexdigest()[:16]
    dataset = {'version': version, 'currency': 'LKR', 'precision': 2, 'products': products,
               'categories': sorted({p['category'] for p in products if p['category']})}
    (public / 'catalogue.json').write_text(json.dumps(dataset, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    report = {'generatedAt': datetime.now(timezone.utc).isoformat(), 'workbook': workbook,
              'workbookSha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'catalogueVersion': version,
              'worksheets': sheets, 'productCount': len(products), 'imageFileCount': len(files),
              'mappedProducts': sum(bool(p['images']) for p in products), 'missingImages': missing,
              'duplicateSkus': duplicates, 'ambiguousMappings': ambiguities, 'invalidData': invalid,
              'imageErrors': errors, 'unreferencedImages': [p.relative_to(root).as_posix() for p in files if p not in used],
              'pricePolicy': 'Price (LKR), else Price 2 (LKR), else Old Price (LKR). Fallback labels are always visible; old prices are never represented as confirmed current prices.',
              'priceSources': dict(Counter(p['priceSource'] for p in products)),
              'imageManifest': list(assets.values()),
              'optimizedBytes': sum(p.stat().st_size for p in output.glob('*.webp'))}
    (reports / 'import-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    summary = f'''# AYM import validation\n\nProducts: {len(products):,}\n\nImage files inspected: {len(files):,}\n\nProducts with photographs: {report['mappedProducts']:,}\n\nMissing photographs: {len(missing)}\n\nDuplicate SKU groups: {len(duplicates)}\n\nAmbiguous mappings: {len(ambiguities)}\n\nInvalid/suspicious fields: {len(invalid)}\n\nUnreadable images: {len(errors)}\n\n## Pricing\n\n{report['pricePolicy']}\n\n{json.dumps(report['priceSources'], indent=2)}\n\nThe workbook contains no categories or descriptions; none are inferred. All rows, exact names and SKUs are retained. Unique valid SKUs identify products; duplicate/suspicious SKUs use the workbook No. Fixing a SKU can change that identity; index fallback preserves nearby browsing position. Keep No stable across updates.\n\n## Missing photographs\n\n| No | SKU | Product |\n|---|---|---|\n'''
    summary += '\n'.join(f"| {p['number']} | {p['sku']} | {p['name'].replace('|', '/')} |" for p in missing)
    summary += '\n\n## Duplicate SKUs\n\n' + '\n'.join(f"- {d['sku']}: product numbers {d['productNumbers']}" for d in duplicates)
    summary += '\n\nThe JSON report contains every mapping, source checksum, worksheet, invalid field and image error. Originals were opened read-only.\n'
    (reports / 'import-report.md').write_text(summary, encoding='utf-8')
    make_icons(public)
    print(f'Imported {len(products):,} products; {report["mappedProducts"]:,} with photos; {len(missing)} missing. Optimized assets: {report["optimizedBytes"] / 1024 / 1024:.1f} MB.', flush=True)
    return dataset, report

def make_icons(public):
    folder = public / 'icons'
    folder.mkdir(exist_ok=True)
    for size, filename in [(180, 'apple-touch-icon.png'), (192, 'icon-192.png'), (512, 'icon-512.png')]:
        icon = Image.new('RGB', (size, size), '#234e45')
        draw = ImageDraw.Draw(icon)
        try:
            font = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', size // 3)
        except OSError:
            font = ImageFont.load_default(size=size // 3)
        draw.text((size/2, size/2), 'AYM', fill='#fffdf8', font=font, anchor='mm')
        icon.save(folder / filename)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workbook', default='AYM_Products.xlsx')
    parser.add_argument('--workers', type=int, default=6)
    args = parser.parse_args()
    import_catalogue(workbook=args.workbook, workers=args.workers)
