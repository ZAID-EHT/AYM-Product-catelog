import ExcelJS from 'exceljs';
import { assetUrl } from './catalogue';
import { productUrl } from './share';
import type { Product, ProductImage } from './types';

export interface ExportProgress {
  completed: number;
  total: number;
  stage: 'photos' | 'workbook';
}

function checkCancelled(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
}

async function embeddedPhoto(photo: ProductImage, signal: AbortSignal): Promise<string> {
  checkCancelled(signal);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      img.onload = null;
      img.onerror = null;
    };
    const abort = () => {
      cleanup();
      img.src = '';
      reject(new DOMException('Export cancelled', 'AbortError'));
    };
    const timer = window.setTimeout(() => {
      cleanup();
      img.src = '';
      reject(new Error('Photo request timed out'));
    }, 30000);
    signal.addEventListener('abort', abort, { once: true });
    img.onload = () => {
      cleanup();
      resolve(img);
    };
    img.onerror = () => {
      cleanup();
      reject(new Error('Photo unavailable'));
    };
    img.src = assetUrl(photo.src);
  });
  checkCancelled(signal);
  // Excel supports JPEG/PNG, whereas the website serves WebP. Preserve the
  // complete photograph and aspect ratio, with no added captions or cropping.
  const scale = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image export is unavailable in this browser.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const data = canvas.toDataURL('image/jpeg', 0.9);
  canvas.width = canvas.height = 0;
  return data;
}

export async function createSavedExcel(
  products: readonly Product[],
  signal: AbortSignal,
  progress: (value: ExportProgress) => void,
): Promise<File> {
  if (!products.length) throw new Error('Save a product before exporting.');
  checkCancelled(signal);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AYM';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Saved products', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: false }],
  });
  const columns = [
    ['No', 8],
    ['Image', 27],
    ['Product Name', 52],
    ['SKU', 20],
    ['Old Price (LKR)', 20],
    ['Price (LKR)', 18],
    ['Price 2 (LKR)', 20],
    ['Page', 8],
    ['Destination', 28],
    ['Displayed price (LKR)', 24],
    ['Price label', 24],
    ['Category', 24],
    ['Description', 48],
    ['Product link', 48],
  ] as const;
  sheet.columns = columns.map(([, width]) => ({ width }));
  for (const column of [2, 3, 4, 9, 11, 12, 13]) sheet.getColumn(column).numFmt = '@';
  sheet.addRow(columns.map(([name]) => name));
  sheet.addRows(
    products.map((p) =>
      [
        p.number,
        p.images.length ? '' : 'Photograph unavailable',
        p.name,
        p.sku,
        p.prices['Old Price (LKR)'] ?? null,
        p.prices['Price (LKR)'] ?? null,
        p.prices['Price 2 (LKR)'] ?? null,
        p.page ?? null,
        p.images.map((image) => image.source).join('; '),
        p.price,
        p.priceLabel,
        p.category,
        p.description,
        { text: productUrl(p), hyperlink: productUrl(p) },
      ].map((value) => (value === '' ? null : value)),
    ),
  );
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: products.length + 1, column: columns.length },
  };
  const header = sheet.getRow(1);
  header.height = 32;
  header.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF203864' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  products.forEach((p, index) => {
    const row = sheet.getRow(index + 2);
    const photoRows = Math.max(1, Math.ceil(p.images.length / 2));
    const textLines = Math.max(Math.ceil(p.name.length / 44), Math.ceil(p.description.length / 40));
    row.height = Math.min(409, Math.max(132, photoRows * 68, textLines * 14 + 12));
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF17212B' } };
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE0E5EB' } } };
    });
    for (const column of [5, 6, 7, 10]) {
      row.getCell(column).numFmt = '#,##0.00';
      row.getCell(column).alignment = { vertical: 'top', horizontal: 'right' };
    }
    row.getCell(14).font = {
      name: 'Calibri',
      size: 11,
      color: { argb: 'FF175A91' },
      underline: true,
    };
  });
  let next = 0;
  let completed = 0;
  let failed = false;
  progress({ completed, total: products.length, stage: 'photos' });
  // Bound simultaneous decoding/network work for phone memory and responsiveness.
  async function worker() {
    while (!failed && next < products.length) {
      const index = next++;
      const product = products[index];
      const rowNumber = index + 2;
      const rowPixels = ((sheet.getRow(rowNumber).height || 132) * 4) / 3;
      const columnPixels = 194;
      const across = product.images.length > 1 ? 2 : 1;
      const down = Math.max(1, Math.ceil(product.images.length / across));
      try {
        checkCancelled(signal);
        for (let photoIndex = 0; photoIndex < product.images.length; photoIndex++) {
          const photo = product.images[photoIndex];
          const base64 = await embeddedPhoto(photo, signal);
          checkCancelled(signal);
          const tileWidth = columnPixels / across;
          const tileHeight = rowPixels / down;
          const ratio = Math.min((tileWidth - 16) / photo.width, (tileHeight - 16) / photo.height);
          const width = photo.width * ratio;
          const height = photo.height * ratio;
          const imageId = workbook.addImage({ base64, extension: 'jpeg' });
          // Excel offsets are EMUs (9,525 per pixel). Use explicit offsets so
          // gallery photos stay inside the row at non-default column widths.
          const anchor = {
            col: 1,
            row: rowNumber - 1,
            nativeCol: 1,
            nativeRow: rowNumber - 1,
            nativeColOff: Math.round(
              ((photoIndex % across) * tileWidth + (tileWidth - width) / 2) * 9525,
            ),
            nativeRowOff: Math.round(
              (Math.floor(photoIndex / across) * tileHeight + (tileHeight - height) / 2) * 9525,
            ),
          };
          sheet.addImage(imageId, {
            tl: anchor,
            ext: { width, height },
            editAs: 'oneCell',
          });
        }
      } catch (error) {
        failed = true;
        if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
        throw new Error(
          `Could not include the photo for product ${product.number}. Check your connection and try again.`,
          { cause: error },
        );
      }
      progress({ completed: ++completed, total: products.length, stage: 'photos' });
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, products.length) }, worker));
  checkCancelled(signal);
  progress({ completed, total: products.length, stage: 'workbook' });
  const buffer = await workbook.xlsx.writeBuffer();
  checkCancelled(signal);
  return new File([new Uint8Array(buffer).buffer], 'AYM-Saved-Products.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
