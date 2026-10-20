import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
export function Modal({
  title,
  close,
  children,
  wide = false,
  fullscreen = false,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  wide?: boolean;
  fullscreen?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`sheet ${wide ? 'wide' : ''} ${fullscreen ? 'fullscreen' : ''}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            close();
        }
      }}
    >
      <div className="sheet-handle" />
      <div className="sheet-heading">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button soft" aria-label="Close dialog" onClick={close}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
