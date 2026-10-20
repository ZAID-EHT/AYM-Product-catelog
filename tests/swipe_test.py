"""Regression for left-to-next/right-to-previous navigation and catalogue boundaries."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'test-results'
OUTPUT.mkdir(exist_ok=True)
PRODUCTS = json.loads((ROOT / 'public/catalogue.json').read_text(encoding='utf-8'))['products']
results = []

def position(page, number):
    expect(page.get_by_test_id('position')).to_have_text(f'{number} / 2,274')

def swipe(page, name, dx, dy=0):
    area = page.get_by_test_id('swipe-area')
    area.scroll_into_view_if_needed()
    rect = area.bounding_box()
    x, y = rect['x'] + rect['width']/2, rect['y'] + rect['height']/2
    if name == 'chromium':
        cdp = page.context.new_cdp_session(page)
        cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
        for i in range(1,9):
            cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x+dx*i/8,'y':y+dy*i/8}]})
        cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
        cdp.detach()
    else:
        page.mouse.move(x,y); page.mouse.down()
        page.mouse.move(x+dx,y+dy,steps=8); page.mouse.up()

with sync_playwright() as playwright:
    for name in ['chromium','webkit']:
        browser = getattr(playwright,name).launch(headless=True)
        context = browser.new_context(viewport={'width':393,'height':852},is_mobile=True,has_touch=True,reduced_motion='reduce')
        page = context.new_page()
        errors = []
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto('http://127.0.0.1:4173'); page.wait_for_load_state('networkidle'); position(page,1)
        expect(page.locator('.swipe-hint')).to_contain_text('Swipe left for next')
        expect(page.locator('.swipe-hint')).to_contain_text('right for previous')
        swipe(page,name,110); position(page,1)
        swipe(page,name,-110); position(page,2)
        swipe(page,name,110); position(page,1)
        swipe(page,name,10,110); position(page,1)
        swipe(page,name,-110); position(page,2)
        page.reload(); page.wait_for_load_state('networkidle'); position(page,2)
        page.keyboard.press('ArrowRight'); position(page,3)
        page.get_by_role('button',name='Previous product',exact=True).click(); position(page,2)
        page.goto('http://127.0.0.1:4173/?product='+PRODUCTS[-1]['id']); position(page,2274)
        swipe(page,name,-110); position(page,2274)
        swipe(page,name,110); position(page,2273)
        page.get_by_role('navigation',name='Main navigation').get_by_role('button',name='Home',exact=True).click(); position(page,2)
        assert not errors, errors
        results.append({'browser':name,'status':'passed','checks':['left swipe next','right swipe previous','first and last boundaries','vertical scroll rejection','updated hint','reload persistence','exploration preserves Home','keyboard and buttons retain expected behavior']})
        print(f'PASS [{name}] left=next, right=previous, boundaries, persistence and controls',flush=True)
        context.close(); browser.close()

(OUTPUT / 'swipe-results.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
