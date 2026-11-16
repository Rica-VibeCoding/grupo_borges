"""Inventário local de aprendizado. Nenhum caminho recebido do cliente é aberto."""
from __future__ import annotations

import hashlib
import json
import logging
import re
import subprocess
import threading
import time
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path

import yaml

from services.faxina import SECRET, read_content, safe_lines, safe_path

logger = logging.getLogger(__name__)


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

    def memory_location(self, slug: str) -> tuple[Path, str]:
        """Confia só no alias da pasta; safe_path ainda rejeita links abaixo dela."""
        folder = (self.memory_root / f"memory-{slug}").resolve(strict=True)
        # O leitor compartilhado exige ao menos dois componentes relativos.
        return folder.parent, folder.name

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
            try:
                root, directory = self.memory_location(slug)
                for note in sorted((root / directory).glob("*.md")):
                    relative = f"{directory}/{note.name}"
                    if note.name != "MEMORY.md" and permitted(relative):
                        assets.append(Asset(root, relative, slug, "memoria"))
            except (OSError, ValueError, RuntimeError) as exc:
                logger.warning("pasta de memória ignorada %s: %s", folder, exc)
        for note in sorted((self.repo / "ze-shared/memory").glob("shared_*.md")):
            relative = str(note.relative_to(self.repo))
            if permitted(relative):
                assets.append(Asset(self.repo, relative, "ze-shared", "memoria_compartilhada"))
        seen = set()
        for note in sorted(self.repo.glob("*/.claude/skills/*/SKILL.md")):
            alias = str(note.relative_to(self.repo))
            if not permitted(alias):
                continue
            try:
                canonical = note.resolve()
            except (OSError, ValueError, RuntimeError) as exc:
                logger.warning("skill ignorada %s: %s", note, exc)
                continue
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

    def applications(self, agents: set[str]) -> dict:
        """Lê cada aplicação e manifesto uma vez por varredura, não por memória."""
        found = {}
        for agent in sorted(agents):
            state = self.dream_root / f"dream-{agent}"
            try:
                applied_files = list(state.glob("backup/*/aplicacao.json"))
            except OSError as exc:
                logger.warning("aplicações de Sonho indisponíveis %s: %s", agent, exc)
                continue
            for applied in applied_files:
                self.load_application(agent, applied, found)
        return found

    def load_application(self, agent: str, applied: Path, found: dict) -> None:
        """Proposta sozinha não é aplicação; backup + IDs + digest precisam casar."""
        try:
            round_id = applied.parent.name
            if not re.fullmatch(r"\d{8}T\d{6}\.\d{6}Z", round_id):
                return
            application = json.loads(read_content(
                self.dream_root, str(applied.relative_to(self.dream_root))))
            manifest = json.loads(read_content(
                self.dream_root, f"dream-{agent}/propostas/{round_id}/manifesto.json"))
            ids = set(application["ids"])
            generated = {n for p in manifest["propostas"] if p["id"] in ids
                         for n in p.get("gerados", [])}
            when = epoch(application.get("ts"))
            if not when or manifest.get("agente", agent) != agent:
                return
            for name in generated:
                info = manifest.get("arquivos", {}).get(name, {})
                digest = info.get("proposto_sha256")
                if digest and set(info.get("ids", [])) <= ids:
                    action = "criou" if name in application.get("novos", []) else "mudou"
                    found.setdefault((agent, name, digest), []).append((when, action))
        except (OSError, ValueError, KeyError, TypeError, OverflowError, AttributeError, RuntimeError) as exc:
            logger.warning("aplicação de Sonho ignorada %s: %s", applied, exc)

    def dreamed(self, asset: Asset, text: str, applications: dict) -> tuple[int, str] | None:
        if asset.tipo != "memoria":
            return None
        key = asset.agente, Path(asset.relative).name, hashlib.sha256(text.encode()).hexdigest()
        return max(applications.get(key, []), default=None)

    def scan(self) -> tuple[list[dict], dict[str, Asset]]:
        assets = self.inventory()
        try:
            dates = git_dates(self.repo, [a for a in assets if a.root == self.repo])
        except (OSError, RuntimeError, subprocess.TimeoutExpired, ValueError) as exc:
            logger.warning("histórico Git indisponível; usando datas locais: %s", exc)
            dates = {}
        applications = self.applications({a.agente for a in assets if a.tipo == "memoria"})
        nodes, lookup = [], {}
        for asset in assets:
            try:
                try:
                    text = read_content(asset.root, asset.relative)
                except OverflowError:
                    text = ""
                mtime = int(asset.path.stat().st_mtime)
                self.add_nodes(asset, text, mtime, dates, applications, nodes, lookup)
            except (OSError, ValueError, OverflowError, RuntimeError, TypeError, KeyError) as exc:
                logger.warning("arquivo de aprendizado ignorado %s: %s", asset.root / asset.relative, exc)
                continue
        nodes.sort(key=lambda n: (-n["data"], n["id"]))
        return nodes, lookup

    def add_nodes(self, asset: Asset, text: str, mtime: int, dates: dict,
                  applications: dict, nodes: list, lookup: dict) -> None:
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
        dreamed = self.dreamed(asset, text, applications)
        if dreamed:
            events = [(dreamed[1], dreamed[0], "sonho")]
        for action, when, source in events:
            node_id = hashlib.sha256(f"{asset.key}:{action}".encode()).hexdigest()[:32]
            target_id = hashlib.sha256(asset.key.encode()).hexdigest()[:32]
            node = dict(id=node_id, alvo_id=target_id, agente=asset.agente, tipo=asset.tipo, acao=action,
                        data=when, titulo=title, descricao=description,
                        origem="sonho" if source == "sonho" else "agente",
                        caminho=str(asset.root / asset.relative), fonte_data=source)
            nodes.append(node)
            lookup[node_id] = asset

    def content(self, asset: Asset) -> str:
        if not permitted(asset.relative):
            raise ValueError("caminho não permitido")
        return "\n".join(safe_lines(read_content(asset.root, asset.relative)))
