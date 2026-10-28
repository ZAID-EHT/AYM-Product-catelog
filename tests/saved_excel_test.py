"""Download real Saved exports and verify offline XLSX data and embedded media."""
import io
import json
import os
from pathlib import Path
import zipfile
import xml.etree.ElementTree as ET
from PIL import Image
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'test-results'
OUT.mkdir(exist_ok=True)
BASE = os.environ.get('AYM_TEST_URL', 'http://127.0.0.1:4173')
DATA = json.loads((ROOT / 'public/catalogue.json').read_text(encoding='utf-8'))
PRODUCTS = DATA['products']
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'd': 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',
      'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
PICKED = list(PRODUCTS[:45])
for product in [next(p for p in PRODUCTS if not p['images']),
                max(PRODUCTS, key=lambda p: len(p['name'])),
                next(p for p in PRODUCTS if p['priceSource'] == 'Price 2 (LKR)')]:
    if product not in PICKED:
        PICKED.append(product)
PICKED.sort(key=lambda p: p['number'])


def inspect_export(path, products):
    with zipfile.ZipFile(path) as archive:
        strings = ET.fromstring(archive.read('xl/sharedStrings.xml'))
        shared = [''.join(node.itertext()) for node in strings]
        sheet = ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))
        styles = ET.fromstring(archive.read('xl/styles.xml')).find('s:cellXfs', NS)
        rows = sheet.findall('s:sheetData/s:row', NS)
        assert len(rows) == len(products) + 1
        assert sheet.find('s:autoFilter', NS).get('ref') == f'A1:N{len(rows)}'
        assert sheet.find('s:sheetViews/s:sheetView/s:pane', NS).get('ySplit') == '1'
        def value(cell):
            v = cell.find('s:v', NS)
            if v is None:
                return None
            return shared[int(v.text)] if cell.get('t') == 's' else float(v.text)
        assert [value(c) for c in rows[0]][:9] == ['No', 'Image', 'Product Name', 'SKU', 'Old Price (LKR)', 'Price (LKR)', 'Price 2 (LKR)', 'Page', 'Destination']
        row_heights = {}
        for row, product in zip(rows[1:], products):
            row_heights[int(row.get('r'))-1] = float(row.get('ht')) * 4 / 3
            cells = {''.join(filter(str.isalpha, c.get('r'))): c for c in row}
            assert value(cells['A']) == product['number']
            assert value(cells['C']) == product['name']
            assert value(cells['D']) == (product['sku'] or None)
            assert styles[int(cells['D'].get('s'))].get('numFmtId') == '49', 'SKU format must preserve leading zeros'
            assert cells['C'].find('s:f', NS) is None, 'Names must remain literal text'
            for col, expected in [('E', product['prices']['Old Price (LKR)']),
                                  ('F', product['prices']['Price (LKR)']),
                                  ('G', product['prices']['Price 2 (LKR)']), ('J', product['price'])]:
                assert value(cells[col]) == expected
                if expected is not None:
                    assert cells[col].get('t') != 's', 'Prices must be numeric'
            assert value(cells['K']) == product['priceLabel']
            assert value(cells['M']) == (product['description'] or None)
            if not product['images']:
                assert value(cells['B']) == 'Photograph unavailable'
        media = [name for name in archive.namelist() if name.startswith('xl/media/') and not name.endswith('/')]
        assert len(media) == sum(len(p['images']) for p in products)
        for name in media:
            image = Image.open(io.BytesIO(archive.read(name)))
            assert image.format == 'JPEG' and 0 < max(image.size) <= 640
        drawing = ET.fromstring(archive.read('xl/drawings/drawing1.xml'))
        anchors_by_row = {}
        for anchor in drawing:
            point = anchor.find('d:from', NS)
            row = int(point.find('d:row', NS).text)
            assert point.find('d:col', NS).text == '1'
            extent = anchor.find('d:ext', NS)
            x = int(point.find('d:colOff', NS).text) / 9525
            y = int(point.find('d:rowOff', NS).text) / 9525
            w, h = int(extent.get('cx')) / 9525, int(extent.get('cy')) / 9525
            assert x >= 0 and x+w <= 194.1 and y >= 0 and y+h <= row_heights[row]+0.1
            anchors_by_row.setdefault(row, []).append((x, y, w, h))
            assert anchor.find('.//a:blip', NS).get('{'+NS['r']+'}embed')
        for i, product in enumerate(products, 1):
            boxes = anchors_by_row.get(i, [])
            assert len(boxes) == len(product['images'])
            for a, box in enumerate(boxes):
                for other in boxes[a+1:]:
                    assert (box[0]+box[2] <= other[0]+0.1 or other[0]+other[2] <= box[0]+0.1
                            or box[1]+box[3] <= other[1]+0.1 or other[1]+other[3] <= box[1]+0.1)
        rels = ET.fromstring(archive.read('xl/drawings/_rels/drawing1.xml.rels'))
        assert all(rel.get('TargetMode') != 'External' for rel in rels), 'Photos must be embedded, never remote links'


def download(page, name):
    button = page.get_by_role('button', name='Download Excel', exact=True)
    expect(button).to_be_enabled(timeout=90000)
    with page.expect_download() as pending:
        button.click()
    assert pending.value.suggested_filename.endswith('.xlsx')
    path = OUT / name
    pending.value.save_as(str(path))
    return path


with sync_playwright() as p:
    for engine in ['chromium', 'webkit']:
        browser = getattr(p, engine).launch()
        context = browser.new_context(viewport={'width':393,'height':650}, is_mobile=True,
                                      has_touch=True, accept_downloads=True, reduced_motion='reduce', service_workers='block')
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(BASE + '/?view=saved')
        page.wait_for_load_state('networkidle')
        expect(page.get_by_role('button', name='Export all Saved to Excel')).to_be_disabled()
        page.evaluate('(ids)=>localStorage.setItem("aym.saved.v1",JSON.stringify(ids))', [p['id'] for p in PICKED])
        page.reload()
        before = page.evaluate('({saved:localStorage.getItem("aym.saved.v1"),home:localStorage.getItem("aym.home.v1")})')
        # A filter and the 40-card render limit must not omit any saved records.
        page.get_by_role('searchbox', name='Search saved products').fill(PICKED[0]['sku'])
        page.get_by_role('button', name='Export all Saved to Excel').click()
        path = download(page, f'{engine}-saved-export.xlsx')
        inspect_export(path, PICKED)
        page.get_by_role('button', name='Close dialog', exact=True).click()
        assert page.evaluate('({saved:localStorage.getItem("aym.saved.v1"),home:localStorage.getItem("aym.home.v1")})') == before
        page.get_by_role('button', name='Export all Saved to Excel').click()
        page.get_by_role('button', name='Close dialog', exact=True).click()
        expect(page.get_by_role('dialog')).not_to_be_visible()
        assert not errors, errors
        context.close()
        # A failed photograph must expose retry rather than silently omit it.
        context = browser.new_context(accept_downloads=True, service_workers='block')
        page = context.new_page()
        page.add_init_script('localStorage.setItem("aym.saved.v1",'+json.dumps(json.dumps([PRODUCTS[0]['id']]))+')')
        photo_route = '**/' + PRODUCTS[0]['images'][0]['src']
        page.route(photo_route, lambda route: route.fulfill(status=503, body='Unavailable'))
        page.goto(BASE + '/?view=saved')
        page.get_by_role('button', name='Export all Saved to Excel').click()
        expect(page.get_by_role('alert')).to_contain_text('Could not include the photo')
        expect(page.get_by_role('button', name='Download Excel', exact=True)).to_be_disabled()
        page.unroute(photo_route)
        page.get_by_role('button', name='Try again', exact=True).click()
        inspect_export(download(page, f'{engine}-saved-retry.xlsx'), PRODUCTS[:1])
        context.close()
        # Boundary fixture: zero price, literal formula-like name, leading-zero
        # SKU, description, and three actual embedded photos in the same row.
        context = browser.new_context(accept_downloads=True, service_workers='block')
        page = context.new_page()
        fixture = json.loads(json.dumps(DATA))
        item = fixture['products'][0]
        item.update(name='=2+2', sku='00123', price=0, priceLabel='Price', description='All product text is retained.')
        item['prices'] = {'Old Price (LKR)': None, 'Price (LKR)': 0, 'Price 2 (LKR)': 12.5}
        item['images'] = [product['images'][0] for product in PRODUCTS[:3]]
        page.route('**/catalogue.json', lambda route: route.fulfill(json=fixture))
        page.add_init_script('localStorage.setItem("aym.saved.v1",'+json.dumps(json.dumps([item['id']]))+')')
        page.goto(BASE + '/?view=saved')
        page.get_by_role('button', name='Export all Saved to Excel').click()
        inspect_export(download(page, f'{engine}-saved-gallery.xlsx'), [item])
        context.close()
        browser.close()
        print(f'PASS [{engine}] {len(PICKED)} saved rows, embedded offline photos, exact prices/blanks, search/pagination independence, cancellation, retry, zero price, literal text and gallery anchors', flush=True)
