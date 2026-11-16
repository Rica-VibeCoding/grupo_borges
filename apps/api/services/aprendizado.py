"""Inventário local de aprendizado. Nenhum caminho recebido do cliente é aberto."""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import threading
import time
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path

import yaml

from services.faxina import SECRET, read_content, safe_lines, safe_path


@dataclass(frozen=True)
class Asset:
    root: Path
    relative: str
    agente: str
    tipo: str

    @property
    def path(self) -> Path:
        return safe_path(self.root, self.relative)

    @property
    def key(self) -> str:
        return f"{self.tipo}:{self.root / self.relative}"


def permitted(relative: str) -> bool:
    parts = Path(relative).parts
    return not SECRET.search(relative) and not any(
        p.casefold() in {"cofre", "vault", "arquivo", ".git"}
        or p.casefold().startswith(".env") or ".antiga-" in p for p in parts
    )


def epoch(value) -> int | None:
    try:
        if isinstance(value, bool):
            return None
        if isinstance(value, (int, float)):
            return int(value) if 0 < value < 253402300800 else None
        if isinstance(value, date) and not isinstance(value, datetime):
            value = datetime.combine(value, datetime.min.time())
        if not isinstance(value, datetime):
            value = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return int(value.replace(tzinfo=value.tzinfo or UTC).timestamp())
    except (ValueError, TypeError, OverflowError):
        return None


def metadata(text: str) -> dict:
    match = re.match(r"\A---\r?\n(.*?)\r?\n---(?:\r?\n|\Z)", text, re.S)
    if not match:
        return {}
    try:
        result = yaml.safe_load(match[1])
        return result if isinstance(result, dict) else {}
    except yaml.YAMLError:
        return {}


def git_dates(repo: Path, assets: list[Asset]) -> dict[str, tuple[int, int]]:
    """Uma leitura Git para toda a frota; inclui arquivos auxiliares das skills."""
    result = subprocess.run(
        ["git", "-C", str(repo), "log", "--format=@@%ct", "--name-only", "--no-renames",
         "--", ":(glob)*/.claude/skills/*/**", "ze-shared/memory/shared_*.md"],
        capture_output=True, text=True, timeout=30,
    )
    if result.returncode:
        raise RuntimeError("não foi possível consultar histórico Git do aprendizado")
    files = {a.relative: a.key for a in assets if a.tipo != "skill"}
    folders = {str(Path(a.relative).parent): a.key for a in assets if a.tipo == "skill"}
    dates: dict[str, tuple[int, int]] = {}
    timestamp = 0
    for line in result.stdout.splitlines():
        if line.startswith("@@"):
            timestamp = int(line[2:])
            continue
        key = files.get(line)
        if not key and len(Path(line).parts) >= 5:
            key = folders.get(str(Path(*Path(line).parts[:4])))
        if key and timestamp:
            latest, _ = dates.get(key, (timestamp, timestamp))
            dates[key] = latest, timestamp
    return dates


class Aprendizado:
    def __init__(self, memory_root: Path, repo: Path, dream_root: Path, agents: list[dict],
                 cache_seconds: float = 15):
        self.memory_root = memory_root
        self.repo = repo
        self.dream_root = dream_root
        self.owners = {str(Path(a["workspace_path"]).resolve()): a["slug"]
                       for a in agents if a.get("workspace_path")}
        self.cache_seconds = cache_seconds
        self._lock = threading.RLock()
        self._cached = None
        self._expires = 0.0

    def invalidate(self) -> None:
        with self._lock:
            self._expires = 0.0

    def snapshot(self) -> tuple[list[dict], dict[str, Asset]]:
        with self._lock:
            if self._cached is None or time.monotonic() >= self._expires:
                self._cached = self.scan()
                self._expires = time.monotonic() + self.cache_seconds
            return self._cached

    def inventory(self) -> list[Asset]:
        assets = []
        for folder in sorted(self.memory_root.glob("memory-*")):
            slug = folder.name.removeprefix("memory-")
            if not re.fullmatch(r"[a-z0-9_-]+", slug):
                continue
            for note in sorted(folder.glob("*.md")):
                relative = str(note.relative_to(self.memory_root))
                if note.name != "MEMORY.md" and permitted(relative):
                    assets.append(Asset(self.memory_root, relative, slug, "memoria"))
        for note in sorted((self.repo / "ze-shared/memory").glob("shared_*.md")):
            relative = str(note.relative_to(self.repo))
            if permitted(relative):
                assets.append(Asset(self.repo, relative, "ze-shared", "memoria_compartilhada"))
        seen = set()
        for note in sorted(self.repo.glob("*/.claude/skills/*/SKILL.md")):
            alias = str(note.relative_to(self.repo))
            if not permitted(alias):
                continue
            canonical = note.resolve()
            if not canonical.is_relative_to(self.repo.resolve()):
                continue
            relative = str(canonical.relative_to(self.repo.resolve()))
            # Só aliases para pastas canônicas de skills ativas no próprio repo.
            parts = Path(relative).parts
            if (len(parts) != 5 or parts[1:3] != (".claude", "skills")
                    or not permitted(relative) or relative in seen):
                continue
            seen.add(relative)
            workspace = self.repo / parts[0]
            owner = self.owners.get(str(workspace.resolve()), parts[0])
            assets.append(Asset(self.repo, relative, owner, "skill"))
        return assets

    def dreamed(self, asset: Asset, text: str) -> tuple[int, str] | None:
        """Proposta sozinha não é aplicação; backup + IDs + digest precisam casar."""
        if asset.tipo != "memoria":
            return None
        state = self.dream_root / f"dream-{asset.agente}"
        found = []
        for applied in state.glob("backup/*/aplicacao.json"):
            round_id = applied.parent.name
            if not re.fullmatch(r"\d{8}T\d{6}\.\d{6}Z", round_id):
                continue
            try:
                application = json.loads(read_content(
                    self.dream_root, str(applied.relative_to(self.dream_root))))
                manifest = json.loads(read_content(
                    self.dream_root,
                    f"dream-{asset.agente}/propostas/{round_id}/manifesto.json"))
                name = Path(asset.relative).name
                info = manifest.get("arquivos", {}).get(name, {})
                ids = set(application["ids"])
                generated = {n for p in manifest["propostas"] if p["id"] in ids
                             for n in p.get("gerados", [])}
                when = epoch(application.get("ts"))
                if (name in generated and set(info.get("ids", [])) <= ids and when
                        and manifest.get("agente", asset.agente) == asset.agente
                        and info.get("proposto_sha256") == hashlib.sha256(text.encode()).hexdigest()):
                    found.append((when, "criou" if name in application.get("novos", []) else "mudou"))
            except (OSError, ValueError, KeyError, TypeError, OverflowError):
                continue
        return max(found) if found else None

    def scan(self) -> tuple[list[dict], dict[str, Asset]]:
        assets = self.inventory()
        dates = git_dates(self.repo, [a for a in assets if a.root == self.repo])
        nodes, lookup = [], {}
        for asset in assets:
            try:
                text = read_content(asset.root, asset.relative)
                mtime = int(asset.path.stat().st_mtime)
            except OverflowError:
                text, mtime = "", int(asset.path.stat().st_mtime)
            except (OSError, ValueError):
                continue
            meta = metadata(text)
            title = meta.get("name") or next((s.lstrip("# ") for s in safe_lines(text)
                                             if s.startswith("# ")), asset.path.stem)
            description = meta.get("description", "")
            title = " ".join(safe_lines(str(title)))[:200] or asset.path.stem
            description = " ".join(safe_lines(str(description)))[:300]
            extra = meta.get("metadata")
            modified = epoch(extra.get("modified")) if isinstance(extra, dict) else None
            latest, first = dates.get(asset.key, (None, None))
            events = [("criou", first, "git")] if first else []
            if latest and latest != first:
                events.append(("mudou", latest, "git"))
            if not latest:
                events = [("mudou", modified or mtime, "metadata.modified" if modified else "mtime")]
            dreamed = self.dreamed(asset, text)
            if dreamed:
                events = [(dreamed[1], dreamed[0], "sonho")]
            for action, when, source in events:
                node_id = hashlib.sha256(f"{asset.key}:{action}".encode()).hexdigest()[:32]
                node = dict(id=node_id, agente=asset.agente, tipo=asset.tipo, acao=action,
                            data=when, titulo=title, descricao=description,
                            origem="sonho" if source == "sonho" else "agente",
                            caminho=str(asset.root / asset.relative), fonte_data=source)
                nodes.append(node)
                lookup[node_id] = asset
        nodes.sort(key=lambda n: (-n["data"], n["id"]))
        return nodes, lookup

    def content(self, asset: Asset) -> str:
        if not permitted(asset.relative):
            raise ValueError("caminho não permitido")
        return "\n".join(safe_lines(read_content(asset.root, asset.relative)))
