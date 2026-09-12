"""Cobertura das funções puras da rota de TTS streaming (rota do canário, 11/08).

Protege os dois defeitos que a auditoria da Tara apontou e que a rota nova
corrige: o limite de 5.000 bytes do Google (split por sentença + guard de
bytes) e o fallback edge com degradação declarada (nunca voz trocada em
silêncio). Funções puras — sem app, sem rede; o único ffmpeg real é o MP3
sintético de 0,3s usado pra validar `_peaks_from_mp3` e o fluxo.
"""
from __future__ import annotations

import asyncio
import json
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from routers import tts  # noqa: E402


def _mp3_teste() -> bytes:
    """MP3 sintético de ~0,3s (sine via ffmpeg)."""
    proc = subprocess.run(
        [
            "ffmpeg", "-loglevel", "error", "-f", "lavfi",
            "-i", "sine=frequency=440:duration=0.3",
            "-c:a", "libmp3lame", "-f", "mp3", "-",
        ],
        capture_output=True,
        check=True,
    )
    return proc.stdout


# --- split / fragment / limite (defeito 1) --------------------------------


def test_split_quebra_por_pontuacao() -> None:
    sents = tts._split_sentences("Primeira frase. Segunda frase! Terceira?")
    assert sents == ["Primeira frase.", "Segunda frase!", "Terceira?"]


def test_split_nao_quebra_abreviacao() -> None:
    # "Dr. Silva" não é duas sentenças — sem isso, chamada extra ao Google
    # e pausa artificial no meio do nome.
    sents = tts._split_sentences("O Dr. Silva atendeu. Depois saiu.")
    assert sents == ["O Dr. Silva atendeu.", "Depois saiu."]


def test_split_quebra_paragrafo_sem_pontuacao() -> None:
    sents = tts._split_sentences("Linha um\n\nLinha dois")
    assert len(sents) == 2


def test_fragment_por_bytes_respeita_limite_google() -> None:
    # texto gigante sem pontuação passava dos 5.000 bytes do Google sem medir
    texto = ("palavra " * 2000).strip()
    parts = tts._fragment_by_bytes(texto)
    assert len(parts) > 1
    assert all(len(p.encode("utf-8")) <= tts._SENTENCE_BYTE_LIMIT for p in parts)


def test_split_gigante_tudo_abaixo_do_limite() -> None:
    texto = ("palavra " * 2000).strip()
    sents = tts._split_sentences(texto)
    assert len(sents) > 1
    assert all(len(p.encode("utf-8")) <= tts._SENTENCE_BYTE_LIMIT for p in sents)


# --- estimativa -----------------------------------------------------------


def test_estimate_duration_usa_regua() -> None:
    # régua por caracteres: 16 chars/s (métrica mais estável que palavras)
    texto = " ".join(["palavra"] * 100)
    assert tts._estimate_duration(texto) == pytest.approx(len(texto) / 16.0)


# --- contador de uso (fatura de agosto) -----------------------------------


def test_registra_uso_grava_linha_por_sintese(tmp_path, monkeypatch) -> None:
    # A chave do Google é uma só pra frota: sem este arquivo não existe número
    # por origem. Duas sínteses = duas linhas (append-only, nunca sobrescreve).
    alvo = tmp_path / "metrics" / "tts-uso.jsonl"
    monkeypatch.setattr(tts, "_USO_LOG", alvo)

    tts._registra_uso("cockpit-stream", "daniel", "pt-BR-Chirp3-HD-Orus", "Olá, coração.")
    tts._registra_uso("cockpit-synth", "pavan", "pt-BR-Chirp3-HD-Algieba", "Oi.")

    linhas = [json.loads(l) for l in alvo.read_text(encoding="utf-8").splitlines()]
    assert len(linhas) == 2
    assert set(linhas[0]) == {"ts", "origem", "slug", "voz", "chars", "engine", "http"}
    # o Google cobra por CODEPOINT com espaço incluído, não por byte UTF-8:
    # "Olá, coração." tem 13 codepoints e 15 bytes.
    assert linhas[0]["chars"] == 13
    assert linhas[0]["origem"] == "cockpit-stream"
    assert linhas[0]["slug"] == "daniel"
    assert linhas[1]["origem"] == "cockpit-synth"
    assert linhas[0]["engine"] == "google" and linhas[0]["http"] == 200


def test_registra_uso_nao_derruba_a_fala(tmp_path, monkeypatch) -> None:
    # Contador é observabilidade: log inacessível (aqui, um arquivo no lugar do
    # diretório) não pode levantar dentro da síntese.
    bloqueio = tmp_path / "bloqueio"
    bloqueio.write_text("não sou diretório")
    monkeypatch.setattr(tts, "_USO_LOG", bloqueio / "tts-uso.jsonl")

    tts._registra_uso("cockpit-synth", "daniel", "pt-BR-Chirp3-HD-Orus", "texto")


# --- portão do motor: qual voz o Google atende ----------------------------


def test_mapa_da_frota_poe_daniel_e_maestro_no_wavenet() -> None:
    # Ordem do Rica em 12/09: os dois que mais falam descem de degrau. A fatura
    # do Chirp3-HD é por caractere, e agosto fechou em 1.239.745.
    assert tts.FLEET_VOICES["daniel"] == "pt-BR-Wavenet-E"
    assert tts.FLEET_VOICES["maestro"] == "pt-BR-Wavenet-B"
    # o caseiro divide a voz com o maestro: pt-BR só tem duas WaveNet masculinas
    assert tts.FLEET_VOICES["caseiro"] == "pt-BR-Wavenet-B"


def test_tara_fala_no_cockpit_com_a_voz_do_telegram() -> None:
    # Mesma agente com duas vozes conforme a tela é defeito de identidade, não
    # de motor: o mapa aqui se declara espelho do tts-google.sh, e lá ela é Aoede.
    assert tts.FLEET_VOICES["tara"] == "pt-BR-Chirp3-HD-Aoede"


def test_portao_do_motor_aceita_wavenet_e_chirp_e_recusa_edge() -> None:
    assert tts._is_google_voice("pt-BR-Wavenet-E") is True
    assert tts._is_google_voice("pt-BR-Chirp3-HD-Algieba") is True
    assert tts._is_google_voice("pt-BR-AntonioNeural") is False


def test_stream_com_voz_wavenet_fala_pelo_google(monkeypatch) -> None:
    """O portão decide o MOTOR por prefixo da voz. Enquanto ele só conhecia
    `pt-BR-Chirp3-HD`, descer o Daniel pro WaveNet jogava a fala inteira no
    edge-tts — voz trocada em silêncio, o defeito que esta rota existe pra não
    repetir. Aqui o edge é proibido: se o portão fechar, o teste estoura."""
    mp3 = _mp3_teste()
    vozes_pedidas: list[str] = []

    async def _google_ok(_text, voice, _key, _origem, _slug):
        vozes_pedidas.append(voice)
        return mp3

    async def _edge_proibido(*_a, **_k):
        raise AssertionError("voz do Google caiu no edge — portão fechado")

    monkeypatch.setattr(tts, "_synth_google", _google_ok)
    monkeypatch.setattr(tts, "_synth_edge", _edge_proibido)

    body = _FakeBody()
    body.slug = "daniel"
    settings = _FakeSettings()
    settings.google_tts_api_key = "chave-de-teste"
    sents = tts._split_sentences(tts.strip_for_tts(body.text))

    events: dict[str, list[dict]] = {}

    async def _coletar() -> None:
        async for ev in tts._stream_tts(sents, "pt-BR-Wavenet-E", body, settings):
            e = ev.split("\n", 1)[0].replace("event: ", "").strip()
            d = json.loads(ev.split("data: ", 1)[1].strip())
            events.setdefault(e, []).append(d)

    asyncio.run(_coletar())

    meta = events["meta"][0]
    assert meta["engine"] == "google"
    assert meta["degraded"] is False
    assert meta["voice"] == "pt-BR-Wavenet-E"
    assert vozes_pedidas == ["pt-BR-Wavenet-E"] * len(sents)
    assert "degraded" not in events  # nada a declarar: a voz é a que ele pediu


# --- fallback edge declarado (defeito 2) ----------------------------------


class _FakeSettings:
    google_tts_api_key = ""
    tts_voice = "pt-BR-FranciscaNeural"
    tts_rate = "+0%"
    tts_pitch = "+0Hz"


def test_resolve_edge_fallback_preserva_neural() -> None:
    assert tts._resolve_edge_fallback("pt-BR-FranciscaNeural", "daniel", _FakeSettings()) == "pt-BR-FranciscaNeural"


def test_resolve_edge_fallback_usa_mapa_por_slug() -> None:
    # tara mapeada pra Francisca no fallback — não mais Antonio fixo
    assert tts._resolve_edge_fallback("pt-BR-Chirp3-HD-Orus", "tara", _FakeSettings()) == "pt-BR-FranciscaNeural"


def test_resolve_edge_fallback_slug_desconhecido_usa_config() -> None:
    assert tts._resolve_edge_fallback("pt-BR-Chirp3-HD-Orus", "naoexiste", _FakeSettings()) == "pt-BR-FranciscaNeural"


def test_resolve_edge_fallback_default_antonio() -> None:
    class S:
        tts_voice = ""

    assert tts._resolve_edge_fallback("pt-BR-Chirp3-HD-Orus", "", S()) == "pt-BR-AntonioNeural"


# --- peaks ----------------------------------------------------------------


def test_peaks_from_mp3_retorna_duracao_e_escala_31() -> None:
    dur, peaks = tts._peaks_from_mp3(_mp3_teste())
    assert dur > 0
    assert len(peaks) > 0
    assert all(isinstance(p, int) and 0 <= p <= 31 for p in peaks)
    assert max(peaks) >= 1


# --- fluxo: degradação declarada + calibração pela sentença 0 -------------


class _FakeBody:
    text = "Primeira sentença. Segunda sentença."
    slug = "tara"
    voice = ""
    rate = ""
    pitch = ""


def test_stream_declara_degradacao_quando_google_falha(monkeypatch) -> None:
    mp3 = _mp3_teste()

    def _falha_google(*_a, **_k):
        raise RuntimeError("chave inválida")

    async def _edge_ok(*_a, **_k):
        return mp3

    monkeypatch.setattr(tts, "_synth_google", _falha_google)
    monkeypatch.setattr(tts, "_synth_edge", _edge_ok)

    body = _FakeBody()
    settings = _FakeSettings()
    settings.google_tts_api_key = "chave-invalida"  # força o caminho google→edge
    sents = tts._split_sentences(tts.strip_for_tts(body.text))

    events: dict[str, list[dict]] = {}

    async def _coletar() -> None:
        async for ev in tts._stream_tts(sents, "pt-BR-Chirp3-HD-Orus", body, settings):
            e = ev.split("\n", 1)[0].replace("event: ", "").strip()
            d = json.loads(ev.split("data: ", 1)[1].strip())
            events.setdefault(e, []).append(d)

    asyncio.run(_coletar())

    meta = events["meta"][0]
    assert meta["engine"] == "edge"
    assert meta["degraded"] is True
    assert meta["voice"] == "pt-BR-FranciscaNeural"  # mapa da tara
    assert len(events["peaks"]) == 2
    assert len(events["audio"]) == 2
    assert "done" in events
    # a estimativa do meta é a régua pura por caracteres (16 chars/s); a
    # calibração por ponto único foi descartada por medição (variância, piora o
    # total). Nunca igualdade de duração REAL de áudio — a síntese do Google
    # não é determinística (56,8–59,9s no mesmo texto, medido 11/08).
    assert meta["segments"][0]["duration_estimate"] == round(
        tts._estimate_duration(sents[0]), 2
    )
