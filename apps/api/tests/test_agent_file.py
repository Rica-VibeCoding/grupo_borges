"""Testes do endpoint `POST /api/agents/{slug}/file` (imagem, vídeo, documento)."""
from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI
from fastapi.testclient import TestClient

from db.store import GrupoBorgesDB
from routers import agents as agents_router
from services import tmux_driver

DANIEL = {
    "slug": "daniel",
    "name": "Daniel Singh",
    "role": "reviewer",
    "emoji": "DS",
    "tmux_session": "daniel",
    "workspace_path": "/tmp/daniel",
    "cli_default": "claude_code",
    "model_default": "opus",
    "capabilities": [],
    "can_review": [],
}


TARA = {
    "slug": "tara",
    "name": "Tara Kaur",
    "role": "codex",
    "emoji": "TK",
    "tmux_session": "tara",
    "workspace_path": "/tmp/tara",
    "cli_default": "codex",
    "model_default": "codex-gpt-5-6-sol",
    "capabilities": [],
    "can_review": [],
}


PNG_1X1 = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
    b"\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
    b"\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00"
    b"\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)
MP4_HEADER = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + b"\x00" * 32
PDF_BYTES = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n"
DOCX_BYTES = b"PK\x03\x04" + b"\x00" * 64
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _build_app(tmp_path: Path, *, codex_for_tara: bool = False) -> FastAPI:
    agents = [DANIEL, TARA]
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    db._sync_agents(agents)
    if codex_for_tara:
        db._update_agent_codex_state(
            "tara",
            executor_kind="codex",
            status_line="ocioso",
        )
    app = FastAPI()
    app.state.db = db
    app.state.agents_config = {"agents": agents}
    app.include_router(agents_router.router, prefix="/api/agents")
    return app


def _post_file(
    app: FastAPI,
    tmp_path: Path,
    *,
    slug: str = "daniel",
    filename: str,
    content: bytes,
    mime: str,
    caption: str | None = None,
    delivered: bool = True,
):
    with patch("routers.agents._AGENT_UPLOADS_BASE", tmp_path / "uploads"), \
         patch("routers.agents.tmux_driver.send_message", return_value=delivered) as send_message:
        with TestClient(app) as client:
            response = client.post(
                f"/api/agents/{slug}/file",
                data={"caption": caption} if caption else None,
                files={"file": (filename, content, mime)},
            )
    return response, send_message


def test_file_image_saves_and_keeps_legacy_text(tmp_path: Path) -> None:
    """Imagem: kind `image` e o mesmo texto que a `/image` já mandava."""
    app = _build_app(tmp_path)
    response, send_message = _post_file(
        app, tmp_path, filename="foto.png", content=PNG_1X1, mime="image/png"
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["kind"] == "image"
    assert body["filename"] == "foto.png"
    assert body["size"] == len(PNG_1X1)
    assert body["tmux_delivered"] is True
    assert Path(body["path"]).read_bytes() == PNG_1X1
    text = send_message.call_args.args[1]
    assert text == f"Imagem enviada via cockpit:\n{body['path']}"


def test_file_document_sends_path_and_original_name(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    response, send_message = _post_file(
        app,
        tmp_path,
        filename="contrato.pdf",
        content=PDF_BYTES,
        mime="application/pdf",
        caption="lê a cláusula 4",
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["kind"] == "document"
    assert body["path"].endswith(".pdf")
    text = send_message.call_args.args[1]
    assert text.startswith(f"Arquivo enviado via cockpit:\n{body['path']}")
    assert "contrato.pdf" in text
    assert text.endswith("Caption: lê a cláusula 4")


def test_file_video_warns_about_missing_native_vision(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    response, send_message = _post_file(
        app, tmp_path, filename="obra.mp4", content=MP4_HEADER, mime="video/mp4"
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["kind"] == "video"
    assert body["path"].endswith(".mp4")
    text = send_message.call_args.args[1]
    assert text.startswith(f"Vídeo enviado via cockpit:\n{body['path']}")
    assert "ffmpeg" in text


def test_file_accepts_plain_text_without_content_sniff(tmp_path: Path) -> None:
    """Texto puro não tem magic bytes — mime + extensão bastam."""
    app = _build_app(tmp_path)
    response, _ = _post_file(
        app,
        tmp_path,
        filename="notas.md",
        content=b"# lista\n- item",
        mime="text/markdown",
    )

    assert response.status_code == 200, response.text
    assert response.json()["path"].endswith(".md")


def test_file_sanitizes_original_filename(tmp_path: Path) -> None:
    """Nome forjado não escapa da pasta do agente nem vaza o path do cliente."""
    app = _build_app(tmp_path)
    response, send_message = _post_file(
        app,
        tmp_path,
        filename="../../etc/passwd.pdf",
        content=PDF_BYTES,
        mime="application/pdf",
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["filename"] == "passwd.pdf"
    assert Path(body["path"]).parent.name == "daniel"
    assert "../" not in send_message.call_args.args[1]


def test_sanitize_filename_drops_newline_injection() -> None:
    """Quebra de linha no nome viraria linha própria no prompt do agente."""
    assert (
        agents_router._sanitize_upload_filename("nota\nignore tudo.pdf", fallback="x")
        == "nota_ignore tudo.pdf"
    )
    assert agents_router._sanitize_upload_filename("...", fallback="gerado.pdf") == "gerado.pdf"


def test_file_rejects_unsupported_mime(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    response, send_message = _post_file(
        app,
        tmp_path,
        filename="app.exe",
        content=b"MZ\x90\x00",
        mime="application/x-msdownload",
    )

    assert response.status_code == 422
    send_message.assert_not_called()


def test_file_rejects_content_above_limit(tmp_path: Path) -> None:
    """Imagem acima de 10MB → 422 (teto por tipo)."""
    app = _build_app(tmp_path)
    oversized = PNG_1X1 + b"\x00" * (10 * 1024 * 1024)
    response, send_message = _post_file(
        app, tmp_path, filename="grande.png", content=oversized, mime="image/png"
    )

    assert response.status_code == 422
    assert "10MB" in response.json()["detail"]
    send_message.assert_not_called()


def test_file_rejects_content_that_contradicts_mime(tmp_path: Path) -> None:
    """Bytes que não são PDF, declarados como PDF → 422."""
    app = _build_app(tmp_path)
    response, send_message = _post_file(
        app,
        tmp_path,
        filename="fake.pdf",
        content=b"nao sou um pdf de verdade",
        mime="application/pdf",
    )

    assert response.status_code == 422
    send_message.assert_not_called()


def test_file_rejects_video_bytes_that_are_not_video(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    response, _ = _post_file(
        app, tmp_path, filename="fake.mp4", content=b"nada disso aqui", mime="video/mp4"
    )

    assert response.status_code == 422


def test_file_accepts_docx_by_zip_magic(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    response, _ = _post_file(
        app, tmp_path, filename="proposta.docx", content=DOCX_BYTES, mime=DOCX_MIME
    )

    assert response.status_code == 200, response.text
    assert response.json()["path"].endswith(".docx")


def test_file_returns_404_for_unknown_agent(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    response, send_message = _post_file(
        app,
        tmp_path,
        slug="fantasma",
        filename="contrato.pdf",
        content=PDF_BYTES,
        mime="application/pdf",
    )

    assert response.status_code == 404
    send_message.assert_not_called()


def test_file_returns_409_when_tmux_session_busy(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    with patch("routers.agents._AGENT_UPLOADS_BASE", tmp_path / "uploads"), \
         patch(
             "routers.agents.tmux_driver.send_message",
             side_effect=tmux_driver.TmuxSessionBusyError("ocupado"),
         ):
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/daniel/file",
                files={"file": ("contrato.pdf", PDF_BYTES, "application/pdf")},
            )

    assert response.status_code == 409
    assert response.json()["detail"] == "agent_tmux_busy"


def test_file_document_for_codex_puts_path_in_prompt(tmp_path: Path) -> None:
    """Documento para Tara Codex vai pelo wrapper, sem `-i` (que só aceita imagem)."""
    app = _build_app(tmp_path, codex_for_tara=True)
    thread = SimpleNamespace(thread_id="thread-file")
    with patch("routers.agents._AGENT_UPLOADS_BASE", tmp_path / "uploads"), \
         patch("routers.agents.codex_reader.find_latest_thread", return_value=thread), \
         patch("routers.agents.subprocess.Popen") as popen, \
         patch("routers.agents.tmux_driver.send_message") as send_message:
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/tara/file",
                data={"caption": "resume isso"},
                files={"file": ("contrato.pdf", PDF_BYTES, "application/pdf")},
            )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["kind"] == "document"
    assert body["tmux_delivered"] is True
    send_message.assert_not_called()
    popen.assert_called_once()
    cmd = popen.call_args.args[0]
    assert "-i" not in cmd
    assert body["path"] in cmd[-1]
    assert cmd[-1].endswith("Caption: resume isso")


def test_file_image_for_codex_still_uses_image_flag(tmp_path: Path) -> None:
    """Imagem pela rota nova mantém o `-i <path>` antes do separador `--`."""
    app = _build_app(tmp_path, codex_for_tara=True)
    thread = SimpleNamespace(thread_id="thread-file-image")
    with patch("routers.agents._AGENT_UPLOADS_BASE", tmp_path / "uploads"), \
         patch("routers.agents.codex_reader.find_latest_thread", return_value=thread), \
         patch("routers.agents.subprocess.Popen") as popen:
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/tara/file",
                data={"caption": "descreva"},
                files={"file": ("image.png", PNG_1X1, "image/png")},
            )

    assert response.status_code == 200, response.text
    body = response.json()
    cmd = popen.call_args.args[0]
    image_index = cmd.index("-i")
    assert image_index < cmd.index("--")
    assert cmd[image_index + 1] == body["path"]
    assert cmd[-1] == "descreva"


# ---- EXIF Orientation ----------------------------------------------------
#
# O leitor de imagem do agente redimensiona o que passa de 2000px no lado maior,
# e a orientação se perde nesse caminho — medido em 04/08 com par de controle:
# 1900px chega orientado, 2100px chega cru, mesma imagem e mesma tag. Foto de
# celular tem 3000px e mais, então cai sempre do lado errado. Por isso a rota
# aplica a tag nos PIXELS na gravação; corrigir no preview não serviria, o
# agente lê o arquivo do disco e não a tela.


def _jpeg(largura: int, altura: int, orientation: int | None) -> bytes:
    from io import BytesIO

    from PIL import Image

    imagem = Image.new("RGB", (largura, altura), "white")
    buffer = BytesIO()
    if orientation is None:
        imagem.save(buffer, "JPEG", quality=90)
    else:
        exif = imagem.getexif()
        exif[274] = orientation
        imagem.save(buffer, "JPEG", quality=90, exif=exif)
    return buffer.getvalue()


def _medidas(caminho: str) -> tuple[tuple[int, int], int | None]:
    from PIL import Image

    with Image.open(caminho) as imagem:
        return imagem.size, imagem.getexif().get(274)


def test_file_image_aplica_orientacao_nos_pixels_e_remove_a_tag(tmp_path: Path) -> None:
    """Orientation 5 é TRANSPOSE: paisagem entra, retrato sai, sem tag sobrando.

    A tag TEM que sumir: se ficar, o próximo leitor que a respeite gira de novo
    e a foto volta a ficar torta — pelo outro lado.
    """
    app = _build_app(tmp_path)
    response, _ = _post_file(
        app,
        tmp_path,
        filename="iphone.jpg",
        content=_jpeg(400, 200, orientation=5),
        mime="image/jpeg",
    )

    assert response.status_code == 200, response.text
    tamanho, orientacao = _medidas(response.json()["path"])
    assert tamanho == (200, 400)
    assert orientacao is None


def test_file_image_sem_tag_nao_e_reencodada(tmp_path: Path) -> None:
    """Sem Orientation (ou com 1) os bytes saem intactos — nem decodifica.

    É o caminho da esmagadora maioria: screenshot não carrega a tag. Reencodar
    todo mundo custaria RAM e uma geração de qualidade por nada.
    """
    app = _build_app(tmp_path)
    original = _jpeg(400, 200, orientation=None)
    response, _ = _post_file(
        app, tmp_path, filename="print.jpg", content=original, mime="image/jpeg"
    )

    assert response.status_code == 200, response.text
    assert Path(response.json()["path"]).read_bytes() == original

    neutra = _jpeg(400, 200, orientation=1)
    response, _ = _post_file(
        app, tmp_path, filename="neutra.jpg", content=neutra, mime="image/jpeg"
    )
    assert Path(response.json()["path"]).read_bytes() == neutra


def test_file_image_ilegivel_grava_o_original_em_vez_de_falhar(tmp_path: Path) -> None:
    """Anexo torto que chega vale mais que anexo que não chega.

    Bytes com magic de PNG mas corpo quebrado passam o sniff e morrem no Pillow.
    O upload segue, gravando o original.
    """
    app = _build_app(tmp_path)
    quebrado = b"\x89PNG\r\n\x1a\n" + b"lixo que nao e um PNG de verdade"
    response, send_message = _post_file(
        app, tmp_path, filename="quebrado.png", content=quebrado, mime="image/png"
    )

    assert response.status_code == 200, response.text
    assert Path(response.json()["path"]).read_bytes() == quebrado
    assert send_message.called


# ---- HEIC do iPhone ------------------------------------------------------
#
# O WebKit converte HEIC→JPEG no upload só quando o `accept` traz um MIME
# concreto que o CoreGraphics saiba encodar — e as notas do Safari 27 beta
# registram a remoção dessa conversão como correção. Ou seja: HEIC CHEGA, e
# depender do navegador para não receber é apostar no que a Apple fizer depois.
# Some a isso o caminho "Arquivos"/iCloud, que nunca passou pela conversão.
#
# Aceitar e converter na gravação é o único desenho que não deixa o Rica sem
# conseguir anexar foto. O resto do sistema nunca fica sabendo que HEIC existiu.


def _heic(largura: int, altura: int) -> bytes:
    from io import BytesIO

    from PIL import Image

    import pillow_heif

    pillow_heif.register_heif_opener()
    buffer = BytesIO()
    Image.new("RGB", (largura, altura), "white").save(buffer, "HEIF", quality=90)
    return buffer.getvalue()


def _formato(caminho: str) -> str | None:
    from PIL import Image

    with Image.open(caminho) as imagem:
        return imagem.format


def test_file_heic_do_iphone_e_gravado_como_jpeg(tmp_path: Path) -> None:
    """Foto HEIC da biblioteca do iPhone: entra `.heic`, é gravada `.jpg`.

    A extensão importa tanto quanto os bytes — o agente recebe um PATH, e quem
    abre o arquivo do outro lado decide pelo que está escrito nele.
    """
    app = _build_app(tmp_path)
    response, send_message = _post_file(
        app, tmp_path, filename="IMG_4312.HEIC", content=_heic(400, 200), mime="image/heic"
    )

    assert response.status_code == 200, response.text
    caminho = response.json()["path"]
    assert caminho.endswith(".jpg"), "gravou HEIC cru: o leitor do agente não abre"
    assert _formato(caminho) == "JPEG"
    assert send_message.called


def test_file_heic_com_mime_e_extensao_mentindo_jpeg(tmp_path: Path) -> None:
    """O modo de falha clássico: HEIC de verdade batizado de `.jpg`.

    Acontece de montão no caminho iCloud/Arquivos, e é a razão de a validação
    ser por MAGIC BYTES: acreditar no `content_type` aqui é recusar uma foto
    legítima com "conteúdo não corresponde ao mime", que não diz nada a ninguém.
    """
    app = _build_app(tmp_path)
    response, _ = _post_file(
        app, tmp_path, filename="IMG_0421.jpg", content=_heic(400, 200), mime="image/jpeg"
    )

    assert response.status_code == 200, response.text
    assert _formato(response.json()["path"]) == "JPEG"


def test_file_mp4_declarado_como_heic_continua_recusado(tmp_path: Path) -> None:
    """Guarda de regressão: `ftyp` sozinho NÃO é assinatura de imagem.

    HEIC e MP4 dividem o mesmo box ISO-BMFF no offset 4 — o que separa os dois é
    a BRAND no offset 8. Sniffar só o `ftyp` faria todo vídeo entrar pela porta
    da imagem, ser mandado ao Pillow e gravado com extensão errada.
    """
    app = _build_app(tmp_path)
    response, send_message = _post_file(
        app, tmp_path, filename="clipe.heic", content=MP4_HEADER, mime="image/heic"
    )

    assert response.status_code == 422
    send_message.assert_not_called()


# ---- GET do upload -------------------------------------------------------
#
# Até aqui o upload era via de mão única: o arquivo ia pro disco e a única marca
# dele na tela era o caminho absoluto em texto cru. Sem uma rota que devolva os
# bytes, o feed não tem de onde puxar a imagem.


def _get_file(app: FastAPI, tmp_path: Path, caminho: str, *, slug: str = "daniel"):
    with patch("routers.agents._AGENT_UPLOADS_BASE", tmp_path / "uploads"):
        with TestClient(app) as client:
            return client.get(f"/api/agents/{slug}/file/{caminho}")


def test_get_file_serve_a_imagem_com_o_content_type_certo(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    enviada, _ = _post_file(
        app, tmp_path, filename="foto.png", content=PNG_1X1, mime="image/png"
    )
    nome = Path(enviada.json()["path"]).name

    response = _get_file(app, tmp_path, nome)

    assert response.status_code == 200, response.text
    assert response.content == PNG_1X1
    assert response.headers["content-type"] == "image/png"
    # `inline`: o destino é um `<img>` no feed, não a pasta de downloads.
    assert "inline" in response.headers["content-disposition"]
    assert response.headers["x-content-type-options"] == "nosniff"


def test_get_file_nao_escapa_do_diretorio_do_agente(tmp_path: Path) -> None:
    """A tentativa é feita de verdade, com um alvo que EXISTE fora da base.

    Um teste que só pede `../../etc/passwd` prova pouco: 404 sairia igual se o
    arquivo não existisse. Aqui o segredo está no disco, um nível acima, e a
    única razão possível para não vir na resposta é a guarda ter funcionado.
    """
    app = _build_app(tmp_path)
    base = tmp_path / "uploads"
    (base / "daniel").mkdir(parents=True, exist_ok=True)
    segredo = base / "segredo.png"
    segredo.write_bytes(b"\x89PNG\r\n\x1a\nnao pode vazar")

    for tentativa in ("../segredo.png", "..%2Fsegredo.png", "%2e%2e%2fsegredo.png"):
        response = _get_file(app, tmp_path, tentativa)
        assert response.status_code in (400, 404), f"{tentativa} devolveu {response.status_code}"
        assert b"nao pode vazar" not in response.content, f"{tentativa} VAZOU o arquivo"


def test_get_file_nao_segue_symlink_para_fora(tmp_path: Path) -> None:
    """`resolve()` antes de comparar é o que mata este caso.

    Comparar o caminho ANTES de resolver deixaria passar: `daniel/atalho.png` é
    literalmente um nome dentro da base — só que aponta para fora dela.
    """
    app = _build_app(tmp_path)
    base = tmp_path / "uploads"
    (base / "daniel").mkdir(parents=True, exist_ok=True)
    fora = tmp_path / "fora.png"
    fora.write_bytes(b"\x89PNG\r\n\x1a\nfora da base")
    (base / "daniel" / "atalho.png").symlink_to(fora)

    response = _get_file(app, tmp_path, "atalho.png")

    assert response.status_code == 400
    assert b"fora da base" not in response.content


def test_get_file_recusa_extensao_que_o_upload_nao_grava(tmp_path: Path) -> None:
    """Só se serve o que a `POST /file` sabe gravar.

    Sem isto, qualquer arquivo que aparecesse na pasta por outro caminho — log,
    `.env`, backup — seria servido com um content-type adivinhado.
    """
    app = _build_app(tmp_path)
    pasta = tmp_path / "uploads" / "daniel"
    pasta.mkdir(parents=True, exist_ok=True)
    (pasta / "segredos.env").write_bytes(b"TOKEN=nao-pode-sair")

    response = _get_file(app, tmp_path, "segredos.env")

    assert response.status_code == 404
    assert b"nao-pode-sair" not in response.content


def test_get_file_404_para_arquivo_e_agente_inexistentes(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    (tmp_path / "uploads" / "daniel").mkdir(parents=True, exist_ok=True)

    assert _get_file(app, tmp_path, "nunca-existiu.png").status_code == 404
    assert _get_file(app, tmp_path, "x.png", slug="fantasma").status_code == 404
