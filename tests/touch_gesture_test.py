"""Finger swipe regressions. Start the production preview on 4173 first.

Chromium uses browser-dispatched touch input. Both engines additionally exercise
the Touch Events path without Pointer Events and with pointer cancellation, to
cover the fallback used by mobile Safari. No physical-device testing claim.
"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('AYM_TEST_URL', 'http://127.0.0.1:4173')
PRODUCTS = json.loads((ROOT / 'public/catalogue.json').read_text(encoding='utf-8'))['products']


def swipe(page, selector, dx, dy=0, native=False, cancel_pointer=False):
    area = page.locator(selector)
    area.scroll_into_view_if_needed()
    r = area.bounding_box()
    x = r['x'] + r['width'] * (0.8 if dx < 0 else 0.2)
    y = r['y'] + r['height'] / 2
    if native:
        session = page.context.new_cdp_session(page)
        session.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
        for step in range(1, 9):
            session.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x+dx*step/8, 'y': y+dy*step/8}]})
            page.wait_for_timeout(20)
        session.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        session.detach()
    else:
        area.evaluate('''(element, {x,y,dx,dy,cancel}) => {
          // Desktop WebKit exposes Touch but disallows its constructor. Build
          // the event payload explicitly for this synthetic fallback-path test.
          const touch = (x,y) => ({identifier: 71, target: element, clientX:x, clientY:y});
          const send = (type, points, changed) => {
            const event = new Event(type, {bubbles:true, cancelable:true});
            Object.defineProperties(event, {
              touches:{value:points}, targetTouches:{value:points}, changedTouches:{value:changed},
            });
            element.dispatchEvent(event);
          };
          send('touchstart', [touch(x,y)], [touch(x,y)]);
          if (cancel) element.dispatchEvent(new PointerEvent('pointercancel', {bubbles:true, pointerType:'touch', pointerId:71}));
          for (let i=1;i<=8;i++) send('touchmove', [touch(x+dx*i/8,y+dy*i/8)], [touch(x+dx*i/8,y+dy*i/8)]);
          send('touchend', [], [touch(x+dx,y+dy)]);
        }''', {'x': x, 'y': y, 'dx': dx, 'dy': dy, 'cancel': cancel_pointer})


def position(page, n):
    expect(page.get_by_test_id('position')).to_have_text(f'{n} / 2,274')


def fullscreen_name(page, n):
    expect(page.get_by_test_id('fullscreen-product-name')).to_have_text(PRODUCTS[n-1]['name'])


with sync_playwright() as p:
    for engine in ['chromium', 'webkit']:
        browser = getattr(p, engine).launch()
        for native in ([False, True] if engine == 'chromium' else [False]):
            context = browser.new_context(viewport={'width':393,'height':650}, is_mobile=True,
                                          has_touch=True, reduced_motion='reduce')
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(BASE)
            page.wait_for_load_state('networkidle')
            position(page, 1)
            # The entire product area works, not just the middle of the photograph.
            for selector in ['[data-testid="product-name"]', '.photo-open', '.product-code']:
                swipe(page, selector, -100, native=native, cancel_pointer=not native)
                position(page, 2)
                expect(page.get_by_role('dialog')).not_to_be_visible()
                swipe(page, selector, 100, native=native)
                position(page, 1)
            swipe(page, '[data-testid="product-name"]', 100, native=native)
            position(page, 1)
            swipe(page, '.photo-open', 8, 90, native=native)
            position(page, 1)
            expect(page.get_by_role('dialog')).not_to_be_visible()
            if native:
                page.locator('main').evaluate('(element)=>element.scrollTop=0')
                swipe(page, '.photo-open', 5, -100, native=True)
                page.wait_for_timeout(200)
                assert page.locator('main').evaluate('(element)=>element.scrollTop') > 0
                position(page, 1)
            swipe(page, '.photo-open', -100, native=native)
            position(page, 2)
            # Main viewer remounts after visiting Search and Saved.
            nav = page.get_by_role('navigation', name='Main navigation')
            for section in ['Search', 'Saved']:
                nav.get_by_role('button', name=section, exact=True).click()
                nav.get_by_role('button', name='Home', exact=True).click()
                swipe(page, '.photo-open', -100, native=native)
            position(page, 4)
            page.reload()
            position(page, 4)
            page.get_by_role('button', name='Expand product image').click()
            for selector in ['.zoom-viewport', '[data-testid="fullscreen-product-name"]']:
                swipe(page, selector, -100, native=native, cancel_pointer=not native)
                fullscreen_name(page, 5)
                swipe(page, selector, 100, native=native)
                fullscreen_name(page, 4)
            swipe(page, '.zoom-viewport', 5, 90, native=native)
            fullscreen_name(page, 4)
            page.get_by_role('button', name='Zoom in', exact=True).click()
            swipe(page, '.zoom-viewport', -100, native=native)
            fullscreen_name(page, 4)
            page.get_by_role('button', name='Reset', exact=True).click()
            swipe(page, '.zoom-viewport', -100, native=native)
            fullscreen_name(page, 5)
            page.get_by_role('button', name='Close dialog', exact=True).click()
            # A missing photograph is still a swipe surface.
            missing = next(product for product in PRODUCTS if not product['images'])
            page.goto(BASE + '/?product=' + missing['id'])
            n = PRODUCTS.index(missing) + 1
            swipe(page, '.photo-open', -100, native=native)
            position(page, n+1)
            page.goto(BASE + '/?product=' + PRODUCTS[-1]['id'])
            swipe(page, '.photo-open', -100, native=native)
            position(page, len(PRODUCTS))
            swipe(page, '.photo-open', 100, native=native)
            position(page, len(PRODUCTS)-1)
            assert not errors, errors
            print(f'PASS [{engine}, {"browser touch" if native else "Touch Events fallback"}] names/photos, both directions, pointer cancellation, remounts, fullscreen, zoom isolation, missing photos, boundaries', flush=True)
            context.close()
        browser.close()
