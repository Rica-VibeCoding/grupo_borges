"""POST /api/tts/synth — síntese de voz da frota. JP-21.

Engine preferido: Google Cloud TTS (Chirp3-HD) — mesma voz que cada agente já
usa no Telegram/telecodex (mapa canônico em ze-shared/.claude/skills/voz/
scripts/tts-google.sh). Fallback: Microsoft edge-tts quando o Google falha ou
não há API key. A voz é resolvida por `slug` do agente, então a tropa soa no
cockpit com a mesma identidade vocal de sempre.
"""
from __future__ import annotations

import base64
import io
import re

import edge_tts
import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator

router = APIRouter()

# Nome de voz: aceita Chirp3-HD do Google (`pt-BR-Chirp3-HD-Orus`) e Neural do
# edge (`pt-BR-FranciscaNeural`). Travado num formato de segmentos alfanuméricos
# pra fechar param smuggling — sem isso a lib edge interpola o nome sem escape
# no SSML (`<voice name='{voice}'>`), então `'/><inject>` passaria.
_VOICE_RE = re.compile(r'^[a-z]{2,}-[A-Z]{2,}(?:-[A-Za-z0-9]+)+$')

# Mapa canônico de vozes da frota (Google Chirp3-HD) — espelha o tts-google.sh.
# Resolve a voz pelo slug do agente dono do chat. Sem entrada → default.
FLEET_VOICES: dict[str, str] = {
    "daniel": "pt-BR-Chirp3-HD-Orus",
    "tara": "pt-BR-Chirp3-HD-Orus",
    "pavan": "pt-BR-Chirp3-HD-Algieba",
    "lucas": "pt-BR-Chirp3-HD-Algenib",
    "felipe": "pt-BR-Chirp3-HD-Iapetus",
    "barsi": "pt-BR-Chirp3-HD-Charon",
    "vinicius": "pt-BR-Chirp3-HD-Puck",
}
DEFAULT_GOOGLE_VOICE = "pt-BR-Chirp3-HD-Orus"

# --- strip markdown (port de telecodex/src/voice-out.ts) ---
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
    """Override explícito > voz da frota pelo slug > default Chirp3-HD."""
    if body.voice:
        return body.voice
    if body.slug and body.slug in FLEET_VOICES:
        return FLEET_VOICES[body.slug]
    return settings.tts_voice or DEFAULT_GOOGLE_VOICE


async def _synth_google(text: str, voice: str, api_key: str) -> bytes:
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
    return base64.b64decode(audio_content)


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

    # Engine preferido: Google Chirp3-HD (voz da frota). Sem key ou falha → edge.
    if api_key and voice.startswith("pt-BR-Chirp3-HD"):
        try:
            audio_bytes = await _synth_google(text, voice, api_key)
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
