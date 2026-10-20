import collections
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from PIL import Image
import openpyxl

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from import_catalogue import choose_price, map_references, stable_id

class CatalogueImportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dataset = json.loads((ROOT / 'public/catalogue.json').read_text(encoding='utf-8'))
        cls.report = json.loads((ROOT / 'reports/import-report.json').read_text(encoding='utf-8'))
        book = openpyxl.load_workbook(ROOT / 'AYM_Products.xlsx', read_only=True, data_only=True)
        values = list(book['Products'].values)
        cls.rows = [dict(zip(values[0], row)) for row in values[1:]]
        book.close()

    def test_every_row_and_exact_name_sku_price(self):
        products = self.dataset['products']
        self.assertEqual(len(products), len(self.rows))
        self.assertEqual(len(products), 2274)
        self.assertEqual(len(set(p['id'] for p in products)), len(products))
        for product, row in zip(products, self.rows):
            self.assertEqual(product['name'], str(row['Product Name']).strip())
            self.assertEqual(product['sku'], str(row['SKU']).strip())
            self.assertEqual(product['number'], row['No'])
            self.assertEqual((product['price'], product['priceSource'], product['priceLabel']), choose_price(row))
            self.assertEqual(product['prices'], {k: row[k] for k in ['Old Price (LKR)', 'Price (LKR)', 'Price 2 (LKR)']})

    def test_every_image_matches_its_explicit_destination(self):
        for product, row in zip(self.dataset['products'], self.rows):
            if product['images']:
                self.assertEqual(product['images'][0]['source'], row['Destination'])
                for image in product['images']:
                    self.assertTrue((ROOT / 'public' / image['src']).is_file())
                    self.assertTrue((ROOT / 'public' / image['thumbnail']).is_file())
            else:
                self.assertEqual(row['Destination'], '(image missing)')
        self.assertEqual(len(self.report['missingImages']), 54)
        self.assertEqual(self.report['mappedProducts'], 2220)
        self.assertEqual(self.report['ambiguousMappings'], [])
        self.assertEqual(self.report['imageErrors'], [])

    def test_report_catches_all_duplicate_and_suspicious_ids(self):
        counts = collections.Counter(str(row['SKU']) for row in self.rows)
        self.assertEqual({d['sku']: d['count'] for d in self.report['duplicateSkus']}, {s: n for s, n in counts.items() if n > 1})
        self.assertTrue(any(d['issue'] == 'Numeric-only product name' for d in self.report['invalidData']))
        self.assertEqual(self.dataset['categories'], [])

    def test_original_source_checksums(self):
        self.assertEqual(hashlib.sha256((ROOT / 'AYM_Products.xlsx').read_bytes()).hexdigest(), self.report['workbookSha256'])
        for image in self.report['imageManifest']:
            original = ROOT / image['source']
            self.assertEqual(original.stat().st_size, image['sourceBytes'])
            self.assertEqual(hashlib.sha256(original.read_bytes()).hexdigest(), image['sha256'])

    def test_price_fallbacks_are_explicit_and_zero_is_valid(self):
        self.assertEqual(choose_price({'Price (LKR)': 0})[0], 0)
        self.assertEqual(choose_price({'Old Price (LKR)': 220})[2], 'Last listed price')
        self.assertEqual(choose_price({'Price 2 (LKR)': 100})[2], 'Price 2')
        self.assertIsNone(choose_price({'Price (LKR)': -10})[0])
        self.assertIsNone(choose_price({'Price (LKR)': float('nan')})[0])

    def test_mapping_never_guesses_and_gallery_is_explicit(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'images').mkdir()
            for name in ['one.jpg', 'two.jpg']:
                Image.new('RGB', (16, 16)).save(root / 'images' / name)
            paths, missing, ambiguous = map_references({'Destination': 'images/one.jpg;images/two.jpg'}, root, {})
            self.assertEqual(len(paths), 2)
            self.assertEqual(missing, [])
            paths, _, _ = map_references({'Destination': '(image missing)', 'SKU': 'one'}, root, {'one': [root / 'images/one.jpg']})
            self.assertEqual(paths, [])
            self.assertEqual(map_references({'Destination': '../private.jpg'}, root, {})[0], [])
            self.assertEqual(len(map_references({'SKU': 'same'}, root, {'same': [root / 'images/one.jpg', root / 'images/two.jpg']})[2]), 2)

    def test_stable_ids_survive_reordering(self):
        self.assertEqual(stable_id('ABC', '1', {'ABC': 1}), stable_id('ABC', '9', {'ABC': 1}))
        self.assertNotEqual(stable_id('DUP', '1', {'DUP': 2}), stable_id('DUP', '2', {'DUP': 2}))
        self.assertEqual(stable_id('LKR', '5', {'LKR': 47}), 'aym-5')

if __name__ == '__main__':
    unittest.main()
