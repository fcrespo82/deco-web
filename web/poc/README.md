# POCs de topologia

Executar a partir da raiz do projeto:

```sh
npm run dev:pocs
```

Abrir http://127.0.0.1:5174/ (servidor separado do aplicativo Preact).

- `interface.html`: Web Awesome (Web Components), com visão geral, navegação, inventário pesquisável, filtros, painel de portas, drawer de detalhes, diálogo de cadastro demonstrativo, tema claro/escuro e topologia incorporada.
- `jointjs.html`: JointJS + `@joint/router-avoid` / libavoid WASM. Roteia os cabos em conjunto ao mover os cartões, preservando as posições. Portas físicas identificadas nas bordas superior e inferior. Botão opcional de organização das posições com ELK.
- `reactflow.html`: React Flow com React real, isolado do alias Preact do aplicativo. ELK calcula posições, portas e trajetórias em camadas, tanto na vertical quanto na horizontal. Arraste manual usa linhas provisórias `smoothstep`; os botões de reorganização recalculam todo o grafo com ELK.
- Os dois cenários são demonstrativos: o original de 6 equipamentos e um expandido de 14. Nenhuma chamada de escrita à API e nenhuma importação automática dos dados reais.
- A conexão dupla ao servidor representa duas interfaces distintas, sem inferir agregação de links.

Validação e build independentes:

```sh
node web/poc/verify.mjs
npm run build:pocs
```

O build fica em `poc-dist/`. `libavoid.wasm` é servido como arquivo separado, sem embutir o binário no JavaScript. Consulte `THIRD_PARTY_NOTICES.md` para fontes e licenças.

## Aparência e PNGs

- **Cartões**: blocos genéricos com pontos de conexão, reservando espaço separado para Wi-Fi.
- **Equipamentos**: PNG transparente em vista traseira ortogonal, sem perspectiva. Na ausência de um PNG específico, `generic-device.js` gera um dispositivo conforme o tipo e a quantidade de portas. O centro de cada RJ45 e a âncora do cabo compartilham a mesma geometria.
- As imagens geradas preservam proporção e são recortadas ao equipamento, sem margens transparentes excessivas. O tamanho real do nó é passado ao ELK.
- **Ajustar PNG e portas** permite substituir por PNG próprio, calibrar os conectores físicos e baixar a imagem. Só há portas Ethernet numeradas no seletor; o Wi-Fi é um ponto independente, sem número. Trocar a imagem exige recalibrar todas as portas antes de salvar.
- As posições e PNGs personalizados ficam apenas no localStorage desta POC. O cadastro real não é modificado.
- Fotografias oficiais em perspectiva são referências opcionais (`assets/SOURCES.md`), fora do Git, e não são o padrão visual.
- `photo-geometry.js` rejeita portas físicas sobre o rádio ou próximas demais de outra porta. `verify.mjs` confere os identificadores físicos/radio, separação e coordenadas reais das âncoras, além do roteamento libavoid e ELK.

## Experiência de edição

- Zoom: botões **+**, **−**, **1:1**, **Enquadrar**, roda do mouse e teclas `+`, `-`, `0` com foco no mapa. Arrastar o fundo move a área de visualização.
- O ponto Wi-Fi fica no topo central, próximo ao equipamento; o nome fica abaixo do PNG. Os pontos de portas físicas nos cartões reservam o centro para o rádio.
- Para cabear, arraste entre portas Ethernet livres. Para Wi-Fi, arraste entre os pontos azuis. As regras impedem ligar rádio a RJ45, duplicar ligações, conectar o equipamento a si mesmo ou ocupar uma mesma porta física duas vezes. Um rádio aceita várias associações.
- Clique em uma linha e use **Remover ligação selecionada**, ou **Começar sem ligações** para experimentar a rede do zero. **Restaurar** recupera o cenário demonstrativo. Alterações de cabeamento são temporárias na POC.
- Tipos genéricos distintos: celular, tablet, notebook, roteador com antenas, switch/painel, desktop/servidor, Deco e TV. Celular e tablet do cenário não inventam portas Ethernet. O editor permite escolher o tipo do PNG para a demonstração.

## Comparação com shadcn/Preact

`npm run dev:shadcn` abre um servidor isolado em http://127.0.0.1:5175/shadcn/ . Consulte `shadcn/README.md`. O diagrama é compartilhado com esta POC, incluindo PNGs, zoom, Wi-Fi e cabeamento; o iframe é mantido na navegação.
