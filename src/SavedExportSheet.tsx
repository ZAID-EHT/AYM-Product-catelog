import { useEffect, useState } from 'react';
import { ArrowDownToLine, FileSpreadsheet, LoaderCircle } from 'lucide-react';
import type { Product } from './types';
import type { ExportProgress } from './savedExcel';
import { Modal } from './Modal';
import { downloadCard } from './share';

export function SavedExportSheet({ products, close }: { products: Product[]; close: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<ExportProgress>({
    completed: 0,
    total: products.length,
    stage: 'photos',
  });
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setFile(null);
    setError('');
    setProgress({ completed: 0, total: products.length, stage: 'photos' });
    import('./savedExcel')
      .then(({ createSavedExcel }) =>
        createSavedExcel(products, controller.signal, (next) => {
          if (!controller.signal.aborted) setProgress(next);
        }),
      )
      .then((result) => {
        if (!controller.signal.aborted) setFile(result);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : 'The Excel file could not be created. Please try again.',
          );
      });
    return () => controller.abort();
  }, [products, attempt]);
  return (
    <Modal title="Export Saved to Excel" close={close}>
      <p className="sheet-intro">
        All {products.length.toLocaleString()} saved{' '}
        {products.length === 1 ? 'product' : 'products'}, with photos embedded in each row, full
        names, codes and prices. The images stay in the file when you open it offline.
      </p>
      {error ? (
        <div className="field-error" role="alert">
          <p>{error}</p>
          <button className="text-button" onClick={() => setAttempt((value) => value + 1)}>
            Try again
          </button>
        </div>
      ) : file ? (
        <div className="export-status" role="status">
          <FileSpreadsheet size={28} />
          <p>Your Excel file is ready.</p>
        </div>
      ) : (
        <div className="export-status" role="status" aria-live="polite">
          <LoaderCircle className="spin" size={28} />
          <p>
            {progress.stage === 'workbook'
              ? 'Creating Excel file…'
              : `Preparing products ${progress.completed} / ${progress.total}…`}
          </p>
          <progress
            aria-label="Excel export progress"
            value={progress.completed}
            max={progress.total}
          />
        </div>
      )}
      <button
        className="primary full-width"
        disabled={!file}
        onClick={() => file && downloadCard(file)}
      >
        <ArrowDownToLine size={19} /> Download Excel
      </button>
      <p className="privacy-note">
        Original price columns are kept separately. Blank prices remain blank, and missing
        photographs are marked.
      </p>
    </Modal>
  );
}
