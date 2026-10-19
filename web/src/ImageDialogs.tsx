/**
 * Diálogos de imagem: enviar um arquivo (com pré-visualização, remoção do
 * fundo branco e recorte) e escolher uma foto oficial da galeria do produto.
 */
import { useEffect, useState } from "preact/hooks";
import { ExternalLink, ImageUp } from "lucide-preact";
import { api, officialProxy, type ImageKind } from "./api";
import { prepareImage } from "./lib/image-upload";
import { errorText } from "./lib/mutate";
import { invalidate } from "./lib/query";
import { toast } from "./lib/toast";
import { Button, Check, cx, Dialog, Segmented, Spinner } from "./ui";

/** Fundo xadrez para mostrar a transparência da pré-visualização. */
const CHECKER = "bg-[conic-gradient(var(--surface-3)_25%,var(--surface)_0_50%,var(--surface-3)_0_75%,var(--surface)_0)] bg-[length:16px_16px]";

export async function saveImage(kind: ImageKind, name: string, blob: Blob, label: string) {
  await api.putImage(kind, name, blob);
  invalidate(["images"]);
  toast(`Imagem de ${label} salva`, { tone: "ok" });
}

export async function removeImage(kind: ImageKind, name: string, label: string) {
  try {
    await api.deleteImage(kind, name);
    invalidate(["images"]);
    toast(`Imagem de ${label} removida`, { tone: "ok" });
  } catch (e) {
    toast("Não foi possível remover", { tone: "bad", detail: errorText(e) });
  }
}

/** Pré-visualização + opções, para uma imagem já escolhida (arquivo ou foto oficial). */
function Prepare({
  source,
  kind,
  name,
  label,
  square,
  defaultRemoveBg,
  max,
  onDone,
  onBack,
}: {
  max?: number;
  source: string | Blob;
  kind: ImageKind;
  name: string;
  label: string;
  square?: boolean;
  defaultRemoveBg: boolean;
  onDone: () => void;
  onBack?: () => void;
}) {
  const [removeBg, setRemoveBg] = useState(defaultRemoveBg);
  const [tolerance, setTolerance] = useState(8);
  const [result, setResult] = useState<{ blob: Blob; preview: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    setResult(null);
    setError(null);
    prepareImage(source, { removeBackground: removeBg, square, tolerance, max }).then(
      (r) => alive && setResult(r),
      (e) => alive && setError(errorText(e, "Não consegui abrir a imagem.")),
    );
    return () => {
      alive = false;
    };
  }, [source, removeBg, square, tolerance]);

  const save = async () => {
    if (!result) return;
    setSaving(true);
    try {
      await saveImage(kind, name, result.blob, label);
      onDone();
    } catch (e) {
      setError(errorText(e, "Falha ao salvar."));
      setSaving(false);
    }
  };

  return (
    <>
      <div class="grid grid-cols-2 gap-3">
        {(["light", "dark"] as const).map((t) => (
          <div class={cx("flex aspect-square items-center justify-center overflow-hidden rounded-xl border border-line p-4", t === "light" ? CHECKER : "bg-[#0c0f13]")}>
            {result ? <img src={result.preview} alt="" class="max-h-full max-w-full object-contain drop-shadow-lg" /> : error ? null : <Spinner />}
          </div>
        ))}
      </div>
      {error && <p class="mt-2 text-[13px] text-bad">{error}</p>}
      <div class="mt-3 grid gap-2">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Check checked={removeBg} onChange={() => setRemoveBg(!removeBg)}>
            Remover fundo branco e recortar no aparelho
          </Check>
          {removeBg && (
            <Segmented
              label="Sensibilidade"
              value={tolerance}
              onChange={setTolerance}
              options={[
                { value: 3, label: "só branco puro" },
                { value: 8, label: "normal" },
                { value: 20, label: "forte" },
              ]}
            />
          )}
        </div>
        {removeBg && <p class="text-[12px] text-muted">Se o fundo comer parte do aparelho, use "só branco puro"; se sobrar halo, "forte".</p>}
        {result && <p class="text-[12px] text-muted">Fica com {Math.max(1, Math.round(result.blob.size / 1024))} KB. Salva em DATA_DIR/images, fora do git.</p>}
      </div>
      <div class="mt-4 flex flex-wrap gap-2">
        {onBack && (
          <Button variant="ghost" onClick={onBack}>
            Voltar
          </Button>
        )}
        <span class="flex-1" />
        <Button variant="primary" onClick={save} loading={saving} disabled={!result}>
          Usar esta imagem
        </Button>
      </div>
    </>
  );
}

/** Enviar arquivo do computador/celular. */
export function UploadDialog(props: { file: File; kind: ImageKind; name: string; label: string; square?: boolean; defaultRemoveBg?: boolean; max?: number; onClose: () => void }) {
  return (
    <Dialog title={`Imagem de ${props.label}`} subtitle={props.file.name} onClose={props.onClose}>
      <Prepare source={props.file} kind={props.kind} name={props.name} label={props.label} square={props.square} defaultRemoveBg={props.defaultRemoveBg ?? false} max={props.max} onDone={props.onClose} />
    </Dialog>
  );
}

/** Galeria oficial do produto; clicar escolhe e abre a pré-visualização. */
export function OfficialPicker({ model, name, onClose }: { model: string; name: string; onClose: () => void }) {
  const [state, setState] = useState<{ page: string | null; candidates: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    api.officialCandidates(model).then(setState, (e) => setError(errorText(e, "Falha ao buscar a página do produto.")));
  }, [model]);

  return (
    <Dialog
      title={`Foto oficial do Deco ${model}`}
      subtitle={
        state?.page ? (
          <a href={state.page} target="_blank" rel="noreferrer" class="inline-flex items-center gap-1 hover:underline">
            página do produto na TP-Link <ExternalLink class="size-3" />
          </a>
        ) : (
          "Fotos da página do produto, para uso pessoal"
        )
      }
      onClose={onClose}
    >
      {chosen ? (
        <Prepare source={officialProxy(chosen)} kind="decos" name={name} label={`Deco ${model}`} defaultRemoveBg onDone={onClose} onBack={() => setChosen(null)} />
      ) : error ? (
        <p class="text-[13px] text-bad">{error}</p>
      ) : !state ? (
        <div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {Array.from({ length: 8 }, () => (
            <div class="aspect-square animate-pulse rounded-xl bg-surface-2" />
          ))}
        </div>
      ) : state.candidates.length === 0 ? (
        <p class="text-[13px] text-muted">Não achei a página desse modelo no site da TP-Link. Envie uma imagem pelo botão "Enviar arquivo".</p>
      ) : (
        <>
          <p class="mb-3 text-[12.5px] text-muted">Escolha uma foto com uma unidade só, de preferência de frente. O fundo branco sai na próxima etapa.</p>
          <div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {state.candidates.map((u) => (
              <button type="button" onClick={() => setChosen(u)} class="group aspect-square overflow-hidden rounded-xl border border-line bg-white p-1.5 transition hover:border-accent hover:ring-2 hover:ring-accent/30">
                <img src={officialProxy(u)} alt="" loading="lazy" class="size-full object-contain transition-transform group-hover:scale-105" />
              </button>
            ))}
          </div>
        </>
      )}
    </Dialog>
  );
}

/** Botão que abre o seletor de arquivo e, escolhido, o diálogo de envio. */
export function UploadButton({
  kind,
  name,
  label,
  square,
  defaultRemoveBg,
  children = "Enviar arquivo",
  size = "sm",
  max,
}: {
  max?: number;
  kind: ImageKind;
  name: string;
  label: string;
  square?: boolean;
  defaultRemoveBg?: boolean;
  children?: string;
  size?: "sm" | "md";
}) {
  const [file, setFile] = useState<File | null>(null);
  return (
    <>
      <label class={cx("inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-surface font-medium text-fg transition hover:bg-surface-2", size === "sm" ? "px-2.5 py-1 text-[12.5px]" : "px-3 py-2 text-[13.5px]")}>
        <ImageUp class="size-3.5" />
        {children}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          class="sr-only"
          onChange={(e) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            (e.target as HTMLInputElement).value = "";
            if (f) setFile(f);
          }}
        />
      </label>
      {file && <UploadDialog file={file} kind={kind} name={name} label={label} square={square} defaultRemoveBg={defaultRemoveBg} max={max} onClose={() => setFile(null)} />}
    </>
  );
}
