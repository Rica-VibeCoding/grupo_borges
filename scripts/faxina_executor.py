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
        capture_output=True, text=True, timeout=60,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or f"git {args[0]} terminou com código {result.returncode}")
    return result.stdout.strip()


def cited_indexes(repo: Path, caminho: str) -> list[str]:
    target = safe_path(repo, caminho)
    found = []
    paths = git(repo, "ls-files", "--cached", "--others", "--exclude-standard", "-z")
    for relative in paths.split("\0"):
        if not relative or Path(relative).name not in INDEX_NAMES or relative == caminho:
            continue
        if "arquivo" in Path(relative).parts:
            continue
        index = repo / relative
        resolved = index.resolve()
        if not resolved.is_relative_to(repo) or not resolved.is_file():
            continue
        text = unquote(resolved.read_text(encoding="utf-8", errors="replace"))
        references = {caminho, str(target), os.path.relpath(target, index.parent)}
        if any(reference in text for reference in references):
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
    if not source_path.is_file():
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
