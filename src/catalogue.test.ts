import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  createSearchIndex,
  findJumpTarget,
  formatPrice,
  restoreIndex,
  searchProducts,
  swipeDirection,
} from './catalogue';
import { persist, readProgress, readSaved } from './persistence';
import { canShareFile } from './share';
import type { Product } from './types';
const products = [
  { id: 'sku-ABC', name: 'WATER BOTTLE', sku: 'ABC', number: 1, category: 'Kitchen' },
  { id: 'sku-XYZ', name: 'TOY BLOCKS', sku: 'XYZ', number: 2, category: 'Play' },
] as Product[];
afterEach(() => vi.unstubAllGlobals());
describe('independent browsing and search', () => {
  it('disambiguates workbook numbers from numeric SKUs and refuses duplicate codes', () => {
    const numeric = [products[0], { ...products[1], sku: '1' }];
    expect(findJumpTarget(numeric, '1')?.id).toBe(products[0].id);
    expect(findJumpTarget(numeric, 'SKU:1')?.id).toBe(products[1].id);
    expect(findJumpTarget(products, 'abc')?.id).toBe(products[0].id);
    expect(
      findJumpTarget(
        products.map((p) => ({ ...p, sku: 'DUP' })),
        'DUP',
      ),
    ).toBeUndefined();
    expect(findJumpTarget(products, '')).toBeUndefined();
  });
  it('restores stable IDs after catalogue reordering', () => {
    expect(restoreIndex([...products].reverse(), { id: 'sku-ABC', index: 0, version: 'old' })).toBe(
      1,
    );
  });
  it('falls back to nearby clamped position when a product disappears', () => {
    expect(restoreIndex(products, { id: 'removed', index: 100, version: '' })).toBe(1);
    expect(restoreIndex(products, { id: 'removed', index: -5, version: '' })).toBe(0);
  });
  it('matches names, partial SKU, category, and words without mutation', () => {
    const index = createSearchIndex(products);
    expect(searchProducts(index, 'bott wa')[0].id).toBe('sku-ABC');
    expect(searchProducts(index, 'xy')[0].id).toBe('sku-XYZ');
    expect(searchProducts(index, 'kitchen')[0].id).toBe('sku-ABC');
    expect(searchProducts(index, 'missing')).toEqual([]);
    expect(searchProducts(index, '', 'Play')).toEqual([products[1]]);
    expect(products[0].id).toBe('sku-ABC');
  });
  it('searches 50,000 entries in a reasonable main-thread budget', () => {
    const large = createSearchIndex(
      Array.from({ length: 50000 }, (_, i) => ({ ...products[0], id: `${i}`, sku: `SKU${i}` })),
    );
    const before = performance.now();
    expect(searchProducts(large, 'sku49999')).toHaveLength(1);
    expect(performance.now() - before).toBeLessThan(300);
  });
});
describe('gesture intent and price precision', () => {
  it('swipe left is next and right is previous', () => {
    expect(swipeDirection(-100, 10, 200)).toBe(1);
    expect(swipeDirection(100, 10, 200)).toBe(-1);
  });
  it('rejects vertical scroll, tiny drags and long presses', () => {
    expect(swipeDirection(10, 4, 200)).toBe(0);
    expect(swipeDirection(60, 150, 200)).toBe(0);
    expect(swipeDirection(100, 1, 2000)).toBe(0);
  });
  it('keeps LKR precision, zero and missing distinct', () => {
    expect(formatPrice(1234.5)).toBe('LKR 1,234.50');
    expect(formatPrice(0)).toBe('LKR 0.00');
    expect(formatPrice(null)).toBe('Price unavailable');
  });
});
describe('persistence failure recovery and share feature detection', () => {
  it('handles blocked storage without crashing', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw Error('blocked');
      },
      setItem: () => {
        throw Error('blocked');
      },
    });
    expect(readProgress()).toBeNull();
    expect(readSaved()).toEqual([]);
    expect(persist('key', {})).toBe(false);
  });
  it('handles malformed records, deduplicates bookmarks', () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key.includes('home') ? '{bad' : '["a","a",null,5,"b"]'),
    });
    expect(readProgress()).toBeNull();
    expect(readSaved()).toEqual(['a', 'b']);
  });
  it('rejects unsupported image sharing and uses file support, not text support', () => {
    const file = new File(['test'], 'test.png', { type: 'image/png' });
    vi.stubGlobal('navigator', { share: vi.fn() });
    expect(canShareFile(file)).toBe(false);
    vi.stubGlobal('navigator', {
      share: vi.fn(),
      canShare: ({ files }: { files: File[] }) => files[0].type === 'image/png',
    });
    expect(canShareFile(file)).toBe(true);
    vi.stubGlobal('navigator', {
      share: vi.fn(),
      canShare: () => {
        throw Error('blocked');
      },
    });
    expect(canShareFile(file)).toBe(false);
  });
});
