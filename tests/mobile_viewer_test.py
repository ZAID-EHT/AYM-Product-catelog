"""Production regressions for Safari-sized viewports and fullscreen product browsing.

Start npm run preview on port 4173 first. These are emulated browsers, not a
claim of testing on a physical iPhone or opening a real native share sheet.
"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'test-results'
OUT.mkdir(exist_ok=True)
PRODUCTS = json.loads((ROOT / 'public/catalogue.json').read_text(encoding='utf-8'))['products']
BASE = 'http://127.0.0.1:4173'


def swipe(page, engine, dx, dy=0):
    rect = page.locator('.zoom-viewport').bounding_box()
    x, y = rect['x'] + rect['width']/2, rect['y'] + rect['height']/2
    if engine == 'chromium':
        session = page.context.new_cdp_session(page)
        session.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
        for i in range(1, 9):
            session.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x+dx*i/8, 'y': y+dy*i/8}]})
        session.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        session.detach()
    else:
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x+dx, y+dy, steps=8)
        page.mouse.up()


def name(page, index):
    expect(page.get_by_test_id('fullscreen-product-name')).to_have_text(PRODUCTS[index]['name'])


with sync_playwright() as playwright:
    for engine in ['chromium', 'webkit']:
        browser = getattr(playwright, engine).launch()
        context = browser.new_context(viewport={'width': 393, 'height': 650}, is_mobile=True,
                                      has_touch=True, reduced_motion='reduce', accept_downloads=True)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(BASE)
        page.wait_for_load_state('networkidle')
        # Both themes must use the actual foreground/background tokens, including
        # inherited icons. Safari's smaller browser viewport must never let the
        # photograph escape its frame or let the tabs cover the scrolling area.
        for theme in ['light', 'dark']:
            page.emulate_media(color_scheme=theme)
            for height in [620, 650, 852]:
                page.set_viewport_size({'width': 393, 'height': height})
                checks = page.evaluate('''() => {
                  const rect = s => document.querySelector(s).getBoundingClientRect();
                  const frame = rect('.photograph-frame'), image = rect('.photo-open');
                  const title = rect('[data-testid="product-name"]');
                  const main = rect('main'), nav = rect('.bottom-nav');
                  const root = getComputedStyle(document.documentElement);
                  const save = getComputedStyle(document.querySelector('.action-button'));
                  return { imageFits: image.bottom <= frame.bottom + 1,
                    titleClear: title.top >= frame.bottom,
                    navSeparate: main.bottom <= nav.top,
                    navFits: nav.bottom <= innerHeight,
                    color: root.color, background: root.backgroundColor,
                    saveColor: save.color, saveBackground: save.backgroundColor };
                }''')
                assert all(checks[k] for k in ['imageFits', 'titleClear', 'navSeparate', 'navFits']), checks
                assert checks['color'] == ('rgb(233, 238, 232)' if theme == 'dark' else 'rgb(36, 51, 45)'), checks
                assert checks['background'] == ('rgb(21, 27, 24)' if theme == 'dark' else 'rgb(246, 245, 242)'), checks
                assert checks['saveColor'] == checks['color'], checks
                assert checks['saveColor'] != checks['saveBackground'], checks
            page.set_viewport_size({'width': 393, 'height': 650})
            page.screenshot(path=str(OUT / f'{engine}-short-iphone-{theme}.png'))
        page.add_style_tag(content=':root { --safe-top: 59px; --safe-bottom: 34px; }')
        nav = page.locator('.bottom-nav').bounding_box()
        assert nav['y'] + nav['height'] <= 650 - 34
        page.get_by_role('button', name='Save product', exact=True).click()
        expect(page.get_by_role('button', name='Remove from Saved', exact=True)).to_have_attribute('aria-pressed', 'true')
        page.get_by_role('button', name='Share product', exact=True).click()
        with page.expect_download() as pending:
            page.get_by_role('button', name='Download image', exact=True).click(timeout=15000)
        assert pending.value.suggested_filename.endswith('.png')
        page.get_by_role('button', name='Close dialog', exact=True).click()
        page.get_by_role('button', name='Expand product image', exact=True).click()
        name(page, 0)
        expect(page.get_by_role('button', name='Previous fullscreen product')).to_be_disabled()
        swipe(page, engine, 110)
        name(page, 0)
        swipe(page, engine, -110)
        name(page, 1)
        swipe(page, engine, 110)
        name(page, 0)
        swipe(page, engine, 5, 100)
        name(page, 0)
        page.get_by_role('button', name='Next fullscreen product').click()
        name(page, 1)
        page.keyboard.press('ArrowRight')
        name(page, 2)
        page.keyboard.press('ArrowLeft')
        name(page, 1)
        page.get_by_role('button', name='Zoom in', exact=True).click()
        swipe(page, engine, -110)
        name(page, 1)
        expect(page.locator('.zoom-toolbar > span')).to_have_text('150%')
        page.get_by_role('button', name='Next fullscreen product').click()
        name(page, 2)
        expect(page.locator('.zoom-toolbar > span')).to_have_text('100%')
        controls = page.locator('.zoom-product-controls').bounding_box()
        title = page.get_by_test_id('fullscreen-product-name').bounding_box()
        assert title['y'] >= 59 and controls['y'] + controls['height'] <= 650 - 34
        page.screenshot(path=str(OUT / f'{engine}-fullscreen-iphone-dark.png'))
        # Resizing under browser chrome and landscape retains all fullscreen controls.
        for size in [{'width': 393, 'height': 620}, {'width': 852, 'height': 393}]:
            page.set_viewport_size(size)
            page.get_by_role('button', name='Next fullscreen product').click()
            rect = page.get_by_role('button', name='Next fullscreen product').bounding_box()
            assert rect['y'] + rect['height'] <= size['height']
        page.keyboard.press('Escape')
        page.reload()
        expect(page.get_by_test_id('position')).to_have_text('5 / 2,274')
        # Direct-link exploration keeps the saved Home place even in fullscreen.
        page.goto(BASE + '/?product=' + PRODUCTS[-1]['id'])
        page.get_by_role('button', name='Expand product image').click()
        name(page, len(PRODUCTS)-1)
        expect(page.get_by_role('button', name='Next fullscreen product')).to_be_disabled()
        swipe(page, engine, -110)
        name(page, len(PRODUCTS)-1)
        page.get_by_role('button', name='Previous fullscreen product').click()
        name(page, len(PRODUCTS)-2)
        page.keyboard.press('Escape')
        page.get_by_role('navigation', name='Main navigation').get_by_role('button', name='Home', exact=True).click()
        expect(page.get_by_test_id('position')).to_have_text('5 / 2,274')
        longest = max(PRODUCTS, key=lambda product: len(product['name']))
        page.set_viewport_size({'width': 393, 'height': 620})
        page.goto(BASE + '/?product=' + longest['id'])
        page.evaluate("document.documentElement.style.fontSize='150%'")
        page.get_by_role('button', name='Expand product image').click()
        expect(page.get_by_test_id('fullscreen-product-name')).to_have_text(longest['name'])
        assert page.get_by_test_id('fullscreen-product-name').evaluate('(el)=>el.scrollWidth<=el.clientWidth')
        page.get_by_role('button', name='Close dialog', exact=True).click()
        assert not errors, errors
        print(f'PASS [{engine}] mobile themes/layout, safe areas, Save/download, fullscreen names/swipes/bounds, zoom isolation, resizing, Home persistence', flush=True)
        context.close()
        browser.close()
