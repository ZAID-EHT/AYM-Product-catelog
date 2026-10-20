"""Focused regression checks for numeric SKU collisions and long-name PNG cards."""
import base64
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / 'public/catalogue.json').read_text(encoding='utf-8'))
PRODUCTS = DATA['products']
OUTPUT = ROOT / 'test-results'
OUTPUT.mkdir(exist_ok=True)
results = []

def position(page, number):
    expect(page.get_by_test_id('position')).to_have_text(f'{number} / 2,274')

def jump(page, value):
    page.get_by_role('button', name='Jump to product number or code', exact=True).click()
    page.get_by_role('textbox', name='Product number or code').fill(value)
    page.get_by_role('button', name='Open product', exact=True).click()

def home(page):
    page.get_by_role('navigation', name='Main navigation').get_by_role('button', name='Home', exact=True).click()
    position(page, 101)

with sync_playwright() as playwright:
    for name in ['chromium', 'webkit']:
        browser = getattr(playwright, name).launch(headless=True)
        context = browser.new_context(viewport={'width':393,'height':852},is_mobile=True,has_touch=True,reduced_motion='reduce')
        context.add_init_script("localStorage.setItem('aym.home.v1'," + json.dumps(json.dumps({'id':PRODUCTS[100]['id'],'index':100,'version':DATA['version']})) + ")")
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto('http://127.0.0.1:4173'); position(page, 101)
        jump(page, '600'); position(page, 600); home(page)
        numeric_sku_product = next(p for p in PRODUCTS if p['sku'] == '600')
        jump(page, 'sku:600'); position(page, numeric_sku_product['number']); home(page)
        jump(page, '2516-SP')
        expect(page.get_by_role('alert')).to_contain_text('No unique product found')
        page.get_by_role('textbox',name='Product number or code').fill('123')
        page.get_by_role('button',name='Open product',exact=True).click(); position(page,123); home(page)

        longest = max(PRODUCTS, key=lambda p:len(p['name']))
        jump(page, str(longest['number'])); position(page,longest['number'])
        page.evaluate("""() => {
          window.__drawnText=[];
          const original=CanvasRenderingContext2D.prototype.fillText;
          CanvasRenderingContext2D.prototype.fillText=function(text,...args){window.__drawnText.push(text);return original.call(this,text,...args)};
        }""")
        page.get_by_role('button',name='Share product',exact=True).click()
        expect(page.locator('.share-preview img')).to_be_visible(timeout=15000)
        drawn = ' '.join(page.evaluate('window.__drawnText'))
        assert ' '.join(longest['name'].split()) == drawn
        encoded = page.locator('.share-preview img').evaluate("""async img=>{
          const blob=await (await fetch(img.src)).blob();
          return await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(blob)})
        }""")
        image_path = OUTPUT / f'{name}-long-name-card.png'
        image_path.write_bytes(base64.b64decode(encoded))
        exported = Image.open(image_path)
        assert exported.width == 1080 and exported.height >= 1180
        page.get_by_role('button',name='Close dialog',exact=True).click()
        home(page)
        if name == 'chromium':
            page.get_by_role('button',name='Expand product image',exact=True).click()
            r = page.locator('.zoom-viewport').bounding_box()
            x, y = r['x']+r['width']/2, r['y']+r['height']/2
            cdp = context.new_cdp_session(page)
            def fingers(distance):
                return [{'id':1,'x':x-distance/2,'y':y},{'id':2,'x':x+distance/2,'y':y}]
            cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':fingers(70)})
            cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':fingers(100)})
            cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':fingers(150)})
            cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
            zoom = page.locator('.zoom-toolbar>span').inner_text()
            assert int(zoom.rstrip('%')) > 100, zoom
            cdp.detach()
            page.get_by_role('button',name='Close dialog',exact=True).click()
        assert errors == [], errors
        results.append({'browser':name,'status':'passed','check':'Numeric number/SKU disambiguation, duplicate-code recovery, independent Home place, longest real product name in PNG' + (' and emulated two-finger pinch' if name=='chromium' else '')})
        print(f'PASS [{name}] numeric Jump, duplicate SKU, longest-name PNG and Home isolation',flush=True)
        context.close(); browser.close()

(OUTPUT / 'focused-results.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
