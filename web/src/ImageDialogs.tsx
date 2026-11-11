/**
 * Diálogos de imagem: enviar um arquivo (com pré-visualização, remoção do
 * fundo branco e recorte) e escolher uma foto oficial da galeria do produto.
 */
import { useEffect, useState } from "preact/hooks";
import { ExternalLink, ImageUp } from "lucide-preact";
import { useImages } from "./data";
import { DecoShapeSvg } from "./art/DecoArt";
import { DEFAULT_DECO_IMAGES } from "./art/images";
import { api, officialProxy, type ImageKind } from "./api";
import { DecoSvgContent, type DecoSvg } from "./art/custom-svg";
import { sanitizeSvg } from "../../src/core/svg-sanitize.js";
import { prepareImage } from "./lib/image-upload";
import { errorText } from "./lib/mutate";
import { invalidate } from "./lib/query";
import { toast } from "./lib/toast";
import { Button, Check, ChoiceCard, cx, Dialog, FileButton, Segmented, Spinner } from "./ui";

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
      <div class="mt-5 flex flex-wrap gap-3">
        {onBack && (
          <Button onClick={onBack}>
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
const isSvg = (f: File) => f.type === "image/svg+xml" || /\.svg$/i.test(f.name);

export function UploadDialog(props: { file: File; kind: ImageKind; name: string; label: string; square?: boolean; defaultRemoveBg?: boolean; max?: number; onClose: () => void }) {
  return (
    <Dialog title={`Imagem de ${props.label}`} subtitle={props.file.name} onClose={props.onClose}>
      {props.kind === "decos" && isSvg(props.file) ? (
        <SvgPrepare file={props.file} name={props.name} label={props.label} onDone={props.onClose} />
      ) : (
        <Prepare source={props.file} kind={props.kind} name={props.name} label={props.label} square={props.square} defaultRemoveBg={props.defaultRemoveBg ?? false} max={props.max} onDone={props.onClose} />
      )}
    </Dialog>
  );
}

/** SVG de Deco: prévia já sanitizada (LED online/offline) e avisos do que foi removido. */
function SvgPrepare({ file, name, label, onDone }: { file: File; name: string; label: string; onDone: () => void }) {
  const [state, setState] = useState<{ text: string; doc: DecoSvg; warnings: string[] } | { error: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    file.text().then((text) => {
      try {
        const { tree, viewBox, warnings } = sanitizeSvg(text);
        if (alive) setState({ text, doc: { tree, viewBox }, warnings });
      } catch (e) {
        if (alive) setState({ error: (e as Error).message });
      }
    }, () => alive && setState({ error: "Não consegui ler o arquivo." }));
    return () => { alive = false; };
  }, [file]);
  if (!state) return <p class="text-sm text-muted"><Spinner /> Conferindo o SVG…</p>;
  if ("error" in state) return <>
    <p role="alert" class="text-sm text-bad">SVG recusado: {state.error}</p>
    <p class="mt-2 text-[12.5px] text-muted">Veja os requisitos em README → "Enviar seu próprio SVG".</p>
    <div class="mt-4 flex justify-end"><Button onClick={onDone}>Fechar</Button></div>
  </>;
  const save = async () => {
    setBusy(true);
    setSaveError(null);
    try {
      await saveImage("decos", name, new Blob([state.text], { type: "image/svg+xml" }), label);
      onDone();
    } catch (e) {
      setSaveError(errorText(e));
      setBusy(false);
    }
  };
  return <>
    <div class="grid grid-cols-2 gap-3">
      {[true, false].map((online) => (
        <figure class="grid gap-2 rounded-xl border border-line bg-surface-2 p-3 text-center text-[12.5px] text-muted">
          <svg viewBox={state.doc.viewBox} class="mx-auto h-36 w-full" aria-hidden="true">
            <DecoSvgContent doc={state.doc} uid={`upload-${online ? "on" : "off"}`} online={online} />
          </svg>
          <figcaption>{online ? "Online" : "Offline"}</figcaption>
        </figure>
      ))}
    </div>
    <p class="mt-3 text-[12.5px] text-muted">O elemento <code>id="status-led"</code> recebe as cores de LED do tema conforme o estado do nó.</p>
    {state.warnings.length > 0 && <ul class="mt-3 list-disc pl-5 text-[12.5px] text-warn">{state.warnings.map((w) => <li>{w}</li>)}</ul>}
    {saveError && <p role="alert" class="mt-3 text-sm text-bad">{saveError}</p>}
    <div class="mt-4 flex justify-end gap-2">
      <Button onClick={onDone}>Cancelar</Button>
      <Button variant="primary" loading={busy} onClick={save}>Salvar SVG</Button>
    </div>
  </>;
}

/** Escolha local por modelo; fotos oficiais só são consultadas quando solicitadas. */
export function OfficialPicker({ model, name, onClose }: { model: string; name: string; onClose: () => void }) {
  const images = useImages().data;
  const [state, setState] = useState<{ page: string | null; candidates: string[] } | null>(null);
  const [remote, setRemote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const custom = images?.decos[name];
  const current = images?.decoStyles?.[name] ?? (custom ? "custom" : DEFAULT_DECO_IMAGES[name] ? "default" : "drawing");

  useEffect(() => {
    if (!remote) return;
    let active = true;
    api.officialCandidates(model).then(result => { if(active) setState(result); }, e => { if(active) setError(errorText(e,"Falha ao buscar fotos oficiais.")); });
    return () => { active = false; };
  }, [model, remote]);

  async function choose(style: "drawing" | "default" | "custom") {
    setBusy(true); setSaveError(null);
    try {
      await api.setDecoStyle(name, style);
      invalidate(["images"]);
      toast(`Visual do Deco ${model} salvo`);
      onClose();
    } catch(e) { setSaveError(errorText(e)); }
    finally { setBusy(false); }
  }

  return <Dialog title={`Imagem do Deco ${model}`} onClose={onClose}>
    {chosen ? <Prepare source={officialProxy(chosen)} kind="decos" name={name} label={`Deco ${model}`} defaultRemoveBg onDone={onClose} onBack={() => setChosen(null)} /> : <>
      <p class="mb-3 text-sm text-muted">A escolha vale para todos os nós deste modelo. Desenhos e fotos mostram o indicador de status online/offline.</p>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3" role="group" aria-label="Imagem do modelo">
        <ChoiceCard class="grid gap-2 p-3 text-center text-sm" selected={current==="drawing"} disabled={busy} onClick={()=>choose("drawing")}>
          <svg viewBox="0 0 64 80" class="mx-auto h-28 w-full" aria-hidden="true"><DecoShapeSvg model={model} online={true} uid={`picker-drawing-${name}`} /></svg>
          <span>Desenho com status{current==="drawing" ? " ✓" : ""}</span>
        </ChoiceCard>
        {DEFAULT_DECO_IMAGES[name] && <ChoiceCard class="grid gap-2 p-3 text-center text-sm" selected={current==="default"} disabled={busy} onClick={()=>choose("default")}>
          <img src={DEFAULT_DECO_IMAGES[name]} alt="" class="h-28 w-full object-contain"/>
          <span>Foto padrão{current==="default" ? " ✓" : ""}</span>
        </ChoiceCard>}
        {custom && <ChoiceCard class="grid gap-2 p-3 text-center text-sm" selected={current==="custom"} disabled={busy} onClick={()=>choose("custom")}>
          <img src={custom} alt="" class="h-28 w-full object-contain"/>
          <span>Foto personalizada{current==="custom" ? " ✓" : ""}</span>
        </ChoiceCard>}
      </div>
      {saveError && <p role="alert" class="mt-3 text-sm text-bad">{saveError}</p>}
      <div class="my-4 flex flex-wrap gap-2">
        <UploadButton kind="decos" name={name} label={`Deco ${model}`} defaultRemoveBg>Enviar outra foto</UploadButton>
        <Button size="sm" onClick={()=>setRemote(true)} disabled={remote}>Buscar fotos oficiais</Button>
      </div>
      {remote && <section aria-label="Fotos oficiais">
        {state?.page && <a href={state.page} target="_blank" rel="noreferrer" class="mb-3 inline-flex items-center gap-1 text-sm text-accent hover:underline">Página do produto na TP-Link <ExternalLink class="size-3"/></a>}
        {error ? <p class="text-sm text-bad">{error}</p> : !state ? <p class="text-sm text-muted">Buscando fotos oficiais…</p> : !state.candidates.length ? <p class="text-sm text-muted">Nenhuma foto oficial encontrada. Você pode enviar um arquivo.</p> : <div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {state.candidates.map(url=><button type="button" onClick={()=>setChosen(url)} class="aspect-square overflow-hidden rounded-xl border border-line bg-white p-2 hover:border-accent" aria-label="Escolher foto oficial"><img src={officialProxy(url)} alt="" loading="lazy" class="size-full object-contain"/></button>)}
        </div>}
      </section>}
    </>}
  </Dialog>;
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
      <FileButton size={size} accept={kind === "decos" ? "image/png,image/jpeg,image/webp,image/svg+xml,.svg" : "image/png,image/jpeg,image/webp"} icon={<ImageUp class="size-3.5" />} onFile={setFile}>
        {children}
      </FileButton>
      {file && <UploadDialog file={file} kind={kind} name={name} label={label} square={square} defaultRemoveBg={defaultRemoveBg} max={max} onClose={() => setFile(null)} />}
    </>
  );
}
