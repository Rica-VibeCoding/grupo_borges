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
