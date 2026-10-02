"""gzip nas respostas da API — só corpo INTEIRO, só texto.

O cockpit usa `compress: true` no Next. Cada stream SSE da API passa por um route
handler que acrescenta `Cache-Control: no-transform`, para não receber gzip no
Next. Esta camada comprime apenas respostas textuais de corpo inteiro da API.

Por que não o `GZipMiddleware` do Starlette. Conferido na versão instalada
(Starlette 1.0.0, `starlette/middleware/gzip.py`): ele JÁ exclui
`text/event-stream` (`DEFAULT_EXCLUDED_CONTENT_TYPES`, casado por prefixo do
content-type) — o SSE estaria a salvo. O que ele não exclui é todo o resto:
comprime com nível 9, dentro do event loop, a foto, o vídeo e o PDF que
`GET /api/agents/{slug}/file/...` e o mount `/uploads` servem — bytes que já
vêm comprimidos, e arquivo de megabytes segurando a API inteira enquanto a
conta roda —, e comprime resposta parcial (206) de `FileResponse`, com o
`Content-Range` contando bytes que o corpo comprimido já não tem.

A régua daqui é mais estreita, por construção:
- só `application/json` e `text/*` (menos `text/event-stream`);
- só resposta de UMA mensagem de corpo (`more_body` falso na primeira). Tudo
  que é stream — SSE, `StreamingResponse`, `FileResponse` em pedaços — passa
  intocado sem precisar estar em lista nenhuma;
- nunca por cima de `Content-Encoding` ou `Content-Range` já postos.

Mora por DENTRO dos `@app.middleware("http")` do `main.py`: o
`BaseHTTPMiddleware` re-emite o corpo em pedaços, e daqui de dentro ainda se vê
a `JSONResponse` numa mensagem só.
"""
from __future__ import annotations

import gzip

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

_TIPOS_TEXTO = ("application/json", "text/")
_TIPOS_FORA = ("text/event-stream",)


def _comprimivel(headers: Headers) -> bool:
    if "content-encoding" in headers or "content-range" in headers:
        return False
    tipo = headers.get("content-type", "").lower()
    return tipo.startswith(_TIPOS_TEXTO) and not tipo.startswith(_TIPOS_FORA)


class GZipCorpoInteiro:
    def __init__(self, app: ASGIApp, *, tamanho_minimo: int = 500, nivel: int = 6) -> None:
        self.app = app
        self.tamanho_minimo = tamanho_minimo
        # 6 e não 9: no /api/fleet (34 KB) a diferença de tamanho é de bytes, e a
        # conta roda no event loop a cada leitura da frota.
        self.nivel = nivel

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or "gzip" not in Headers(scope=scope).get(
            "accept-encoding", ""
        ):
            await self.app(scope, receive, send)
            return

        inicio: Message | None = None

        async def envia(message: Message) -> None:
            nonlocal inicio
            if message["type"] == "http.response.start":
                # Tipo que não se comprime (SSE, arquivo) segue NA HORA: o
                # `/api/stream` não manda corpo ao conectar, e segurar o
                # cabeçalho atrasava o `open` do EventSource até o primeiro ping.
                if not _comprimivel(Headers(raw=message["headers"])):
                    await send(message)
                    return
                # Candidato a gzip: segura o cabeçalho até o primeiro pedaço do
                # corpo, que é quem diz se a resposta vem inteira ou em stream.
                inicio = message
                return
            if inicio is None:
                await send(message)
                return
            cabecalho, inicio = inicio, None
            if (
                message["type"] == "http.response.body"
                and not message.get("more_body", False)
                and len(message.get("body", b"")) >= self.tamanho_minimo
            ):
                corpo = gzip.compress(message["body"], compresslevel=self.nivel)
                headers = MutableHeaders(raw=cabecalho["headers"])
                headers["Content-Encoding"] = "gzip"
                headers["Content-Length"] = str(len(corpo))
                headers.add_vary_header("Accept-Encoding")
                message = {**message, "body": corpo}
            await send(cabecalho)
            await send(message)

        await self.app(scope, receive, envia)
