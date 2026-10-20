export interface ProductImage {
  src: string;
  thumbnail: string;
  width: number;
  height: number;
  source: string;
}
export interface Product {
  id: string;
  number: number;
  name: string;
  sku: string;
  price: number | null;
  priceSource: string | null;
  priceLabel: string;
  prices: Record<string, number | null>;
  category: string;
  description: string;
  images: ProductImage[];
  page: number;
}
export interface Catalogue {
  version: string;
  currency: string;
  precision: number;
  products: Product[];
  categories: string[];
}
export type Section = 'home' | 'search' | 'saved';
export interface Progress {
  id: string;
  index: number;
  version: string;
}
