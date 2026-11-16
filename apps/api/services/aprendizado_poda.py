"""Poda restaurável de memória; journal privado e índice substituído atomicamente."""
from __future__ import annotations

import contextlib
import difflib
import fcntl
import hashlib
import json
import os
import re
import stat
import tempfile
import time
import uuid
from pathlib import Path
from urllib.parse import unquote, urlsplit

from services.aprendizado import Aprendizado, Asset, permitted
from services.faxina import CONTENT_LIMIT, read_content, safe_path


class Conflict(ValueError):
    pass


def atomic(path: Path, text: str, mode: int) -> None:
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=".aprendizado-")
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(text.encode())
            output.flush()
            os.fchmod(output.fileno(), stat.S_IMODE(mode))
            os.fsync(output.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def sync_directory(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


@contextlib.contextmanager
def locked(reader: Aprendizado, slug: str):
    # Compartilha a trava do Sonho; não concorre com sua aplicação local.
    with contextlib.ExitStack() as stack:
        for folder in ("aprendizado", f"dream-{slug}"):
            directory = safe_path(reader.dream_root, f"{folder}/lock").parent
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            fd = os.open(directory / "lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            handle = stack.enter_context(os.fdopen(fd, "a"))
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                raise Conflict("outra operação de memória em andamento") from exc
        yield


def journal_path(reader: Aprendizado, operation_id: str) -> Path:
    if not re.fullmatch(r"memoria-[a-f0-9]{32}", operation_id):
        raise ValueError("operação inválida")
    return safe_path(reader.dream_root, f"aprendizado/{operation_id}.json")


def save(reader: Aprendizado, record: dict) -> None:
    text = json.dumps(record, ensure_ascii=False)
    if len(text.encode()) > CONTENT_LIMIT:
        raise OverflowError("registro de restauração excede 200 KB")
    atomic(journal_path(reader, record["operacao_id"]), text, 0o600)


def summary(record: dict) -> dict:
    return {k: record[k] for k in ("operacao_id", "tipo", "status", "agente", "caminho",
                                  "arquivado_para", "criado_em")}


LINK = re.compile(r"(?<!!)\[[^\]\r\n]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+\"[^\"\r\n]*\")?\s*\)")
WIKI = re.compile(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]")


def points_to(value: str, index: Path, target: Path) -> bool:
    url = urlsplit(value)
    if url.scheme or url.netloc:
        return False
    path = unquote(url.path)
    return Path(os.path.abspath(index.parent / path)) == target


def prune_index(text: str, index: Path, target: Path) -> str:
    output = []
    for line in text.splitlines(keepends=True):
        links = [(m, points_to(m[1] or m[2], index, target)) for m in LINK.finditer(line)]
        for match in WIKI.finditer(line):
            name = match[1]
            if not name.endswith(".md"):
                name += ".md"
            links.append((match, points_to(name, index, target)))
        if not any(hit for _, hit in links):
            # Formato que não entendemos: recusar evita deixar ponteiro quebrado.
            if target.name in unquote(line):
                raise Conflict("referência no MEMORY.md exige conferência manual")
            output.append(line)
            continue
        if all(hit for _, hit in links):
            continue
        for match, hit in sorted(links, key=lambda pair: pair[0].start(), reverse=True):
            if hit:
                start, end = match.span()
                right = re.match(r"[ \t]*·[ \t]*", line[end:])
                left = re.search(r"[ \t]*·[ \t]*$", line[:start])
                if right:
                    end += right.end()
                elif left:
                    start = left.start()
                line = line[:start] + line[end:]
        output.append(line)
    return "".join(output)


def restore_index(before: str, after: str, current: str) -> str:
    if current == before:
        return current
    if current == after:
        return before
    old, new, live = before.splitlines(keepends=True), after.splitlines(keepends=True), current.splitlines(keepends=True)
    # Inverte só os trechos alterados. Edições externas fora deles são preservadas.
    patches = difflib.SequenceMatcher(a=old, b=new, autojunk=False).get_opcodes()
    for tag, i, j, a, b in reversed(patches):
        if tag == "equal":
            continue
        needle = new[a:b]
        if needle:
            matches = [p for p in range(len(live) - len(needle) + 1) if live[p:p + len(needle)] == needle]
        else:
            matches = [p for p in range(len(live) + 1)
                       if (a == 0 or live[max(0, p - 1):p] == new[a - 1:a])
                       and (b == len(new) or live[p:p + 1] == new[b:b + 1])]
            if not new:
                matches = [0]
        if len(matches) != 1:
            raise Conflict("MEMORY.md mudou no trecho removido; desfazer exige conferência")
        start = matches[0]
        live[start:start + len(needle)] = old[i:j]
    return "".join(live)


def move(source: Path, destination: Path) -> None:
    # link + unlink não sobrescreve destino concorrente e preserva inode/modo/mtime.
    os.link(source, destination, follow_symlinks=False)
    source.unlink()
    sync_directory(source.parent)
    sync_directory(destination.parent)


def archive_memory(reader: Aprendizado, asset: Asset, node_id: str) -> dict:
    if asset.tipo != "memoria" or not permitted(asset.relative):
        raise ValueError("somente memória individual pode ser apagada")
    with locked(reader, asset.agente):
        source = asset.path
        raw = read_content(asset.root, asset.relative)
        index_relative = f"memory-{asset.agente}/MEMORY.md"
        index = safe_path(reader.memory_root, index_relative)
        before = read_content(reader.memory_root, index_relative)
        if "\ufffd" in before:
            raise Conflict("MEMORY.md contém texto inválido; conferir antes de reescrever")
        after = prune_index(before, index, source)
        archived_relative = f"memory-{asset.agente}/arquivo/{source.name}"
        destination = safe_path(reader.memory_root, archived_relative)
        if destination.exists():
            raise Conflict("destino arquivado já existe")
        destination.parent.mkdir(mode=0o700, exist_ok=True)
        mode = index.stat().st_mode
        record = dict(operacao_id=f"memoria-{uuid.uuid4().hex}", tipo="memoria", status="preparado",
                      agente=asset.agente, caminho=str(source), arquivado_para=str(destination),
                      relative=asset.relative, node_id=node_id, criado_em=int(time.time()),
                      before=before, after=after, digest=hashlib.sha256(raw.encode()).hexdigest())
        save(reader, record)
        try:
            if read_content(asset.root, asset.relative) != raw or read_content(reader.memory_root, index_relative) != before:
                raise Conflict("memória ou índice mudou durante a poda")
            atomic(index, after, mode)
            move(source, destination)
            record["status"] = "arquivado"
            save(reader, record)
        except BaseException:
            # Reverte só o que escrevemos, sem apagar edição alheia.
            if not source.exists() and destination.exists():
                if read_content(reader.memory_root, archived_relative) == raw:
                    move(destination, source)
            if read_content(reader.memory_root, index_relative) == after:
                atomic(index, before, mode)
            raise
        reader.invalidate()
        return summary(record)


def undo_memory(reader: Aprendizado, operation_id: str) -> dict:
    record = json.loads(read_content(reader.dream_root,
                                    str(journal_path(reader, operation_id).relative_to(reader.dream_root))))
    slug = record["agente"]
    relative = record["relative"]
    if (not re.fullmatch(r"[a-z0-9_-]+", slug) or not permitted(relative)
            or Path(relative).parts != (f"memory-{slug}", Path(relative).name)
            or not relative.endswith(".md") or Path(relative).name == "MEMORY.md"):
        raise ValueError("registro de restauração inválido")
    with locked(reader, slug):
        # Releitura depois da trava torna dois desfazeres concorrentes idempotentes.
        record = json.loads(read_content(reader.dream_root, f"aprendizado/{operation_id}.json"))
        if record["status"] == "restaurado":
            return summary(record)
        if record["status"] != "arquivado":
            raise Conflict("operação interrompida; conferir journal antes de desfazer")
        source = safe_path(reader.memory_root, relative)
        archived_relative = f"memory-{slug}/arquivo/{source.name}"
        archived = safe_path(reader.memory_root, archived_relative)
        if source.exists():
            raise Conflict("origem já existe; não será sobrescrita")
        raw = read_content(reader.memory_root, archived_relative)
        if hashlib.sha256(raw.encode()).hexdigest() != record["digest"]:
            raise Conflict("memória arquivada mudou; não será sobrescrita")
        index_relative = f"memory-{slug}/MEMORY.md"
        index = safe_path(reader.memory_root, index_relative)
        current = read_content(reader.memory_root, index_relative)
        restored = restore_index(record["before"], record["after"], current)
        mode = index.stat().st_mode
        move(archived, source)
        try:
            if read_content(reader.memory_root, index_relative) != current:
                raise Conflict("índice mudou durante restauração")
            atomic(index, restored, mode)
            record["status"] = "restaurado"
            save(reader, record)
        except BaseException:
            if read_content(reader.memory_root, index_relative) == restored:
                atomic(index, current, mode)
            move(source, archived)
            raise
        reader.invalidate()
        return summary(record)
