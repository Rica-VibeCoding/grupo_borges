"""POST /api/tts/synth — síntese de voz da frota. JP-21.

Engine preferido: Google Cloud TTS — mesma voz que cada agente já usa no
Telegram (mapa canônico em ze-shared/.claude/skills/voz/
scripts/tts-google.sh), em dois degraus: Chirp3-HD pra tropa e WaveNet pra quem
fala muito (Daniel e maestro, ordem do Rica em 12/09). Fallback: Microsoft
edge-tts quando o Google falha ou não há API key. A voz é resolvida por `slug`
do agente, então a tropa soa no cockpit com a mesma identidade vocal de sempre.
"""
from __future__ import annotations

import array
import asyncio
import base64
import io
import json
import re
import subprocess
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from pathlib import Path

import edge_tts
import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field, field_validator

router = APIRouter()

# Nome de voz: aceita Chirp3-HD do Google (`pt-BR-Chirp3-HD-Orus`) e Neural do
# edge (`pt-BR-FranciscaNeural`). Travado num formato de segmentos alfanuméricos
# pra fechar param smuggling — sem isso a lib edge interpola o nome sem escape
# no SSML (`<voice name='{voice}'>`), então `'/><inject>` passaria.
_VOICE_RE = re.compile(r'^[a-z]{2,}-[A-Z]{2,}(?:-[A-Za-z0-9]+)+$')

# Mapa canônico de vozes da frota — espelha o tts-google.sh. Resolve a voz pelo
# slug do agente dono do chat. Sem entrada → default.
# Daniel e maestro falam no degrau WaveNet desde 12/09 (ordem do Rica): são os
# dois que mais gastam, e a fatura do Chirp3-HD é por caractere. Wavenet-B e
# Wavenet-E são as duas únicas masculinas de pt-BR no voices.list da API.
FLEET_VOICES: dict[str, str] = {
    "daniel": "pt-BR-Wavenet-E",
    "maestro": "pt-BR-Wavenet-B",
    # O caseiro desceu junto e DIVIDE a voz com o maestro: só existem duas.
    "caseiro": "pt-BR-Wavenet-B",
    # A Tara fala com o Rica no Telegram com a Aoede (feminina) desde o bridge do
    # telecodex; aqui ela herdava a Orus, masculina, e a mesma agente tinha duas
    # vozes conforme a tela. Ordem do Rica em 12/09: o cockpit segue o Telegram.
    "tara": "pt-BR-Chirp3-HD-Aoede",
    "pavan": "pt-BR-Chirp3-HD-Algieba",
    "lucas": "pt-BR-Chirp3-HD-Algenib",
    "felipe": "pt-BR-Chirp3-HD-Iapetus",
    "barsi": "pt-BR-Chirp3-HD-Charon",
    "vinicius": "pt-BR-Chirp3-HD-Puck",
    # Ordem do Rica em 29/09: todo o áudio do canal do Canário sai pela key do
    # Google, feminina. Fora do mapa ele caía na FranciscaNeural do edge; Aoede
    # é da Tara, então Kore.
    "canarinho": "pt-BR-Chirp3-HD-Kore",
}
DEFAULT_GOOGLE_VOICE = "pt-BR-Chirp3-HD-Orus"

# Prefixos que o Google atende — o portão que decide o motor. Voz de fora desta
# lista vai pro edge, e ir pro edge é trocar a voz do agente: quando o Daniel
# desceu pro WaveNet, o portão antigo (só `pt-BR-Chirp3-HD`) mandava a fala dele
# inteira pro edge-tts, calado. Mexer numa voz da frota é mexer aqui junto.
_GOOGLE_VOICE_PREFIXES = ("pt-BR-Chirp3-HD", "pt-BR-Wavenet")


def _is_google_voice(voice: str) -> bool:
    return voice.startswith(_GOOGLE_VOICE_PREFIXES)


# Fallback edge estável por slug: as vozes Chirp3-HD não existem no edge (só
# pt-BR-AntonioNeural e pt-BR-FranciscaNeural), então a correspondência é uma
# escolha de produto, não um espelho do mapa Google. Sem slug → settings.tts_voice
# (se Neural) → Antonio. A rota stream declara a troca no evento `meta` (régua
# da auditoria: nunca trocar a voz em silêncio).
EDGE_FALLBACK_VOICES: dict[str, str] = {
    "daniel": "pt-BR-AntonioNeural",
    "maestro": "pt-BR-AntonioNeural",
    "caseiro": "pt-BR-AntonioNeural",
    "tara": "pt-BR-FranciscaNeural",
    "pavan": "pt-BR-AntonioNeural",
    "lucas": "pt-BR-AntonioNeural",
    "felipe": "pt-BR-AntonioNeural",
    "barsi": "pt-BR-AntonioNeural",
    "vinicius": "pt-BR-AntonioNeural",
    "canarinho": "pt-BR-FranciscaNeural",
}

# Régua de fala por CARACTERES (medida 11/08 no texto de 157 palavras): chars/s
# tem coef. de variação 0,095–0,122 contra 0,123–0,162 de palavras/s — a métrica
# mais estável por sentença, e o resíduo da convergência (b) confirmou (72 vs 81
# picos que movem no trecho já ouvido, média de 3 execuções). A velocidade em si
# é fator de escala que o calibrador acumulado do cliente cancela; o que importa
# é a forma relativa da estimativa por sentença.
_CHARS_PER_SECOND = 16.0
# Densidade dos picos da onda: uma barra por ~50ms de áudio (20 barras/s).
_PEAK_INTERVAL_MS = 50
# Teto de bytes por sentença, com margem abaixo dos 5.000 bytes documentados do
# Google (SynthesisInput) e dos 4.096 bytes do particionamento do edge.
_SENTENCE_BYTE_LIMIT = 4000

# --- strip markdown ---
_CODE_BLOCK = re.compile(r'```[\s\S]*?```')
_INLINE_CODE = re.compile(r'`([^`]+)`')
_HTML_TAG = re.compile(r'</?[a-zA-Z][^>]*>')
_MD_LINK = re.compile(r'\[([^\]]+)\]\([^)]+\)')
_MD_HEADER = re.compile(r'^#{1,6}\s+', re.MULTILINE)
_BOLD = re.compile(r'\*\*([^*]+)\*\*')
_ITALIC = re.compile(r'\*([^*]+)\*')
_BOLD_US = re.compile(r'__([^_]+)__')
_ITALIC_US = re.compile(r'_([^_]+)_')
_URL = re.compile(r'https?://\S+', re.IGNORECASE)
_EMOJI = re.compile(
    r'[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F000-\U0001F2FF️‍]+',
    re.UNICODE,
)


def strip_for_tts(text: str) -> str:
    text = _CODE_BLOCK.sub(' (bloco de código) ', text)
    text = _INLINE_CODE.sub(r'\1', text)
    text = _HTML_TAG.sub('', text)
    text = _MD_LINK.sub(r'\1', text)
    text = _MD_HEADER.sub('', text)
    # bold antes de italic: senão _ITALIC quebraria `**x**` ao casar o 1º par
    text = _BOLD.sub(r'\1', text)
    text = _ITALIC.sub(r'\1', text)
    text = _BOLD_US.sub(r'\1', text)
    text = _ITALIC_US.sub(r'\1', text)
    text = re.sub(r'^>\s?', '', text, flags=re.MULTILINE)
    text = _URL.sub(' link ', text)
    text = _EMOJI.sub('', text)
    # entidades HTML comuns (resíduo de markdown→html): lidas literais no TTS
    text = (
        text.replace('&amp;', 'e')
        .replace('&lt;', '')
        .replace('&gt;', '')
        .replace('&quot;', '"')
        .replace('&#39;', "'")
    )
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


class TtsSynthRequest(BaseModel):
    # max_length alinha com o padrão dos outros routers (agents.py usa 8192) e
    # fecha DoS por texto colado gigante segurando a síntese.
    text: str = Field(min_length=1, max_length=8192)
    # slug do agente dono do chat — resolve a voz da frota. Vazio = default.
    slug: str = Field(default="", max_length=40)
    # override explícito de voz; se vazio, resolve por slug.
    voice: str = ""
    rate: str = ""
    pitch: str = ""

    @field_validator("voice")
    @classmethod
    def _validate_voice(cls, v: str) -> str:
        if v and not _VOICE_RE.match(v):
            raise ValueError("voice fora do formato esperado (ex: pt-BR-Chirp3-HD-Orus)")
        return v

    @field_validator("slug")
    @classmethod
    def _validate_slug(cls, v: str) -> str:
        if v and not re.fullmatch(r'[a-z0-9_-]+', v):
            raise ValueError("slug inválido")
        return v


def _resolve_voice(body: TtsSynthRequest, settings) -> str:
    """Override explícito > `.env` do workspace > voz da frota pelo slug > default Chirp3-HD."""
    if body.voice:
        return body.voice
    # A voz do Telegram é a canônica: o `tts-google.sh` lê o GOOGLE_TTS_VOICE
    # deste mesmo `.env`; o mapa abaixo é só o default dele copiado.
    do_env = _env_do_agente(body.slug).get("GOOGLE_TTS_VOICE", "")
    if _VOICE_RE.match(do_env):
        return do_env
    if body.slug and body.slug in FLEET_VOICES:
        return FLEET_VOICES[body.slug]
    return settings.tts_voice or DEFAULT_GOOGLE_VOICE


# Contador de caracteres por origem. A GOOGLE_TTS_API_KEY é UMA pra frota
# inteira, então o painel do Google não separa quem gastou — este arquivo é o
# único lugar onde o gasto tem dono, e a soma de `chars` é o número que a fatura
# cobra (o Google conta codepoint Unicode, espaço incluído). Caminho absoluto de
# propósito: os quatro produtores que batem na mesma chave (skill voz, estas
# duas rotas, telecodex e orcamento-inteligente) precisam cair no MESMO arquivo.
_USO_LOG = Path("/home/clawd/.claude/metrics/tts-uso.jsonl")


def _registra_uso(origem: str, slug: str, voice: str, text: str, engine: str = "google") -> None:
    """Uma linha por síntese que o Google ACEITOU — é o que ele cobra. Falhar
    aqui nunca pode derrubar a fala: contador é observabilidade, não requisito."""
    try:
        _USO_LOG.parent.mkdir(parents=True, exist_ok=True)
        linha = json.dumps(
            {
                "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "origem": origem,
                "slug": slug,
                "voz": voice,
                "chars": len(text),
                "engine": engine,
                "http": 200,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
        with _USO_LOG.open("a", encoding="utf-8") as fh:
            fh.write(linha + "\n")
    except Exception:
        pass


async def _synth_google(text: str, voice: str, api_key: str, origem: str, slug: str) -> bytes:
    """Google Cloud TTS REST v1 — mesmo payload do tts-google.sh."""
    language_code = "-".join(voice.split("-")[:2])  # pt-BR-Chirp3-HD-Orus → pt-BR
    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.post(
            f"https://texttospeech.googleapis.com/v1/text:synthesize?key={api_key}",
            json={
                "input": {"text": text},
                "voice": {"languageCode": language_code, "name": voice},
                "audioConfig": {"audioEncoding": "MP3", "pitch": 0, "speakingRate": 1.0},
            },
        )
    if res.status_code != 200:
        raise RuntimeError(f"Google TTS HTTP {res.status_code}: {res.text[:200]}")
    audio_content = res.json().get("audioContent")
    if not audio_content:
        raise RuntimeError("Google TTS sem audioContent")
    _registra_uso(origem, slug, voice, text)
    return base64.b64decode(audio_content)


# Motor pago por agente: o MESMO `.env` do workspace que o `falar.py` lê para o
# Telegram (`TTS_MOTOR=minimax` + `MINIMAX_*`), lido a cada fala — trocar a voz
# lá troca aqui, sem restart. Ordem do Rica em 29/09: a voz do painel é a do Telegram.
_WORKSPACES = Path("/home/clawd/repos/ze_claude")
_ENV_LINHA = re.compile(r'^(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$', re.MULTILINE)


def _env_do_agente(slug: str) -> dict[str, str]:
    if not slug:
        return {}
    try:
        env = (_WORKSPACES / slug / ".env").read_text(encoding="utf-8")
    except OSError:
        return {}
    return {k: val.strip().strip('"\'') for k, val in _ENV_LINHA.findall(env)}


def _minimax_do_agente(slug: str) -> dict | None:
    v = _env_do_agente(slug)
    if v.get("TTS_MOTOR") != "minimax" or not v.get("MINIMAX_API_KEY"):
        return None
    # Mesmos padrões do tts-minimax.sh.
    return {
        "key": v["MINIMAX_API_KEY"],
        "voice": v.get("MINIMAX_VOICE_ID") or "Portuguese_ReliableMan",
        "model": v.get("MINIMAX_MODEL") or "speech-2.8-hd",
        "emotion": v.get("MINIMAX_EMOTION") or "neutral",
        "speed": float(v.get("MINIMAX_SPEED") or 1),
    }


async def _synth_minimax(text: str, cfg: dict, slug: str) -> bytes:
    """MiniMax T2A v2 — mesmo payload do tts-minimax.sh."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.post(
            "https://api.minimax.io/v1/t2a_v2",
            headers={"Authorization": f"Bearer {cfg['key']}"},
            json={
                "model": cfg["model"],
                "text": text,
                "stream": False,
                "language_boost": "Portuguese",
                "voice_setting": {"voice_id": cfg["voice"], "emotion": cfg["emotion"], "speed": cfg["speed"]},
                "audio_setting": {"format": "mp3", "sample_rate": 32000},
            },
        )
    corpo = res.json() if res.status_code == 200 else {}
    if corpo.get("base_resp", {}).get("status_code") != 0:
        raise RuntimeError(f"MiniMax HTTP {res.status_code}: {corpo.get('base_resp') or res.text[:200]}")
    audio = (corpo.get("data") or {}).get("audio")
    if not audio:
        raise RuntimeError("MiniMax sem áudio")
    _registra_uso("cockpit-stream", slug, cfg["voice"], text, "minimax")
    return bytes.fromhex(audio)


async def _synth_edge(text: str, voice: str, rate: str, pitch: str) -> bytes:
    """Fallback Microsoft edge-tts. Vozes Chirp3-HD não existem aqui — usa
    a voz Neural configurada (settings.tts_voice se for Neural, senão default)."""
    edge_voice = voice if voice.endswith("Neural") else "pt-BR-AntonioNeural"
    buf = io.BytesIO()
    communicate = edge_tts.Communicate(text, edge_voice, rate=rate, pitch=pitch)
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            buf.write(chunk["data"])
    return buf.getvalue()


# Quebra o texto limpo em sentenças pela pontuação final (. ! ? …) e por linha
# em branco, depois fragmenta por bytes o que passar do teto. Sintetizar por
# sentença já resolve na prática o limite de 5.000 bytes do Google; o guard de
# bytes fecha o caso de uma "sentença" gigante sem pontuação.
_SENTENCE_END = re.compile(r"(?<=[.!?…])\s+|(?:\r?\n){2,}")

# Abreviações comuns em pt-BR que terminam com ponto e NÃO encerram sentença
# ("Dr. Silva" não é duas frases). O split quebra e o re-junte repara.
_ABBREVIATION_END = re.compile(
    r"\b(?:Dr|Dra|Sr|Sra|Srta|Prof|Profa|Ex|Exmo|Exma|etc|Fig|Cap|Art|Ref|"
    r"Vol|pp|vs|Obs|av|s|p)\.$",
    re.IGNORECASE,
)


def _fragment_by_bytes(s: str, limit: int = _SENTENCE_BYTE_LIMIT) -> list[str]:
    """Garante que cada pedaço fique abaixo de `limit` bytes UTF-8."""
    if len(s.encode("utf-8")) <= limit:
        return [s]
    out: list[str] = []
    buf = ""
    for word in s.split():
        cand = (buf + " " + word).strip()
        if len(cand.encode("utf-8")) > limit:
            if buf:
                out.append(buf)
            buf = word
        else:
            buf = cand
    if buf:
        out.append(buf)
    return out


def _split_sentences(text: str) -> list[str]:
    pieces = [p.strip() for p in _SENTENCE_END.split(text) if p.strip()]
    parts: list[str] = []
    i = 0
    while i < len(pieces):
        piece = pieces[i]
        # peça que termina em abreviação continua na próxima ("Dr." + "Silva")
        while i + 1 < len(pieces) and _ABBREVIATION_END.search(piece):
            i += 1
            piece = f"{piece} {pieces[i]}"
        parts.extend(_fragment_by_bytes(piece))
        i += 1
    if parts:
        parts[:1] = _cut_first_sentence(parts[0])
    return parts


# O primeiro som só sai quando a PRIMEIRA sentença inteira foi sintetizada, e o
# tempo do provedor cresce com o tamanho dela (~1,3 s em 23 caracteres, ~2,4 s
# em ~180). Primeira sentença longa corta no primeiro ponto natural — vírgula,
# dois-pontos, ponto e vírgula ou travessão seguido de espaço — que caia entre o
# mínimo e o máximo. Sem ponto natural, não corta: palavra nunca quebra ao meio.
_FIRST_CUT_TRIGGER = 60
_FIRST_CUT_MIN = 15
_FIRST_CUT_MAX = 80
_NATURAL_PAUSE = re.compile(r"[,;:—–](?=\s)")


def _cut_first_sentence(s: str) -> list[str]:
    if len(s) <= _FIRST_CUT_TRIGGER:
        return [s]
    for m in _NATURAL_PAUSE.finditer(s):
        cut = m.end()
        if cut > _FIRST_CUT_MAX:
            break
        if cut >= _FIRST_CUT_MIN:
            return [s[:cut].strip(), s[cut:].strip()]
    return [s]


def _estimate_duration(text: str) -> float:
    return len(text) / _CHARS_PER_SECOND


def _resolve_edge_fallback(voice: str, slug: str, settings) -> str:
    """Voz edge do fallback sem o silêncio da auditoria (que trocava tudo por
    Antonio). Preserva a voz se já for Neural (override explícito); senão usa a
    correspondência da frota por slug; senão o default de configuração."""
    if voice.endswith("Neural"):
        return voice
    if slug in EDGE_FALLBACK_VOICES:
        return EDGE_FALLBACK_VOICES[slug]
    cfg = getattr(settings, "tts_voice", "") or ""
    if cfg.endswith("Neural"):
        return cfg
    return "pt-BR-AntonioNeural"


def _peaks_from_mp3(mp3_bytes: bytes) -> tuple[float, list[float]]:
    """Decodifica o MP3 (ffmpeg, presente na VPS) em PCM f32 24 kHz mono e
    reduz a uma barra de pico (máx. abs.) por janela de ~50ms, normalizada pela
    sentença. Devolve (duração_real, picos)."""
    proc = subprocess.run(
        [
            "ffmpeg", "-loglevel", "error", "-i", "pipe:0",
            "-f", "f32le", "-ac", "1", "-ar", "24000", "-",
        ],
        input=mp3_bytes,
        capture_output=True,
        timeout=15,
    )
    if proc.returncode != 0 or not proc.stdout:
        raise RuntimeError(f"ffmpeg falhou ao decodificar: {proc.stderr[:200]!r}")
    samples = array.array("f")
    samples.frombytes(proc.stdout)
    duration = len(samples) / 24000
    window = int(24000 * _PEAK_INTERVAL_MS / 1000)
    peaks = [
        max(abs(v) for v in samples[i : i + window])
        for i in range(0, len(samples), window)
    ]
    # Escala 5 bits (0–31), padrão do Telegram que a UI do Hiro adota
    # (PEAK_MAX = 31 em bolha-voz.ts). Normalizado por sentença.
    PEAK_MAX = 31
    mx = max(peaks, default=0.0) or 1.0
    return duration, [min(PEAK_MAX, round(PEAK_MAX * p / mx)) for p in peaks]


def _sse(event: str, data: dict) -> str:
    """Evento SSE no formato text/event-stream (nome + data JSON)."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def _stream_tts(
    sentences: list[str],
    voice: str,
    body: TtsSynthRequest,
    settings,
) -> AsyncIterator[str]:
    api_key = getattr(settings, "google_tts_api_key", "") or ""
    rate = body.rate or settings.tts_rate
    pitch = body.pitch or settings.tts_pitch

    # Engine decidida pela primeira sentença (a voz não muda no meio da fala):
    # MiniMax se o agente a configurou, senão Google. Sem key Google ou voz que
    # o Google não atende, já nasce no edge. `degraded` = não é a voz dele.
    minimax = _minimax_do_agente(body.slug)
    first_mp3: bytes | None = None
    engine = "edge"
    if minimax:
        try:
            first_mp3 = await _synth_minimax(sentences[0], minimax, body.slug)
            engine = "minimax"
        except Exception:
            pass
    if first_mp3 is None and api_key and _is_google_voice(voice):
        try:
            first_mp3 = await _synth_google(
                sentences[0], voice, api_key, "cockpit-stream", body.slug
            )
            engine = "google"
        except Exception:
            pass

    preferido = "minimax" if minimax else "google"
    edge_voice = _resolve_edge_fallback(voice, body.slug, settings)

    # A sentença 0 é sintetizada antes do meta (e sua duração real vira a
    # referência da largura inicial). NÃO a usamos para calibrar a régua por
    # sentença: medido no texto de 157 palavras, o erro é VARIÂNCIA, não viés
    # parelho (razões reais/estimadas de 0,92 a 1,29 por sentença; palavras/s
    # com coef. de variação 0,162). O calibrador da 1ª sentença piorou o total
    # (46,4s estimados vs 57,7s reais; a régua pura deu 51,6s). Quem faz a
    # referência convergir é o cliente — acumulando os reais dos `peaks` + a
    # estimativa das sentenças que faltam (`id` + `segments` do meta bastam).
    # A régua é por caracteres (16 chars/s), a métrica mais estável medida.
    if first_mp3 is None:
        first_mp3 = await _synth_edge(sentences[0], edge_voice, rate, pitch)
    first_duration, first_peaks = await asyncio.to_thread(_peaks_from_mp3, first_mp3)

    acc = 0.0
    segments = []
    for i, sent in enumerate(sentences):
        seg_dur = _estimate_duration(sent)
        segments.append(
            {"id": i, "start": round(acc, 2), "duration_estimate": round(seg_dur, 2)}
        )
        acc += seg_dur
    total_estimate = acc

    yield _sse(
        "meta",
        {
            "voice": {"edge": edge_voice, "minimax": minimax["voice"] if minimax else ""}.get(engine, voice),
            "engine": engine,
            "degraded": engine != preferido,
            "duration_estimate": round(total_estimate, 2),
            "peaks_per_second": int(1000 / _PEAK_INTERVAL_MS),
            "segments": segments,
        },
    )

    # Restrição do Hiro: picos da sentença chegam ANTES do áudio dela — nunca
    # depois (redesenhar o que já foi ouvido lê como defeito). O stream SSE
    # entrega na ordem de escrita. `id` + `segments` do meta bastam pro cliente
    # calcular "real acumulado + estimativa calibrada do que falta".
    durations: list[float] = [first_duration]
    yield _sse("peaks", {"id": 0, "duration": round(first_duration, 2), "peaks": first_peaks})
    yield _sse("audio", {"id": 0, "b64": base64.b64encode(first_mp3).decode()})

    current_engine = engine
    for i, sent in enumerate(sentences[1:], start=1):
        try:
            if current_engine == "minimax":
                mp3 = await _synth_minimax(sent, minimax, body.slug)
            elif current_engine == "google":
                mp3 = await _synth_google(sent, voice, api_key, "cockpit-stream", body.slug)
            else:
                mp3 = await _synth_edge(sent, edge_voice, rate, pitch)
        except Exception as exc:
            # Regressão de robustez apontada na revisão: falha transitória numa
            # sentença não pode cortar a fala no meio. Tenta o edge naquela
            # sentença antes de desistir — a voz troca e isso é DECLARADO, mas
            # fala inteira em voz trocada é melhor que meia fala (a rota antiga
            # caía no edge e entregava a resposta inteira).
            if current_engine != "edge":
                try:
                    mp3 = await _synth_edge(sent, edge_voice, rate, pitch)
                except Exception as exc2:
                    yield _sse("error", {"id": i, "message": f"sentença {i} falhou ({current_engine} e edge): {exc2}"})
                    return
                current_engine = "edge"
                yield _sse("degraded", {"engine": "edge", "voice": edge_voice, "sentenca": i})
            else:
                yield _sse("error", {"id": i, "message": f"sentença {i} falhou: {exc}"})
                return

        duration, peaks = await asyncio.to_thread(_peaks_from_mp3, mp3)
        durations.append(duration)
        yield _sse("peaks", {"id": i, "duration": round(duration, 2), "peaks": peaks})
        yield _sse("audio", {"id": i, "b64": base64.b64encode(mp3).decode()})

    yield _sse("done", {"duration": round(sum(durations), 2)})


@router.post("/tts/synth")
async def tts_synth(body: TtsSynthRequest, request: Request) -> Response:
    settings = request.app.state.settings
    text = strip_for_tts(body.text)
    if not text:
        raise HTTPException(status_code=400, detail="texto vazio após limpeza")

    voice = _resolve_voice(body, settings)
    rate = body.rate or settings.tts_rate
    pitch = body.pitch or settings.tts_pitch
    api_key = getattr(settings, "google_tts_api_key", "") or ""

    audio_bytes = b""
    google_err: str | None = None

    # Engine preferido: Google (voz da frota). Sem key ou falha → edge.
    if api_key and _is_google_voice(voice):
        try:
            audio_bytes = await _synth_google(text, voice, api_key, "cockpit-synth", body.slug)
        except Exception as exc:
            google_err = str(exc)

    if not audio_bytes:
        try:
            audio_bytes = await _synth_edge(text, voice, rate, pitch)
        except Exception as exc:
            detail = f"TTS falhou (edge: {exc}"
            detail += f"; google: {google_err})" if google_err else ")"
            raise HTTPException(status_code=500, detail=detail) from exc

    if not audio_bytes:
        raise HTTPException(status_code=500, detail="TTS gerou áudio vazio")

    return Response(content=audio_bytes, media_type="audio/mpeg")


@router.post("/tts/synth/stream")
async def tts_synth_stream(body: TtsSynthRequest, request: Request) -> StreamingResponse:
    """Mesmo contrato do /tts/synth, mas por sentença e via SSE (text/event-stream).

    Eventos: `meta` (duração estimada + posição das sentenças na onda), depois,
    para cada sentença, `peaks` (antes do áudio) e `audio` (MP3 base64), e por
    fim `done` (duração real) ou `error`. Picos antes do áudio são o contrato da
    UI: a onda nasce na largura final com fantasmas e cada sentença substitui as
    suas sem redesenhar o que já foi ouvido.
    """
    settings = request.app.state.settings
    text = strip_for_tts(body.text)
    if not text:
        raise HTTPException(status_code=400, detail="texto vazio após limpeza")

    voice = _resolve_voice(body, settings)
    sentences = _split_sentences(text)
    if not sentences:
        raise HTTPException(status_code=400, detail="texto sem sentenças")

    return StreamingResponse(
        _stream_tts(sentences, voice, body, settings),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
