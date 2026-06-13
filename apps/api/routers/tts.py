"""POST /api/tts/synth — síntese de voz via edge-tts. JP-21."""
from __future__ import annotations

import io
import re

import edge_tts
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

router = APIRouter()

# --- strip markdown (port de telecodex/src/voice-out.ts) ---
_CODE_BLOCK = re.compile(r'```[\s\S]*?```')
_INLINE_CODE = re.compile(r'`([^`]+)`')
_HTML_TAG = re.compile(r'</?[a-zA-Z][^>]*>')
_MD_LINK = re.compile(r'\[([^\]]+)\]\([^)]+\)')
_MD_HEADER = re.compile(r'^#{1,6}\s+', re.MULTILINE)
_BOLD = re.compile(r'\*\*([^*]+)\*\*')
_ITALIC = re.compile(r'\*([^*]+)\*')
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
    text = _BOLD.sub(r'\1', text)
    text = _ITALIC.sub(r'\1', text)
    text = re.sub(r'^>\s?', '', text, flags=re.MULTILINE)
    text = _URL.sub(' link ', text)
    text = _EMOJI.sub('', text)
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


class TtsSynthRequest(BaseModel):
    text: str
    voice: str = ""
    rate: str = ""
    pitch: str = ""


@router.post("/tts/synth")
async def tts_synth(body: TtsSynthRequest, request: Request) -> Response:
    settings = request.app.state.settings
    text = strip_for_tts(body.text)
    if not text:
        raise HTTPException(status_code=400, detail="texto vazio após limpeza")

    voice = body.voice or settings.tts_voice
    rate = body.rate or settings.tts_rate
    pitch = body.pitch or settings.tts_pitch

    buf = io.BytesIO()
    try:
        communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                buf.write(chunk["data"])
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"TTS falhou: {exc}") from exc

    audio_bytes = buf.getvalue()
    if not audio_bytes:
        raise HTTPException(status_code=500, detail="TTS gerou áudio vazio")

    return Response(content=audio_bytes, media_type="audio/mpeg")
