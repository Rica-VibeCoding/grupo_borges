#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import unquote
import uuid

API_ROOT = Path(__file__).resolve().parents[1] / "apps" / "api"
sys.path.insert(0, str(API_ROOT))

from config import get_settings
from db.store import GrupoBorgesDB
from services.faxina import INDEX_NAMES, ZE_CLAUDE_ROOT, archive_path, safe_path


def git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "--literal-pathspecs", "-C", str(repo), *args],
        capture_output=True, text=True, encoding="utf-8", errors="surrogateescape", timeout=60,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or f"git {args[0]} terminou com código {result.returncode}")
    return result.stdout.strip()


def read_indexes(repo: Path) -> dict[str, str]:
    indexes = {}
    paths = git(repo, "ls-files", "--cached", "--others", "--exclude-standard", "-z")
    for relative in paths.split("\0"):
        if (not relative or Path(relative).name not in INDEX_NAMES
                or any(0xD800 <= ord(char) <= 0xDFFF for char in relative)):
            continue
        if "arquivo" in Path(relative).parts:
            continue
        resolved = (repo / relative).resolve()
        if resolved.is_relative_to(repo) and resolved.is_file():
            indexes[relative] = unquote(resolved.read_text(encoding="utf-8", errors="replace"))
    return indexes


def cited_indexes(repo: Path, caminho: str, indexes: dict[str, str] | None = None) -> list[str]:
    target = safe_path(repo, caminho)
    found = []
    for relative, text in (read_indexes(repo) if indexes is None else indexes).items():
        if relative == caminho or Path(relative).is_relative_to(Path(caminho)):
            continue
        index = repo / relative
        references = {caminho, str(target), os.path.relpath(target, index.parent)}
        if any(reference in text for reference in references):
            found.append(relative)
    if target.is_dir():
        for relative in git(repo, "ls-files", "-z").split("\0"):
            alias = repo / relative
            if relative and alias.is_symlink() and alias.resolve().is_relative_to(target):
                found.append(relative)
    return sorted(set(found))


def move_and_commit(repo: Path, item: dict, journal: Path) -> tuple[str, str]:
    original = item["caminho"]
    archived = archive_path(original)
    undo = item["status"] == "desfazer_pedido"
    if item["workspace"] != Path(original).parts[0]:
        raise ValueError("workspace diferente do caminho")
    if undo and item["arquivado_para"] != archived:
        raise ValueError("destino arquivado diferente do esperado")
    source, destination = (archived, original) if undo else (original, archived)
    source_path = safe_path(repo, source)
    destination_path = safe_path(repo, destination)

    if journal.exists():
        operation = json.loads(journal.read_text())
        if operation["id"] != item["id"] or operation["status"] != item["status"]:
            raise RuntimeError("operação anterior incompleta; conferir registro do executor")
        sha = git(repo, "log", "-1", "--format=%H", "--fixed-strings", "--grep", operation["marker"])
        if sha:
            return sha, archived
        raise RuntimeError("operação interrompida antes do commit; conferir caminhos manualmente")

    if not undo:
        cited = sorted(set(item["citado_em"]) | set(cited_indexes(repo, original)))
        if cited:
            raise ValueError("citado em " + ", ".join(cited))
    if item["tipo"] == "skill":
        if not source_path.is_dir() or not (source_path / "SKILL.md").is_file():
            raise ValueError("origem da skill não contém SKILL.md")
        for child in source_path.rglob("*"):
            if child.is_symlink() or (not child.is_dir() and not child.is_file()):
                raise ValueError("skill contém link simbólico ou arquivo especial")
        if git(repo, "ls-files", "--others", "--ignored", "--exclude-standard", "--", source):
            raise ValueError("skill contém arquivos ignorados; conferir antes de arquivar")
    elif not source_path.is_file():
        raise ValueError("origem não é arquivo regular")
    if destination_path.exists():
        raise ValueError("destino já existe")
    git(repo, "ls-files", "--error-unmatch", "--", source)
    if git(repo, "status", "--porcelain", "--untracked-files=all", "--", source, destination):
        raise ValueError("origem ou destino tem alterações locais")
    for marker in ("MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"):
        if Path(git(repo, "rev-parse", "--path-format=absolute", "--git-path", marker)).exists():
            raise ValueError("operação git em andamento")

    operation = {"id": item["id"], "status": item["status"],
                 "marker": f"Faxina-Operacao: {uuid.uuid4()}"}
    journal.write_text(json.dumps(operation), encoding="utf-8")
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    git(repo, "mv", "--", source, destination)
    verb = "restaura" if undo else "arquiva"
    message = (f"chore(faxina): {verb} {original}\n\n{operation['marker']}\n\n"
               "Co-Authored-By: Claude Code <noreply@anthropic.com>")
    try:
        git(repo, "commit", "-m", message, "--", source, destination)
    except (RuntimeError, subprocess.TimeoutExpired):
        # Um gancho pode falhar ou demorar depois de o commit já existir.
        sha = git(repo, "log", "-1", "--format=%H", "--fixed-strings", "--grep", operation["marker"])
        if sha:
            return sha, archived
        git(repo, "mv", "--", destination, source)
        raise
    sha = git(repo, "log", "-1", "--format=%H", "--fixed-strings", "--grep", operation["marker"])
    if not sha:
        raise RuntimeError("commit não localizado após mover arquivo")
    return sha, archived


def run_once(db_path: str, repo: Path) -> list[dict]:
    repo = repo.resolve()
    if Path(git(repo, "rev-parse", "--show-toplevel")).resolve() != repo:
        raise ValueError("a raiz deve ser o repositório ze_claude")
    git_dir = Path(git(repo, "rev-parse", "--absolute-git-dir"))
    journal = git_dir / "faxina-operation.json"
    db = GrupoBorgesDB(db_path)
    results = []
    with (git_dir / "faxina-executor.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return []
        items = asyncio.run(db.list_faxina("todos"))["itens"]
        if journal.exists():
            operation = json.loads(journal.read_text())
            persisted = next((item for item in items if item["id"] == operation["id"]), None)
            if persisted is None:
                raise RuntimeError("registro de operação pertence a item ausente do banco")
            if persisted["status"] != operation["status"]:
                journal.unlink()
            else:
                items.sort(key=lambda item: item["id"] != operation["id"])
        for item in items:
            expected = item["status"]
            if expected not in {"arquivar_pedido", "desfazer_pedido"}:
                continue
            try:
                sha, archived = move_and_commit(repo, item, journal)
            except (ValueError, OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
                result = asyncio.run(db.finish_faxina(item["id"], expected, erro=str(exc)))
            else:
                result = asyncio.run(db.finish_faxina(
                    item["id"], expected, commit_sha=sha, arquivado_para=archived,
                ))
            if result is None:
                raise RuntimeError("estado do item mudou durante a execução")
            results.append(result)
            if journal.exists():
                operation = json.loads(journal.read_text())
                if operation["id"] == item["id"]:
                    journal.unlink()
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="Executa decisões da Faxina, sem push.")
    parser.add_argument("--repo", type=Path, default=ZE_CLAUDE_ROOT)
    parser.add_argument("--db", default=get_settings().db_path)
    args = parser.parse_args()
    print(json.dumps(run_once(args.db, args.repo), ensure_ascii=False))


if __name__ == "__main__":
    main()
