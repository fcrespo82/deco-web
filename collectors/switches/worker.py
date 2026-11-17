"""Uma solicitação JSON por stdin; uma resposta por stdout. Sem servidor HTTP."""
import contextlib
import io
import json
import logging
import sys
from pathlib import Path

logging.disable(logging.CRITICAL)  # bibliotecas legadas não devem registrar credenciais/HTML


def run(request):
    from scraper import HCSwitchScraper
    config = request["config"]
    model = config["model"]
    if model != "builtin" and not (Path(__file__).parent / "device-templates" / (model + ".yaml")).is_file():
        raise ValueError("Modelo desconhecido")
    if "/" in model or "\\" in model:
        raise ValueError("Modelo inválido")
    scraper = HCSwitchScraper(config)
    scraper.max_retries = 1
    # Evita fallback para uma segunda sessão de login após erro de autenticação.
    def login_once():
        if not scraper._opener:
            original_login()
    original_login = scraper._login
    scraper._login = login_once
    action = request.get("action", "collect")
    if action == "transceiver":
        result = scraper.scrape_transceiver()
        if not result:
            raise ValueError("Diagnóstico SFP indisponível")
        return result
    if action != "collect":
        raise ValueError("Operação não permitida")
    data = scraper.scrape()
    if not data or not data.get("mac") or all(str(p.get("status", "")).lower() == "unknown" for p in data.get("ports", [])):
        raise ValueError("Não foi possível ler o switch; confira conexão, modelo e credenciais")
    try:
        data["mac_table"] = scraper.scrape_mac_table()
        data["mac_error"] = "Tabela MAC incompleta nesta coleta" if getattr(scraper, "_mac_error", False) else None
    except Exception:
        data["mac_table"] = []
        data["mac_error"] = "Não foi possível atualizar a tabela MAC"
    return data


if __name__ == "__main__":
    try:
        request = json.loads(sys.stdin.read(65536))
        # Alguns parsers legados podem usar print; stdout é reservado ao protocolo.
        with contextlib.redirect_stdout(io.StringIO()):
            result = run(request)
        response = {"ok": True, "data": result}
    except Exception:
        response = {"ok": False, "error": "Falha na coleta. Confira conexão, modelo, credenciais e dependências Python."}
    print(json.dumps(response, allow_nan=False))
