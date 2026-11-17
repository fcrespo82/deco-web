# POC shadcn + Preact

A partir da raiz do repositório:

```sh
npm run dev:shadcn
```

Abrir http://127.0.0.1:5175/shadcn/ . A POC é isolada do aplicativo principal e da POC Web Awesome (5174).

## Implementação

- Código oficial shadcn do registry `new-york-v4`, com Radix, Tailwind v4 e Preact 11 via `preact/compat`. URLs de origem e dependências constam em `registry-sources.json`; licença MIT em `LICENSE.shadcn.md`.
- Imports de `cn` e do registry foram ajustados para arquivos locais. Labels de fechamento foram traduzidos.
- Dois ajustes de tipagem para Preact: `Button` separa o render de Slot e botão nativo para não combinar referências de tipos diferentes; `Input` preserva o objeto de propriedades completo, mantendo a união discriminada dos tipos de entrada.
- Build com guarda que rejeita módulos dos runtimes `react` e `react-dom`. O cache do Vite é separado, evitando colisões com a POC React Flow.
- O mapa reutiliza **o mesmo** `../jointjs.html` e os mesmos módulos de JointJS/libavoid/ELK e PNGs. O iframe permanece montado durante a navegação para preservar posições e cabeamento. O modo incorporado reduz apenas o cabeçalho do mapa.
- O iframe publica inventário e conexões com `postMessage`. O aplicativo só aceita mensagens da mesma origem e do iframe esperado. O formulário adiciona o dispositivo ao mapa pela API local da própria POC, usando o tipo selecionado para gerar seu PNG transparente e suas portas.
- Alternar Cartões/Equipamentos ou calibrar o PNG preserva as ligações e os dispositivos adicionados; trocar o cenário ou usar Restaurar recupera os dados demonstrativos.
- Não acessa nem modifica o cadastro real da rede. As alterações da demonstração são temporárias.

## Validação

```sh
npm run typecheck:shadcn
npm run test:shadcn
npm run build:shadcn
node web/poc/verify.mjs
```

Os seis testes de interação executam o bundle de navegador com os mesmos aliases e a mesma guarda contra React do build. O ambiente jsdom não mede layout: scroll, resize e a posição de ponteiro usada pelo Select são simulados explicitamente. Cobertura: preservação do iframe na navegação, Select por teclado e mouse, busca, DropdownMenu → Sheet, Escape, foco no Dialog, formulário e tipo sem Ethernet, Tabs/Switch, mensagens do mapa e rejeição de outra origem.

Isso não substitui inspeção visual e teste dos gestos do diagrama em um navegador real. O build fica em `poc-shadcn-dist/`.
