"""
Leitura do workspace de um agente — skills (.claude/skills/*/SKILL.md),
docs (CLAUDE.md/SOUL.md/IDENTITY.md/AGENTS.md/TOOLS.md/OPS.md) e resolver
recursivo de `@include` (forma usada pelo Claude Code pra montar a persona).

Tudo síncrono pra simplicidade. Chamadores async usam `asyncio.to_thread`.
TTL cache pequeno in-process — filesystem muda raro mas muda; restart limpa.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

DOC_FILENAMES = ("CLAUDE.md", "SOUL.md", "IDENTITY.md", "AGENTS.md", "TOOLS.md", "OPS.md")
SKILLS_SUBDIR = ".claude/skills"
INCLUDE_RE = re.compile(r"^@(\S+)\s*$")
INCLUDE_MAX_DEPTH = 5
INCLUDE_MAX_BYTES = 256 * 1024
MONOREPO_ROOT = Path("/home/clawd/repos/ze_claude")
# `@include` só resolve dentro deste root — defesa contra path traversal num doc
# adversário (ex: `@/etc/passwd`, `@../../../home/clawd/.ssh/id_rsa`).
ALLOWED_INCLUDE_ROOT = MONOREPO_ROOT.resolve()


def _within_allowed_root(resolved: Path) -> bool:
    try:
        return resolved.is_relative_to(ALLOWED_INCLUDE_ROOT)
    except (AttributeError, ValueError):
        return False


# ----- skills ---------------------------------------------------------------

def read_skills(workspace_path: str) -> list[dict[str, Any]]:
    """Lista skills do workspace. Cada item: name, description, path, is_symlink,
    shared_from (str|None), size_bytes, updated_at."""
    skills_dir = Path(workspace_path) / SKILLS_SUBDIR
    if not skills_dir.exists():
        return []

    out: list[dict[str, Any]] = []
    for entry in sorted(skills_dir.iterdir(), key=lambda p: p.name):
        if entry.name.startswith("_") or entry.name.startswith("."):
            continue
        if not (entry.is_dir() or entry.is_symlink()):
            continue
        skill_md = entry / "SKILL.md"
        if not skill_md.exists():
            continue

        meta = _parse_frontmatter(skill_md)
        stat = skill_md.stat()
        is_symlink = entry.is_symlink()
        shared_from: str | None = None
        if is_symlink:
            try:
                real = entry.resolve()
                shared_from = str(real.relative_to(MONOREPO_ROOT))
            except (OSError, ValueError):
                shared_from = str(entry.readlink())

        out.append({
            "name": meta.get("name") or entry.name,
            "description": meta.get("description") or "",
            "path": str(skill_md.relative_to(workspace_path)),
            "is_symlink": is_symlink,
            "shared_from": shared_from,
            "size_bytes": stat.st_size,
            "updated_at": int(stat.st_mtime),
        })
    return out


def _parse_frontmatter(path: Path) -> dict[str, Any]:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return {}
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 4)
    if end < 0:
        return {}
    raw = text[4:end]
    try:
        data = yaml.safe_load(raw)
    except yaml.YAMLError:
        return {}
    return data if isinstance(data, dict) else {}


# ----- docs + @include resolver ---------------------------------------------

@dataclass
class _ResolveState:
    visited: set[Path] = field(default_factory=set)
    bytes_used: int = 0


def read_docs(workspace_path: str) -> list[dict[str, Any]]:
    """Lista metadados dos docs do agente (sem resolver @include — peso menor)."""
    root = Path(workspace_path)
    out: list[dict[str, Any]] = []
    for name in DOC_FILENAMES:
        p = root / name
        if not p.exists() or not p.is_file():
            continue
        stat = p.stat()
        title = _extract_title(p)
        out.append({
            "filename": name,
            "title": title,
            "size_bytes": stat.st_size,
            "updated_at": int(stat.st_mtime),
        })
    return out


def read_doc_resolved(workspace_path: str, filename: str) -> dict[str, Any] | None:
    """Lê um doc específico do workspace com `@include` recursivamente resolvido.
    Retorna `{filename, content_md, truncated}` ou `None` se não existir.
    """
    if filename not in DOC_FILENAMES:
        return None
    root = Path(workspace_path)
    target = root / filename
    if not target.exists() or not target.is_file():
        return None

    state = _ResolveState()
    content = _resolve_file(target, depth=0, state=state)
    truncated = state.bytes_used >= INCLUDE_MAX_BYTES
    return {
        "filename": filename,
        "content_md": content,
        "truncated": truncated,
    }


def _resolve_file(path: Path, *, depth: int, state: _ResolveState) -> str:
    if depth > INCLUDE_MAX_DEPTH:
        return f"<!-- @include skipped: max depth ({INCLUDE_MAX_DEPTH}) -->"
    try:
        resolved = path.resolve()
    except OSError:
        return f"<!-- @include skipped: resolve failed: {path} -->"
    if not _within_allowed_root(resolved):
        return f"<!-- @include skipped: outside allowed root: {path} -->"
    if resolved in state.visited:
        return f"<!-- @include skipped: cycle -> {resolved.name} -->"
    state.visited.add(resolved)

    try:
        text = resolved.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        return f"<!-- @include read error: {e} -->"

    out_lines: list[str] = []
    base_dir = resolved.parent
    for line in text.splitlines(keepends=True):
        m = INCLUDE_RE.match(line.rstrip("\n"))
        if not m:
            out_lines.append(line)
            state.bytes_used += len(line)
            if state.bytes_used >= INCLUDE_MAX_BYTES:
                out_lines.append("\n<!-- [...truncated, response cap 256KB reached] -->\n")
                break
            continue
        target_path = (base_dir / m.group(1)).resolve()
        header = f"<!-- @include: {m.group(1)} -->\n"
        footer = f"<!-- /@include: {m.group(1)} -->\n"
        out_lines.append(header)
        out_lines.append(_resolve_file(target_path, depth=depth + 1, state=state))
        out_lines.append(footer)
        if state.bytes_used >= INCLUDE_MAX_BYTES:
            break
    state.visited.discard(resolved)
    return "".join(out_lines)


def _extract_title(path: Path) -> str | None:
    try:
        with path.open("r", encoding="utf-8", errors="replace") as f:
            for raw in f:
                line = raw.strip()
                if line.startswith("# "):
                    return line[2:].strip()
                if line and not line.startswith("---") and not line.startswith("#"):
                    return None
    except OSError:
        pass
    return None


# ----- TTL cache ------------------------------------------------------------

_TTL_S = 15.0
_cache: dict[tuple[str, str], tuple[float, Any]] = {}


def _cached(kind: str, workspace_path: str, loader: Any) -> Any:
    key = (kind, workspace_path)
    hit = _cache.get(key)
    if hit is not None:
        expires_at, value = hit
        if expires_at >= time.monotonic():
            return value
        _cache.pop(key, None)
    value = loader(workspace_path)
    _cache[key] = (time.monotonic() + _TTL_S, value)
    return value


def read_skills_cached(workspace_path: str) -> list[dict[str, Any]]:
    return _cached("skills", workspace_path, read_skills)


def read_docs_cached(workspace_path: str) -> list[dict[str, Any]]:
    return _cached("docs", workspace_path, read_docs)
