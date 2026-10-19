import { useState } from "preact/hooks";
import { Sparkles, Trash } from "lucide-preact";
import { api, officialProxy, type OfficialResult } from "../api";
import { DecoArt } from "../art/DecoArt";
import { CATEGORY, DeviceArt, type Category } from "../art/devices";
import { modelKey } from "../art/images";
import { useImages, useOverview } from "../data";
import { OfficialPicker, removeImage, UploadButton } from "../ImageDialogs";
import { orderCandidates, pickBestCutout, prepareImage } from "../lib/image-upload";
import { errorText } from "../lib/mutate";
import { invalidate } from "../lib/query";
import { Badge, Button, Card, IconButton, PageLoading, SectionTitle } from "../ui";

const STATUS_LABEL: Record<OfficialResult["status"], string> = { ok: "baixada", "not-found": "não encontrada", failed: "falhou" };

export function Appearance() {
  const { data, error } = useImages();
  const overview = useOverview();
  const [picking, setPicking] = useState<string | null>(null);
  const [auto, setAuto] = useState<{ busy: boolean; step: string; results: OfficialResult[] | null }>({ busy: false, step: "", results: null });

  if (!data) return <PageLoading error={error} />;

  const models = [...new Set([...data.models, ...(overview.data?.nodes.map((n) => n.model) ?? [])])].filter((m) => m && m !== "?").sort();
  const onlineByModel = (m: string) => overview.data?.nodes.some((n) => n.model === m && n.online) ?? true;

  /** Busca automática e, para cada foto baixada, tira o fundo no navegador e regrava. */
  async function runAuto() {
    setAuto({ busy: true, step: "Procurando nas páginas da TP-Link…", results: null });
    try {
      // O servidor já grava uma foto por modelo (a mesma escolha do CLI). Aqui o
      // navegador refina: pula fotos de ambiente/infográfico, tira o fundo da
      // escolhida e regrava.
      const { results } = await api.officialAuto();
      for (const r of results.filter((x) => x.status === "ok")) {
        try {
          setAuto((a) => ({ ...a, step: `Escolhendo a melhor foto do Deco ${r.model}…` }));
          const { candidates } = await api.officialCandidates(r.model);
          const best = (await pickBestCutout(orderCandidates(candidates), officialProxy)) ?? r.url!;
          setAuto((a) => ({ ...a, step: `Removendo o fundo: Deco ${r.model}…` }));
          const { blob } = await prepareImage(officialProxy(best), { removeBackground: true });
          await api.putImage("decos", modelKey(r.model), blob);
          r.url = best;
        } catch {
          // Fica a foto que o servidor gravou (com fundo).
        }
      }
      invalidate(["images"]);
      setAuto({ busy: false, step: "", results });
    } catch (e) {
      setAuto({ busy: false, step: "", results: null });
      alert(errorText(e, "Falha na busca."));
    }
  }

  return (
    <>
      <p class="max-w-2xl text-[13.5px] text-muted">
        Escolha as imagens dos seus Decos e dos aparelhos. Elas ficam em <code>DATA_DIR/images</code>, só no seu servidor, e aparecem no mapa, na galeria e nas
        fichas. Onde não houver imagem, o painel usa os desenhos.
      </p>

      <SectionTitle
        actions={
          <Button variant="primary" icon={<Sparkles class="size-4" />} onClick={runAuto} loading={auto.busy} disabled={models.length === 0}>
            Buscar fotos oficiais
          </Button>
        }
      >
        Seus Decos
      </SectionTitle>
      {auto.busy && <p class="-mt-1 mb-3 text-[12.5px] text-muted">{auto.step}</p>}
      {auto.results && (
        <div class="-mt-1 mb-3 flex flex-wrap gap-1.5">
          {auto.results.map((r) => (
            <Badge tone={r.status === "ok" ? "ok" : r.status === "failed" ? "bad" : "warn"} title={r.error ?? r.url ?? undefined}>
              {r.model}: {STATUS_LABEL[r.status]}
            </Badge>
          ))}
        </div>
      )}
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {models.map((m) => {
          const key = modelKey(m);
          const has = Boolean(data.decos[key]);
          return (
            <Card class="flex flex-col items-center gap-2 text-center">
              <div class="hero-glow flex h-36 w-full items-end justify-center rounded-xl pb-2">
                <DecoArt model={m} online={onlineByModel(m)} uid={`appearance-${key}`} class="h-32" />
              </div>
              <div class="flex items-center gap-1.5">
                <span class="font-semibold">Deco {m}</span>
                {has ? <Badge tone="ok">foto</Badge> : <Badge>desenho</Badge>}
              </div>
              <div class="mt-auto flex flex-wrap justify-center gap-1.5">
                <Button size="sm" onClick={() => setPicking(m)}>
                  Escolher oficial
                </Button>
                <UploadButton kind="decos" name={key} label={`Deco ${m}`} defaultRemoveBg />
                {has && (
                  <IconButton label={`Voltar ao desenho do ${m}`} onClick={() => removeImage("decos", key, `Deco ${m}`)}>
                    <Trash class="size-4" />
                  </IconButton>
                )}
              </div>
            </Card>
          );
        })}
        {models.length === 0 && <p class="text-muted">Os modelos aparecem depois da primeira leitura do Deco.</p>}
      </div>
      <p class="mt-3 text-[12px] text-muted">
        As fotos oficiais vêm das páginas de produto da TP-Link e têm direitos autorais: use só no seu painel. A busca automática escolhe uma foto de uma unidade
        quando consegue; se vier o kit com três, use "Escolher oficial".
      </p>

      <SectionTitle>Categorias de aparelho</SectionTitle>
      <p class="-mt-1 mb-3 text-[12.5px] text-muted">Valem para todos os aparelhos da categoria que não têm foto própria (a foto própria se escolhe na ficha do aparelho).</p>
      <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {(Object.keys(CATEGORY) as Category[]).map((k) => {
          const has = Boolean(data.categories[k]);
          return (
            <Card class="flex flex-col items-center gap-2 p-3 text-center">
              <DeviceArt category={k} size="lg" />
              <span class="text-[13px] font-medium">{CATEGORY[k].label}</span>
              <div class="flex items-center gap-1">
                <UploadButton kind="categories" name={k} label={CATEGORY[k].label} square defaultRemoveBg>
                  {has ? "Trocar" : "Enviar"}
                </UploadButton>
                {has && (
                  <IconButton label={`Remover imagem de ${CATEGORY[k].label}`} onClick={() => removeImage("categories", k, CATEGORY[k].label)}>
                    <Trash class="size-3.5" />
                  </IconButton>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {picking && <OfficialPicker model={picking} name={modelKey(picking)} onClose={() => setPicking(null)} />}
    </>
  );
}

