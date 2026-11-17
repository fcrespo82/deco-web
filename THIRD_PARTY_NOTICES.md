# Avisos de terceiros

## deco-mcp

Os arquivos em `src/deco-client/vendor/` foram copiados de
[fullo/deco-mcp](https://github.com/fullo/deco-mcp), commit `94b0463`.
O repositório declara licença MIT (`package.json` e README).

```
MIT License

Copyright (c) Francesco Fullone

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Fontes IBM Plex Sans e IBM Plex Mono

A interface empacota as fontes [IBM Plex](https://github.com/IBM/plex)
Sans e Mono (© IBM Corp.), via os pacotes `@fontsource-variable/ibm-plex-sans`
e `@fontsource/ibm-plex-mono`. São distribuídas sob a SIL Open Font License
1.1; o texto completo está no arquivo `LICENSE` de cada pacote e em
https://openfontlicense.org.

## Switch Dashboard — coletor HTTP e templates

Copyright (c) 2026 byte4geek. Licença MIT, incluída em `collectors/switches/LICENSE`. Origem e adaptações em `collectors/switches/UPSTREAM.md`.

## Diagramas do aplicativo e POCs (`web/src/network`, `web/poc`)

JointJS, libavoid e ELK são usados pelo mapa físico do aplicativo. React Flow, React e Web Awesome continuam restritos às POCs:

- JointJS (`@joint/core`) e `@joint/router-avoid`: MPL-2.0. Fonte: https://github.com/clientIO/joint
- libavoid-js / libavoid: LGPL-2.1-or-later. Fontes: https://github.com/Aksem/libavoid-js e https://github.com/mjwybrow/adaptagrams . O arquivo `libavoid.wasm` permanece separado do JavaScript e as licenças constam nos pacotes instalados.
- React Flow (`@xyflow/react`): MIT. Fonte: https://github.com/xyflow/xyflow
- React e React DOM: MIT. Fonte: https://github.com/facebook/react
- elkjs / Eclipse Layout Kernel: EPL-2.0. Fonte: https://github.com/kieler/elkjs

- Web Awesome (`@awesome.me/webawesome`), somente na POC de UI: MIT. Fonte: https://github.com/shoelace-style/webawesome
- As ilustrações genéricas da POC são geradas pelo código local; fotos opcionais oficiais mantêm os créditos e URLs em `web/poc/assets/SOURCES.md`.

## POC shadcn + Preact (`web/poc/shadcn`)

- shadcn/ui: MIT, Copyright (c) 2023 shadcn. Código oficial incorporado e adaptado para imports locais, tradução e tipagem Preact. Licença completa em `web/src/components/ui/LICENSE.shadcn.md`; URLs exatas em `registry-sources.json`. Fonte: https://github.com/shadcn-ui/ui
- Radix Primitives (`radix-ui`): MIT. Fonte: https://github.com/radix-ui/primitives
- Lucide (`lucide-react`): ISC. Fonte: https://github.com/lucide-icons/lucide
- Class Variance Authority (`class-variance-authority`): Apache-2.0. Fonte: https://github.com/joe-bell/cva
- clsx e tailwind-merge: MIT. Fontes: https://github.com/lukeed/clsx e https://github.com/dcastil/tailwind-merge
- tw-animate-css: MIT. Fonte: https://github.com/Wombosvideo/tw-animate-css

A integração principal utiliza shadcn/Radix por `preact/compat`, preservando os temas existentes. Licenças distribuídas no frontend: `/licenses/shadcn.txt` e `/licenses/libavoid.txt`. O WASM permanece como arquivo separado em `assets/`.
