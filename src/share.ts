import { assetUrl } from './catalogue';
import type { Product } from './types';

export function productUrl(product: Product) {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('product', product.id);
  return url.toString();
}
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(
        new Error('The photograph could not be loaded. Open the product online, then try again.'),
      );
    img.src = src;
  });
}
export function wrapText(ctx: CanvasRenderingContext2D, value: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of value.split(/\s+/)) {
    if (ctx.measureText(`${line} ${word}`.trim()).width <= width) {
      line = `${line} ${word}`.trim();
      continue;
    }
    if (line) lines.push(line);
    line = '';
    // Even unbroken identifiers must fit, without truncating the name.
    for (const character of word) {
      if (ctx.measureText(line + character).width > width && line) {
        lines.push(line);
        line = '';
      }
      line += character;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ['Unnamed product'];
}
export async function generateProductCard(product: Product): Promise<File> {
  await document.fonts.ready;
  const image = product.images[0] ? await loadImage(assetUrl(product.images[0].src)) : null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image creation is unavailable in this browser.');
  ctx.font = '600 48px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const lines = wrapText(ctx, product.name, 920);
  canvas.width = 1080;
  canvas.height = 1180 + (lines.length - 1) * 62;
  ctx.fillStyle = '#f6f5f2';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(60, 60, 960, 960, 32);
  ctx.fill();
  if (image) {
    const scale = Math.min(912 / image.naturalWidth, 912 / image.naturalHeight);
    const w = image.naturalWidth * scale,
      h = image.naturalHeight * scale;
    ctx.drawImage(image, 540 - w / 2, 540 - h / 2, w, h);
  } else {
    ctx.strokeStyle = '#ccd3cd';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(440, 440, 200, 200, 24);
    ctx.moveTo(460, 610);
    ctx.lineTo(510, 550);
    ctx.lineTo(550, 590);
    ctx.lineTo(590, 530);
    ctx.lineTo(625, 610);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(490, 490, 12, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#1e2b25';
  ctx.font = '600 48px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  lines.forEach((line, index) => ctx.fillText(line, 80, 1100 + index * 62));
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Unable to create the PNG. Please try again.'))),
      'image/png',
    ),
  );
  return new File(
    [blob],
    `${
      product.name
        .trim()
        .replace(/[^\p{L}\p{N}._-]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 100) || 'product'
    }.png`,
    { type: 'image/png' },
  );
}
export function canShareFile(file: File) {
  try {
    return (
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] })
    );
  } catch {
    return false;
  }
}
export async function nativeShare(file: File, product: Product) {
  // Invoke from a fresh tap after image preparation, retaining iOS user activation.
  if (!canShareFile(file)) return false;
  await navigator.share({ files: [file], title: product.name });
  return true;
}
export function downloadCard(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
