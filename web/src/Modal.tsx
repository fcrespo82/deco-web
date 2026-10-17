import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

/** Diálogo modal nativo (<dialog>): foco preso, Esc fecha, fundo escurecido. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ComponentChildren }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => dialog.removeEventListener("cancel", onCancel);
  }, [onClose]);

  return (
    <dialog ref={ref} class="modal" aria-labelledby="modal-title" onClick={(e) => e.target === ref.current && onClose()}>
      <div class="modal-body">
        <header class="modal-head">
          <h3 id="modal-title">{title}</h3>
          <button class="btn icon" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
