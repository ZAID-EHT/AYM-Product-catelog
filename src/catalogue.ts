import type { Product, Progress } from './types';
export const assetUrl = (path: string) => `${import.meta.env.BASE_URL}${path}`;
export function formatPrice(price: number | null, currency = 'LKR', precision = 2) {
  if (price === null) return 'Price unavailable';
  return `${currency} ${new Intl.NumberFormat('en-LK', { minimumFractionDigits: precision, maximumFractionDigits: precision }).format(price)}`;
}
export function restoreIndex(products: Product[], progress: Progress | null) {
  if (!progress || !products.length) return 0;
  const index = products.findIndex((p) => p.id === progress.id);
  return index >= 0
    ? index
    : Math.min(Math.max(Math.trunc(progress.index) || 0, 0), products.length - 1);
}
export function createSearchIndex(products: Product[]) {
  return products.map((product) => ({
    product,
    haystack: `${product.name} ${product.sku} ${product.number} ${product.category}`
      .normalize('NFKD')
      .toLocaleLowerCase(),
  }));
}
export function findJumpTarget(products: Product[], input: string) {
  const query = input.trim().toLocaleLowerCase();
  if (!query) return undefined;
  const explicitSku = query.startsWith('sku:');
  const value = explicitSku ? query.slice(4).trim() : query;
  if (!explicitSku) {
    const numbered = products.find(
      (p) => String(p.number) === value || p.id.toLocaleLowerCase() === value,
    );
    if (numbered) return numbered;
  }
  const matches = products.filter((p) => p.sku.toLocaleLowerCase() === value);
  return matches.length === 1 ? matches[0] : undefined;
}
export function searchProducts(
  index: ReturnType<typeof createSearchIndex>,
  query: string,
  category = '',
) {
  const words = query.normalize('NFKD').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return index
    .filter(
      ({ product, haystack }) =>
        (!category || product.category === category) &&
        words.every((word) => haystack.includes(word)),
    )
    .map(({ product }) => product);
}
export function swipeDirection(dx: number, dy: number, elapsed: number) {
  if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.6 || elapsed > 1800) return 0;
  return dx < 0 ? 1 : -1;
}
