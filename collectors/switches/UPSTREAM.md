# Origem

Coletor HTTP e templates adaptados de https://github.com/byte4geek/switch-dashboard (MIT), commit de origem `f6e81244931e5fe7277a7da55c4f78792a6fb645`, cópia do checkout local em 2026-11-13.

Inclui apenas a classe HCSwitchScraper. Sem Flask, telemetria externa, scanner de portas, SSH/OVS, FritzBox, reinício ou backup de equipamento. Estimativas de bytes a partir de pacotes são identificadas explicitamente. O protocolo de execução é definido em worker.py.

Correção validada no KeepLink: colunas BadPkt/erros não substituem GoodPkt quando o template inclui termos genéricos tx/rx.
