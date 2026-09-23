from __future__ import annotations

import os
from pathlib import Path, PurePosixPath

ZE_CLAUDE_ROOT = Path("/home/clawd/repos/ze_claude")
CONTENT_LIMIT = 200 * 1024
INDEX_NAMES = {"CLAUDE.md", "README.md", "SKILL.md", "MEMORY.md"}


def validate_relative_path(caminho: str) -> PurePosixPath:
    relative = PurePosixPath(caminho)
    if (
        not caminho or "\x00" in caminho or "\\" in caminho
        or relative.is_absolute() or len(relative.parts) < 2
        or any(part in {"..", ".git"} for part in relative.parts)
        or relative.as_posix() != caminho
    ):
        raise ValueError("caminho relativo inválido")
    return relative


def safe_path(root: Path, caminho: str) -> Path:
    relative = validate_relative_path(caminho)
    root = root.resolve()
    current = root
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("link simbólico não permitido")
    if not current.resolve().is_relative_to(root):
        raise ValueError("caminho fora de ze_claude")
    return current


def archive_path(caminho: str) -> str:
    relative = validate_relative_path(caminho)
    if relative.parts[1] == "arquivo":
        raise ValueError("caminho já está em arquivo")
    return str(PurePosixPath(relative.parts[0], "arquivo", *relative.parts[1:]))


def read_content(root: Path, caminho: str) -> str:
    path = safe_path(root, caminho)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as source:
        import stat

        if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
            raise ValueError("caminho não é arquivo regular")
        content = source.read(CONTENT_LIMIT + 1)
    if len(content) > CONTENT_LIMIT:
        raise OverflowError("conteúdo excede 200 KB")
    return content.decode("utf-8", errors="replace")
