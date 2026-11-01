"""Rewind do Claude Code: JSONL para os pontos, TUI para executar com prova.

Nunca usa números das opções: eles mudam quando não há código restaurável.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from services import conversas, tmux_driver
from services.session_reset import publish_session_reset

Acao = Literal["conversa_e_codigo", "conversa", "codigo", "resumir_daqui", "resumir_ate_aqui"]
ROTULOS = {
    "conversa_e_codigo": "Restore code and conversation",
    "conversa": "Restore conversation",
    "codigo": "Restore code",
    "resumir_daqui": "Summarize from here",
    "resumir_ate_aqui": "Summarize up to here",
}
PRAZO_S = 8.0
PASSO_S = 0.1


class RewindError(RuntimeError):
    def __init__(self, motivo: str, status: int = 409):
        super().__init__(motivo)
        self.status = status


@dataclass(frozen=True)
class Tela:
    kind: str
    selected: str = ""
    quote: str | None = None
    options: tuple[str, ...] = ()


def _normal(texto: str) -> str:
    return " ".join(texto.split())


def _rotulo(texto: str) -> str:
    return re.sub(r":?\s+add context.*$", "", re.sub(r"^\d+\.\s*", "", texto)).strip()


def _confere_prompt(visivel: str, ponto: dict) -> bool:
    esperado = _normal(ponto["texto"])
    atual = _normal(visivel)
    # O CC acrescenta … à primeira linha de prompts multilinha.
    return atual == esperado or ("\n" in ponto["texto_completo"] and atual == esperado + "…")


def parse_screen(texto: str) -> Tela:
    linhas = tmux_driver._ANSI_ESCAPE.sub("", texto).splitlines()
    inicio = next(
        (i for i in range(len(linhas) - 1, -1, -1) if linhas[i].strip() == "Rewind"), None
    )
    if inicio is None:
        return Tela("fechado")
    menu = [linha.strip() for linha in linhas[inicio + 1 :]]
    selected = next((linha[1:].strip() for linha in menu if linha.startswith("❯")), "")
    quotes = [linha[1:].strip() for linha in menu if linha.startswith("│")]
    options = tuple(
        _rotulo(linha.removeprefix("❯").strip())
        for linha in menu
        if re.match(r"^(?:❯\s*)?\d+\.", linha)
    )
    if options:
        return Tela("acoes", selected, quotes[0] if quotes else None, options)
    if "Restore the code and/or conversation to the point before…" in menu and selected:
        return Tela("pontos", selected)
    return Tela("desconhecido", selected)


def selected_action(tela: Tela) -> str | None:
    return next(
        (acao for acao, rotulo in ROTULOS.items() if _rotulo(tela.selected) == rotulo), None
    )


def ler_registros(caminho: Path) -> list[dict]:
    registros = []
    with caminho.open() as arquivo:
        for linha in arquivo:
            # Blobs de requests repetem o contexto inteiro. Eles não são
            # mensagens e desserializá-los inflaria a RAM da API.
            if re.match(
                r'^\{\s*"type"\s*:\s*"(?:api-request[^" ]*|file-history[^" ]*|last-prompt)"', linha
            ):
                continue
            try:
                payload = json.loads(linha)
            except ValueError:
                continue
            if not isinstance(payload, dict) or not payload.get("uuid"):
                continue
            registro = {
                k: payload[k]
                for k in (
                    "uuid",
                    "parentUuid",
                    "type",
                    "subtype",
                    "timestamp",
                    "isSidechain",
                    "isMeta",
                    "isCompactSummary",
                    "compactMetadata",
                    "promptSource",
                )
                if k in payload
            }
            if payload.get("type") == "user":
                registro["message"] = payload.get("message")
            elif payload.get("type") == "assistant":
                content = (payload.get("message") or {}).get("content")
                registro["message"] = {
                    "content": [
                        {"type": bloco.get("type"), "name": bloco.get("name")}
                        for bloco in content
                        if isinstance(bloco, dict) and bloco.get("type") == "tool_use"
                    ]
                    if isinstance(content, list)
                    else []
                }
            registros.append(registro)
    return registros


def _ativos(registros: list[dict], leaf: str | None = None) -> set[str]:
    mensagens = {r["uuid"]: r for r in registros if r.get("uuid") and not r.get("isSidechain")}
    ativos: set[str] = set()
    cursor = leaf if leaf is not None else next(reversed(mensagens), "")
    while cursor in mensagens and cursor not in ativos:
        ativos.add(cursor)
        cursor = mensagens[cursor].get("parentUuid")
    # Resumo direcionado rompe a cadeia em compact_boundary, preservando
    # trechos explicitamente. Esses prompts CONTINUAM no menu (medido no CC).
    expandidos: set[str] = set()
    while True:
        boundaries = [
            uid
            for uid in ativos - expandidos
            if mensagens.get(uid, {}).get("subtype") == "compact_boundary"
        ]
        if not boundaries:
            break
        for uid in boundaries:
            expandidos.add(uid)
            meta = mensagens[uid].get("compactMetadata") or {}
            preservados = meta.get("preservedMessages") or {}
            if preservados.get("uuids"):
                ativos.update(preservados["uuids"])
            else:
                segmento = meta.get("preservedSegment") or {}
                cursor = segmento.get("tailUuid")
                vistos: set[str] = set()
                while cursor in mensagens and cursor not in vistos:
                    vistos.add(cursor)
                    ativos.add(cursor)
                    if cursor == segmento.get("headUuid"):
                        break
                    cursor = mensagens[cursor].get("parentUuid")
    return ativos


# Comando de .claude/commands grava <command-message> antes do <command-name>.
_COMANDO = re.compile(
    r"^\s*(?:<command-message>[^<]*</command-message>\s*)?<command-name>(/[^<]+)</command-name>"
)
_ARGS = re.compile(r"<command-args>(.*?)</command-args>", re.DOTALL)


def _texto_do_ponto(registro: dict) -> str | None:
    """O que o menu do /rewind mostra para esta linha, ou None se ela não é ponto.

    Medido 01/11: comando de barra digitado entra ("/reload-plugins --force");
    mensagem de canal (isMeta) e <task-notification> (promptSource=system) não.
    """
    if registro.get("type") != "user" or registro.get("promptSource") == "system":
        return None
    if registro.get("isSidechain") or registro.get("isMeta") or registro.get("isCompactSummary"):
        return None
    texto = conversas._texto_do_usuario(registro) or ""
    comando = _COMANDO.match(texto)
    if comando:
        args = _ARGS.search(texto)
        return f"{comando.group(1)} {args.group(1).strip() if args else ''}".strip()
    return conversas._eh_turno(registro)


def pontos(registros: list[dict], ocultos: set[str] | None = None) -> list[dict]:
    """Só o que o menu lista: prompts digitados e comandos de barra.

    O JSONL é só-acréscimo, inclusive após rewind. A cadeia de pais descarta
    ramos antigos; a máscara persistida cobre o intervalo antes do próximo turno.
    """
    ocultos = ocultos or set()
    ativos = _ativos(registros)
    resultado = []
    for registro in registros:
        uid = registro.get("uuid")
        if uid not in ativos or uid in ocultos:
            continue
        texto = _texto_do_ponto(registro)
        if texto is None:
            continue
        # Resultados com texto e tool_result misturados também não são prompts.
        content = (registro.get("message") or {}).get("content")
        if isinstance(content, list) and any(
            b.get("type") == "tool_result" for b in content if isinstance(b, dict)
        ):
            continue
        resultado.append(
            {
                "id": uid,
                "texto": texto.splitlines()[0],
                "horario": registro.get("timestamp"),
                "arquivo_editado_depois": False,
                "texto_completo": texto,
            }
        )
    # Edição só conta depois do ponto, inclusive no turno do próprio prompt.
    editado = False
    por_id = {p["id"]: p for p in resultado}
    for registro in reversed(registros):
        if registro.get("uuid") not in ativos or registro.get("uuid") in ocultos:
            continue
        content = (registro.get("message") or {}).get("content")
        if registro.get("type") == "assistant" and isinstance(content, list):
            editado |= any(
                b.get("type") == "tool_use" and b.get("name") in conversas._FERRAMENTAS_DE_EDICAO
                for b in content
                if isinstance(b, dict)
            )
        if registro.get("uuid") in por_id:
            por_id[registro["uuid"]]["arquivo_editado_depois"] = editado
    return resultado


def _capturar(pane) -> str:
    return "\n".join(
        pane.capture_pane(
            start=0, end=int(pane.pane_height) - 1, escape_sequences=True, join_wrapped=True
        )
    )


def _esperar(pane, aceita, prazo: float | None = None) -> Tela:
    fim = time.monotonic() + (PRAZO_S if prazo is None else prazo)
    while True:
        tela = parse_screen(_capturar(pane))
        if aceita(tela):
            return tela
        if time.monotonic() >= fim:
            raise RewindError("tela_nao_confirmada")
        time.sleep(PASSO_S)


def _tecla(pane, tecla: str) -> None:
    if not tmux_driver._send_key(pane, tecla):
        raise RewindError("tecla_nao_entregue")


def _cancelar(pane) -> None:
    # Escape em confirmação volta à lista; mais um fecha. Nunca Esc+Esc
    # às cegas: com input vazio isso reabriria o rewind.
    for _ in range(3):
        if parse_screen(_capturar(pane)).kind == "fechado":
            return
        _tecla(pane, "Escape")
        time.sleep(PASSO_S)
    if parse_screen(_capturar(pane)).kind != "fechado":
        raise RewindError("menu_nao_fechou")


def executar_no_pane(pane, alvo: dict, acao: Acao, lista: list[dict]) -> dict:
    snapshot = tmux_driver._capture_input_snapshot(pane)
    if snapshot.state != "empty":
        raise RewindError("campo_ocupado" if snapshot.state == "armed" else "campo_nao_observavel")
    if "esc to interrupt" in _capturar(pane).lower():
        raise RewindError("agente_ocupado")
    aberto = False
    confirmado = False
    try:
        pane.send_keys("/rewind", enter=False)
        armado = tmux_driver._wait_for_input(
            pane,
            lambda s: s.state == "armed" and s.content == "/rewind",
            time.monotonic() + PRAZO_S,
        )
        if armado is None:
            raise RewindError("comando_nao_armado")
        _tecla(pane, "Enter")
        aberto = True
        tela = _esperar(pane, lambda t: t.kind == "pontos")
        # Percorre todos os pontos esperados, conferindo CADA passo. Isso
        # distingue prompts repetidos pelo ordinal, sem escolher um homônimo.
        if tela.selected != "(current)":
            raise RewindError("cursor_inicial_inesperado")
        for ponto in reversed(lista):
            anterior = _capturar(pane)
            _tecla(pane, "Up")
            # Até prompts iguais mudam a posição do cursor na captura. Sem
            # mudança observável não contamos o passo (topo ou tecla perdida).
            fim = time.monotonic() + PRAZO_S
            while _capturar(pane) == anterior:
                if time.monotonic() >= fim:
                    raise RewindError("ponto_nao_encontrado")
                time.sleep(PASSO_S)
            tela = _esperar(
                pane,
                lambda t, ponto=ponto: t.kind == "pontos" and _confere_prompt(t.selected, ponto),
            )
            if not _confere_prompt(tela.selected, ponto):
                raise RewindError("ponto_nao_encontrado")
            if ponto["id"] == alvo["id"]:
                break
        else:
            raise RewindError("ponto_nao_encontrado")
        _tecla(pane, "Enter")
        tela = _esperar(pane, lambda t: t.kind == "acoes")
        if not _confere_prompt(tela.quote or "", alvo):
            raise RewindError("citacao_divergente")
        if ROTULOS[acao] not in tela.options:
            raise RewindError("acao_indisponivel", 422)
        for _ in range(len(tela.options)):
            if selected_action(tela) == acao:
                break
            anterior = tela.selected
            _tecla(pane, "Down")
            tela = _esperar(
                pane, lambda t, anterior=anterior: t.kind == "acoes" and t.selected != anterior
            )
            if not _confere_prompt(tela.quote or "", alvo):
                raise RewindError("citacao_divergente")
        else:
            raise RewindError("acao_nao_encontrada")
        _tecla(pane, "Enter")
        confirmado = True
        _esperar(
            pane, lambda t: t.kind == "fechado", prazo=90 if acao.startswith("resumir") else PRAZO_S
        )
        return {"menu_fechado": True}
    except Exception:
        if aberto and not confirmado:
            _cancelar(pane)
        raise


def _limpar_restaurado(pane, alvo: dict) -> str | None:
    snapshot = tmux_driver._wait_for_input(
        pane, lambda s: s.state != "unknown", time.monotonic() + PRAZO_S
    )
    if snapshot is None:
        raise RewindError("campo_final_nao_observavel")
    if snapshot.state == "empty":
        return None
    if _normal(snapshot.content) != _normal(alvo["texto_completo"]):
        raise RewindError("texto_restaurado_divergente")
    texto = alvo["texto_completo"]
    # Medido no rascunho: C-u só apaga a última linha. Esc+Esc limpa o
    # prompt inteiro. Só damos o segundo Escape se o MESMO texto continua
    # armado: em campo vazio esse atalho abre o menu de novo.
    _tecla(pane, "Escape")
    time.sleep(PASSO_S)
    entre = tmux_driver._capture_input_snapshot(pane)
    if entre.state == "armed" and _normal(entre.content) == _normal(snapshot.content):
        _tecla(pane, "Escape")
    elif entre.state != "empty":
        raise RewindError("campo_mudou_durante_limpeza")
    vazio = tmux_driver._wait_for_input(
        pane, lambda s: s.state == "empty", time.monotonic() + PRAZO_S
    )
    if vazio is None:
        raise RewindError("campo_nao_limpo")
    return texto


def _executar_sync(
    session: str, caminho: Path, ponto_id: str, acao: Acao, db, slug: str, validar
) -> dict:
    lock = tmux_driver._acquire_dispatch_lock(session)
    try:
        validar()
        server = tmux_driver._server_for(session)
        if not server.has_session(session):
            raise RewindError("sessao_ausente")
        pane = server.sessions.get(session_name=session).active_pane
        if (pane.pane_current_command or "").lower() not in tmux_driver._CLAUDE_PANE_COMMANDS:
            raise RewindError("pane_incompativel")
        ocultos = db._rewind_hidden_uuids(slug, caminho.stem)
        registros = ler_registros(caminho)
        lista = pontos(registros, ocultos)
        alvo = next((p for p in lista if p["id"] == ponto_id), None)
        if alvo is None:
            raise RewindError("ponto_inexistente", 422)
        resultado = executar_no_pane(pane, alvo, acao, lista)
        removidos = []
        if acao in {"conversa", "conversa_e_codigo"}:
            registro_alvo = next(r for r in registros if r.get("uuid") == ponto_id)
            mantidos = _ativos(registros, registro_alvo.get("parentUuid") or "")
            removidos = [
                r["uuid"]
                for r in registros
                if r.get("uuid") not in mantidos and not r.get("isSidechain")
            ]
        elif acao.startswith("resumir"):
            mantidos = _ativos(ler_registros(caminho))
            removidos = [
                r["uuid"]
                for r in registros
                if r.get("uuid") not in mantidos and not r.get("isSidechain")
            ]
        # Persiste ANTES de limpar o campo: falha de limpeza não desfaz o
        # rewind já aplicado. Nem uma reinicialização da API ressuscita o feed.
        db._insert_task_event(
            "cockpit:rewind",
            None,
            slug,
            None,
            {
                "sessionId": caminho.stem,
                "ponto_id": ponto_id,
                "acao": acao,
                "ocultos": removidos,
            },
            None,
        )
        resultado["recarregar_feed"] = acao != "codigo"
        if resultado["recarregar_feed"]:
            publish_session_reset(
                slug,
                {
                    "slug": slug,
                    "session_id": caminho.stem,
                    "reason": "rewind",
                    "ponto_id": ponto_id,
                    "acao": acao,
                    "at": int(time.time()),
                },
            )
        resultado["texto_restaurado"] = _limpar_restaurado(pane, alvo)
        return resultado
    finally:
        lock.release()


async def executar(
    session: str, caminho: Path, ponto_id: str, acao: Acao, db, slug: str, validar
) -> dict:
    return await tmux_driver._run_tmux_operation(
        _executar_sync, session, caminho, ponto_id, acao, db, slug, validar
    )
