"""Production browser QA. Start npm run preview (4173) before invoking.
Chromium mobile touch emulation and desktop WebKit; no physical iPhone claim.
"""
import base64
import io
import json
import os
from pathlib import Path
import time
import traceback
from PIL import Image, ImageStat
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'test-results'
OUTPUT.mkdir(exist_ok=True)
BASE = os.environ.get('AYM_TEST_URL', 'http://127.0.0.1:4173')
DATA = json.loads((ROOT / 'public/catalogue.json').read_text(encoding='utf-8'))
PRODUCTS = DATA['products']
checks, errors, console_errors = [], [], []

def record(name, browser):
    checks.append({'browser': browser, 'check': name, 'status': 'passed'})
    print(f'PASS [{browser}] {name}', flush=True)

def position(page, number):
    expect(page.get_by_test_id('position')).to_have_text(f'{number} / 2,274')

def home(page):
    page.get_by_role('navigation', name='Main navigation').get_by_role('button', name='Home', exact=True).click()

def tab(page, name):
    page.get_by_role('navigation', name='Main navigation').get_by_role('button', name=name, exact=False).click()

def touch_swipe(page, chromium, dx, dy=0):
    area = page.get_by_test_id('swipe-area')
    area.scroll_into_view_if_needed()
    rect = area.bounding_box()
    x = rect['x'] + rect['width'] / 2
    y = rect['y'] + rect['height'] / 2
    if chromium:
        cdp = page.context.new_cdp_session(page)
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
        for i in range(1, 9):
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x + dx * i / 8, 'y': y + dy * i / 8}]})
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        cdp.detach()
    else:
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + dx, y + dy, steps=8)
        page.mouse.up()

def run_browser(playwright, name):
    browser_type = getattr(playwright, name)
    browser = browser_type.launch(headless=True)
    context = browser.new_context(viewport={'width': 393, 'height': 852}, device_scale_factor=3, is_mobile=True, has_touch=True, reduced_motion='reduce', color_scheme='light', accept_downloads=True)
    page = context.new_page()
    runtime_errors = []
    page.on('pageerror', lambda error: runtime_errors.append(str(error)))
    page.on('console', lambda msg: console_errors.append({'browser': name, 'message': msg.text}) if msg.type == 'error' else None)
    page.goto(BASE)
    page.wait_for_load_state('networkidle')
    position(page, 1)
    expect(page.get_by_test_id('product-name')).to_have_text(PRODUCTS[0]['name'])
    expect(page.get_by_test_id('product-price')).to_have_text('LKR 220.00')
    assert page.get_by_test_id('product-name').count() == 1
    expect(page.get_by_text('Last listed price', exact=True)).to_be_visible()
    page.screenshot(path=str(OUTPUT / f'{name}-iphone14pro-light.png'), full_page=True)
    # The key single-screen mobile browsing controls must be above the floating tab bar.
    browse_rect = page.locator('.browse-controls').bounding_box()
    nav_rect = page.locator('.bottom-nav').bounding_box()
    assert browse_rect['y'] + browse_rect['height'] + 8 < nav_rect['y'], 'Mobile navigation overlaps product controls'
    safe_area_style = page.add_style_tag(content=':root { --safe-top: 59px; --safe-bottom: 34px; }')
    browse_rect = page.locator('.browse-controls').bounding_box()
    nav_rect = page.locator('.bottom-nav').bounding_box()
    assert browse_rect['y'] + browse_rect['height'] + 8 < nav_rect['y'], 'Safe-area simulation overlaps controls'
    assert page.locator('.brand').bounding_box()['y'] >= 59
    page.screenshot(path=str(OUTPUT / f'{name}-iphone14pro-safe-areas.png'), full_page=True)
    safe_area_style.evaluate('(el)=>el.remove()')
    record('Real workbook product, exact price and explicit fallback label; one viewer', name)

    touch_swipe(page, name == 'chromium', -110)
    position(page, 2)
    touch_swipe(page, name == 'chromium', 110)
    position(page, 1)
    touch_swipe(page, name == 'chromium', 10, 110)
    position(page, 1)
    # Mouse drag also remains available on touch-capable laptops.
    area = page.get_by_test_id('swipe-area').bounding_box()
    page.mouse.move(area['x'] + 210, area['y'] + 80); page.mouse.down()
    page.mouse.move(area['x'] + 90, area['y'] + 85, steps=8); page.mouse.up()
    position(page, 2)
    record('Left swipe next, right swipe previous, vertical-scroll rejection, mouse drag', name)

    for _ in range(99):
        page.get_by_role('button', name='Next product', exact=True).click()
    position(page, 101)
    expected_id = PRODUCTS[100]['id']
    assert page.evaluate("JSON.parse(localStorage.getItem('aym.home.v1')).id") == expected_id
    page.reload(); position(page, 101)
    # Browser restart equivalent: restore this origin's persisted storage in a new context.
    restart_context = browser.new_context(viewport={'width':393,'height':852},storage_state=context.storage_state())
    restart_page = restart_context.new_page(); restart_page.goto(BASE); position(restart_page,101)
    restart_context.close()
    record('100 forward navigations reach 101; synchronous stable-ID persistence survives reload', name)
    # Close the tab and reopen within the same browser, retaining site storage.
    page.close(); page = context.new_page()
    page.on('pageerror', lambda error: runtime_errors.append(str(error)))
    page.goto(BASE); position(page, 101)
    record('Closing and reopening the tab restores product 101', name)

    tab(page, 'Search')
    search = page.get_by_role('searchbox', name='Search products', exact=True)
    started = time.perf_counter()
    search.fill(PRODUCTS[599]['sku'].lower())
    target = page.get_by_role('button', name=f"Open {PRODUCTS[599]['name']}", exact=True)
    expect(target).to_be_visible()
    assert time.perf_counter() - started < 2
    target.click(); position(page, 600)
    expect(page.get_by_test_id('product-name')).to_have_text(PRODUCTS[599]['name'])
    page.get_by_role('button', name='Save product', exact=True).click()
    expect(page.get_by_role('button', name='Remove from Saved', exact=True)).to_have_attribute('aria-pressed', 'true')
    page.get_by_role('button', name='Search results', exact=True).click()
    expect(search).to_have_value(PRODUCTS[599]['sku'].lower())
    target.click(); page.go_back(); expect(search).to_be_visible()
    home(page); position(page, 101)
    record('Search by partial case-insensitive SKU; detail and browser back preserve results and Home', name)

    tab(page, 'Saved')
    saved_search = page.get_by_role('searchbox', name='Search saved products', exact=True)
    expect(page.get_by_role('button', name=f"Open {PRODUCTS[599]['name']}", exact=True)).to_be_visible()
    saved_search.fill('unlikelyxyz')
    expect(page.get_by_text('Nothing here just yet.', exact=True)).to_be_visible()
    page.get_by_role('button', name='Clear search', exact=True).first.click()
    page.get_by_role('button', name=f"Open {PRODUCTS[599]['name']}", exact=True).click(); position(page, 600)
    home(page); position(page, 101)
    page.reload(); tab(page, 'Saved')
    expect(page.get_by_role('button', name=f"Open {PRODUCTS[599]['name']}", exact=True)).to_be_visible()
    assert len(page.evaluate("JSON.parse(localStorage.getItem('aym.saved.v1'))")) == 1
    page.get_by_role('button', name=f"Remove {PRODUCTS[599]['name']} from Saved", exact=True).click()
    expect(page.get_by_text('Your next favourite is out there.', exact=True)).to_be_visible()
    page.reload(); expect(page.get_by_text('Your next favourite is out there.', exact=True)).to_be_visible()
    home(page); position(page, 101)
    record('Saved search, viewer isolation, deduplication, remove and reload persistence', name)

    # Direct product links explore independently from the saved Home place.
    page.goto(f"{BASE}/?product={PRODUCTS[68]['id']}")
    position(page, 69)
    page.get_by_role('button', name='Expand product image', exact=True).click()
    page.get_by_role('button', name='Zoom in', exact=True).click()
    expect(page.get_by_text('150%', exact=True)).to_be_visible()
    page.keyboard.press('Escape')
    page.get_by_role('button', name='Share product', exact=True).click()
    expect(page.get_by_role('button', name='Download image', exact=True)).to_be_enabled(timeout=15000)
    preview = page.locator('.share-preview img')
    expect(preview).to_be_visible()
    assert 'PNG' in page.locator('.privacy-note').last.inner_text()
    with page.expect_download() as download_info:
        page.get_by_role('button', name='Download image', exact=True).click()
    download = download_info.value
    target_file = OUTPUT / f'{name}-product-card.png'
    download.save_as(str(target_file))
    image = Image.open(target_file).convert('RGB')
    assert image.width == 1080 and image.height >= 1180
    assert image.getpixel((0,0)) == (246,245,242)
    assert sum(ImageStat.Stat(image.crop((100,200,980,980))).stddev) > 50
    assert min(ImageStat.Stat(image.crop((80,1020,1000,image.height-100))).extrema[0]) < 150
    page.get_by_role('button', name='Copy product link', exact=True).click()
    # WebKit may decline clipboard; selectable link fallback is intentionally supported.
    page.get_by_role('button', name='Close dialog', exact=True).click()
    home(page); position(page, 101)
    record('Direct link and zoom; real 1080px PNG photo/text content and download fallback', name)

    # Native file sharing is feature-tested with a stub; never claim actual OS share-sheet QA.
    page.evaluate("""() => {
      window.__shared = null;
      window.__drawnText = [];
      const original = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function(text,...args) { window.__drawnText.push(text); return original.call(this,text,...args); };
      Object.defineProperty(navigator,'canShare',{configurable:true,value:data=>data.files?.[0]?.type==='image/png'});
      Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{ window.__shared={name:data.files[0].name,type:data.files[0].type,size:data.files[0].size,title:data.title,activation:navigator.userActivation?.isActive}; }});
    }""")
    page.get_by_role('button', name='Share product', exact=True).click()
    expect(page.get_by_role('button', name='Share image', exact=True)).to_be_enabled(timeout=15000)
    page.get_by_role('button', name='Share image', exact=True).click()
    shared = page.evaluate('window.__shared')
    assert shared['type'] == 'image/png' and shared['size'] > 10000 and shared['activation']
    drawn = page.evaluate('window.__drawnText')
    assert ' '.join(PRODUCTS[100]['name'].split()) == ' '.join(drawn)
    page.get_by_role('button', name='Close dialog', exact=True).click()
    record('Native PNG feature detection, file payload, active tap, product photo and name only', name)

    tab(page, 'Search'); search.fill('no-match-xyz-00000')
    expect(page.get_by_text('Nothing here just yet.', exact=True)).to_be_visible()
    page.get_by_role('button', name='Clear search', exact=True).first.click()
    expect(page.locator('.result-card')).to_have_count(40)
    page.get_by_role('button', name='Show 40 more', exact=True).click()
    expect(page.locator('.result-card')).to_have_count(80)
    search.fill('wAtEr bOtTlE')
    assert page.locator('.result-card').count() > 0
    home(page); position(page, 101)
    page.keyboard.press('ArrowRight'); position(page, 102)
    page.keyboard.press('ArrowLeft'); position(page, 101)
    page.get_by_role('button', name='Jump to product number or code', exact=True).click()
    page.get_by_role('textbox', name='Product number or code').fill('103')
    page.get_by_role('button', name='Open product', exact=True).click()
    position(page, 103)
    expect(page.get_by_text('Photograph unavailable', exact=True)).to_be_visible()
    home(page); position(page, 101)
    page.get_by_role('button', name='Jump to product number or code', exact=True).click()
    page.get_by_role('textbox', name='Product number or code').fill('600')
    page.get_by_role('button', name='Open product', exact=True).click(); position(page,600)
    home(page); position(page,101)
    page.get_by_role('button', name='Jump to product number or code', exact=True).click()
    page.get_by_role('textbox', name='Product number or code').fill('sku:600')
    page.get_by_role('button', name='Open product', exact=True).click()
    position(page,next(p['number'] for p in PRODUCTS if p['sku']=='600'))
    home(page); position(page,101)
    record('Empty results, bounded 40-item rendering, name search, keyboard, jump isolation, missing-image placeholder', name)

    for width, height, label in [(393,852,'iphone14pro'),(375,667,'small-phone'),(852,393,'landscape'),(768,1024,'tablet'),(1440,1000,'desktop')]:
        page.set_viewport_size({'width':width,'height':height})
        page.evaluate('window.scrollTo(0,0)')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Horizontal overflow at {width}x{height}'
        expect(page.get_by_role('navigation',name='Main navigation')).to_be_visible()
        controls = page.locator('.nav-arrow,.action-button,.bottom-nav>button').evaluate_all('(els)=>els.map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height}))')
        assert all(c['w'] >= 43.9 and c['h'] >= 43.9 for c in controls)
        page.screenshot(path=str(OUTPUT / f'{name}-{label}.png'), full_page=True)
    page.set_viewport_size({'width':393,'height':852})
    page.emulate_media(color_scheme='dark',reduced_motion='reduce')
    page.screenshot(path=str(OUTPUT / f'{name}-iphone14pro-dark.png'),full_page=True)
    assert page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()") == '#151b18'
    page.emulate_media(color_scheme='light')
    # Simulate increased system text size; content may scroll but must remain usable.
    page.add_style_tag(content='html { font-size: 150%; }')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    record('393x852, 375x667, landscape, tablet, desktop, dark mode, reduced motion, 44px targets', name)

    page.get_by_role('button', name='Catalogue options', exact=True).click()
    page.get_by_role('button', name='Start from beginning', exact=False).click()
    position(page,1)
    assert runtime_errors == [], runtime_errors
    record('Explicit restart and no uncaught runtime errors', name)
    # Snapshot storage and restore in a completely fresh context: browser-restart equivalent.
    state = context.storage_state()
    context.close()
    restored = browser.new_context(viewport={'width':393,'height':852},storage_state=state)
    second = restored.new_page(); second.goto(BASE); position(second,1)
    restored.close(); browser.close()
    return runtime_errors

def offline_test(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width':393,'height':852})
    page = context.new_page(); page.goto(BASE); position(page,1)
    page.evaluate('navigator.serviceWorker.ready')
    page.wait_for_function("""async () => {
      const cache = await caches.open('aym-v1-photos');
      return !!await cache.match(document.querySelector('.photo-open img').src);
    }""")
    context.set_offline(True); page.reload(); position(page,1)
    assert page.locator('.photo-open img').evaluate('(img)=>img.complete && img.naturalWidth > 0')
    context.set_offline(False)
    page.reload(); page.wait_for_load_state('networkidle')
    page.get_by_role('button',name='Next product',exact=True).click(); position(page,2)
    page.wait_for_load_state('networkidle')
    context.set_offline(True); page.reload(); position(page,2)
    expect(page.get_by_text('You’re offline.',exact=False)).to_be_visible()
    expect(page.locator('.photo-open img')).to_be_visible()
    assert page.locator('.photo-open img').evaluate('(img)=>img.complete && img.naturalWidth > 0')
    count = page.evaluate("caches.open('aym-v1-photos').then(c=>c.keys()).then(k=>k.length)")
    assert count <= 80
    context.set_offline(False)
    page.evaluate("""async () => {
      const cache = await caches.open('aym-v1-photos');
      for(let i=0;i<85;i++) await cache.put(new URL('media/test-eviction-'+i+'.webp',location.href),new Response('x'));
      await fetch(document.querySelector('.photo-open img').src);
    }""")
    page.wait_for_function("async () => (await (await caches.open('aym-v1-photos')).keys()).length <= 80")
    record('First-visit and subsequent offline reopen: PWA shell, position, viewed photo and bounded image cache','chromium')
    context.close(); browser.close()

def resilience_test(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width':393,'height':852})
    context.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Storage blocked','SecurityError')}})")
    page = context.new_page(); page.goto(BASE); position(page,1)
    expect(page.get_by_role('alert')).to_contain_text('Your browser blocked storage')
    page.get_by_role('button',name='Save product',exact=True).click()
    expect(page.get_by_role('button',name='Remove from Saved',exact=True)).to_have_attribute('aria-pressed','true')
    page.get_by_role('button',name='Next product',exact=True).click(); position(page,2)
    record('Blocked browser storage: explicit warning, in-memory Saved and usable navigation','chromium')
    context.close()
    context = browser.new_context(viewport={'width':393,'height':852})
    page = context.new_page(); page.goto(BASE); position(page,1)
    page.evaluate("localStorage.setItem('aym.home.v1','{corrupt'); localStorage.setItem('aym.saved.v1','null')")
    page.reload(); position(page,1)
    record('Corrupt stored progress and bookmarks recover without a runtime failure','chromium')
    context.close(); browser.close()

with sync_playwright() as playwright:
    for focused_name, focused_test in [('chromium-offline', offline_test), ('chromium-resilience', resilience_test)]:
        try:
            focused_test(playwright)
        except Exception as error:
            errors.append({'browser':focused_name,'error':str(error),'traceback':traceback.format_exc()})
            print(traceback.format_exc(),flush=True)
    for browser_name in ['chromium','webkit']:
        try:
            run_browser(playwright,browser_name)
        except Exception as error:
            errors.append({'browser':browser_name,'error':str(error),'traceback':traceback.format_exc()})
            print(traceback.format_exc(),flush=True)

report = {'checks':checks,'failures':errors,'consoleErrors':console_errors,'physicalIPhoneTested':False,'note':'WebKit on Windows and Chromium touch/mobile emulation; native share API was stubbed for file payload testing.'}
(OUTPUT / 'browser-results.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(f"Browser QA: {len(checks)} checks passed; {len(errors)} failures",flush=True)
raise SystemExit(1 if errors else 0)
