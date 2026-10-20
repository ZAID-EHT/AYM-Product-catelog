"""Verify exported cards contain exactly the source photograph and full product name."""
import json
from pathlib import Path
from PIL import Image, ImageStat
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
PRODUCTS = json.loads((ROOT / 'public/catalogue.json').read_text(encoding='utf-8'))['products']
OUTPUT = ROOT / 'test-results'
OUTPUT.mkdir(exist_ok=True)
results = []

with sync_playwright() as playwright:
    for name in ['chromium', 'webkit']:
        browser = getattr(playwright, name).launch(headless=True)
        context = browser.new_context(viewport={'width':393,'height':852},is_mobile=True,has_touch=True,accept_downloads=True)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        cases = [PRODUCTS[1], max(PRODUCTS,key=lambda p:len(p['name'])), PRODUCTS[102]]
        for product in cases:
            page.goto('http://127.0.0.1:4173/?product=' + product['id'])
            page.wait_for_load_state('networkidle')
            expect(page.get_by_test_id('product-name')).to_have_text(product['name'])
            if product['number'] == 2:
                expect(page.get_by_test_id('product-price')).to_have_text('LKR 220.00')
                expect(page.get_by_text(product['sku'],exact=True)).to_be_visible()
            page.evaluate("""() => {
              window.__exportText=[];window.__exportPhotos=[];
              const text=CanvasRenderingContext2D.prototype.fillText;
              const photo=CanvasRenderingContext2D.prototype.drawImage;
              CanvasRenderingContext2D.prototype.fillText=function(value,...args){window.__exportText.push(value);return text.call(this,value,...args)};
              CanvasRenderingContext2D.prototype.drawImage=function(image,...args){window.__exportPhotos.push(image.src);return photo.call(this,image,...args)};
              Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>false});
            }""")
            page.get_by_role('button',name='Share product',exact=True).click()
            download_button = page.get_by_role('button',name='Download image',exact=True)
            expect(download_button).to_be_enabled(timeout=15000)
            assert ' '.join(page.evaluate('window.__exportText')) == ' '.join(product['name'].split())
            photos = page.evaluate('window.__exportPhotos')
            assert len(photos) == (1 if product['images'] else 0)
            if photos:
                assert photos[0].endswith('/' + product['images'][0]['src'])
            if product['number'] == 2:
                with page.expect_download() as download_info:
                    download_button.click()
                download = download_info.value
                path = OUTPUT / f'{name}-photo-and-name-only.png'
                download.save_as(str(path))
                image = Image.open(path).convert('RGB')
                assert image.width == 1080 and image.height >= 1180
                assert sum(ImageStat.Stat(image.crop((100,100,980,980))).stddev) > 50
                assert product['sku'] not in download.suggested_filename
                page.get_by_role('button',name='Close dialog',exact=True).click()
                page.evaluate("""() => {
                  window.__nativeFile=null;
                  Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});
                  Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.__nativeFile={type:data.files[0].type,size:data.files[0].size,title:data.title,active:navigator.userActivation.isActive}}});
                }""")
                page.get_by_role('button',name='Share product',exact=True).click()
                native_button = page.get_by_role('button',name='Share image',exact=True)
                expect(native_button).to_be_enabled(timeout=15000)
                native_button.click()
                payload = page.evaluate('window.__nativeFile')
                assert payload['type'] == 'image/png' and payload['size'] > 10000 and payload['active']
                assert payload['title'] == product['name']
                # Both generations may wrap the title over several lines; no other text is drawn.
                drawn = ' '.join(page.evaluate('window.__exportText'))
                title = ' '.join(product['name'].split())
                assert drawn == title + ' ' + title
            page.get_by_role('button',name='Close dialog',exact=True).click()
        assert errors == [], errors
        results.append({'browser':name,'status':'passed','checks':['photo and full name only','no added price/SKU/branding/labels','actual photograph retained','downloaded PNG decoded','long names','missing-image icon without extra text','native file-sharing payload','catalogue prices and codes retained']})
        print(f'PASS [{name}] photo-and-name-only exports, download, native sharing and unchanged catalogue details',flush=True)
        context.close(); browser.close()

(OUTPUT / 'share-export-results.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
