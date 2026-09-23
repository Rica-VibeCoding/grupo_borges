#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
import re
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps/api"))

from config import get_settings
from db.store import GrupoBorgesDB
from faxina_executor import cited_indexes, git, read_indexes
from services.faxina import ZE_CLAUDE_ROOT

WINDOW = 20 * 86400
INCLUDE = re.compile(r"(?<![\w])@(?:include\s+)?([^\s`<>()\[\],;]+)")


def inventory(repo: Path) -> list[dict]:
    candidates = {}
    tracked = git(repo, "ls-files", "-z").split("\0")
    for name in tracked:
        path = Path(name)
        if len(path.parts) < 3 or path.suffix.lower() != ".md" or "arquivo" in path.parts:
            continue
        if path.parts[1] != "docs" and path.parts[:2] != ("ze-shared", "planos"):
            continue
        resolved = (repo / path).resolve()
        if not resolved.is_relative_to(repo) or not resolved.is_file():
            continue
        canonical = resolved.relative_to(repo).as_posix()
        candidates[canonical] = {"caminho": canonical, "workspace": Path(canonical).parts[0],
                                 "tipo": "plano" if path.parts[:2] == ("ze-shared", "planos") else "doc"}
    for skill in repo.glob("*/.claude/skills/*/SKILL.md"):
        resolved = skill.resolve()
        if not resolved.is_relative_to(repo) or not resolved.is_file():
            continue
        directory = resolved.parent
        canonical = directory.relative_to(repo).as_posix()
        if "arquivo" in directory.relative_to(repo).parts:
            continue
        entry = candidates.setdefault(canonical, {"caminho": canonical,
            "workspace": Path(canonical).parts[0], "tipo": "skill", "nomes": []})
        if skill.parent.name not in entry["nomes"]:
            entry["nomes"].append(skill.parent.name)
        text = resolved.read_text(encoding="utf-8", errors="replace")
        match = re.match(r"\A---\s*\n.*?^name:\s*([^\n]+)", text, re.M | re.S)
        if match:
            declared = match.group(1).strip().strip("\"'")
            if declared not in entry["nomes"]:
                entry["nomes"].append(declared)
    return sorted(candidates.values(), key=lambda item: item["caminho"])


def included_at_boot(repo: Path, indexes: dict[str, str]) -> set[Path]:
    pending = [repo / name for name in indexes if Path(name).name == "CLAUDE.md"]
    included = set()
    while pending:
        source = pending.pop()
        resolved = source.resolve()
        if resolved in included or not resolved.is_relative_to(repo) or not resolved.is_file():
            continue
        included.add(resolved)
        text = resolved.read_text(encoding="utf-8", errors="replace")
        for match in INCLUDE.finditer(text):
            target = Path(match.group(1)).expanduser()
            if not target.is_absolute():
                target = source.parent / target
            if target.resolve().is_relative_to(repo):
                pending.append(target)
    return included


def readings(log: Path, repo: Path, now: int) -> tuple[int | None, dict[str, int], dict[str, int]]:
    first = None
    files, skills = {}, {}
    if not log.exists():
        return first, files, skills
    with log.open(encoding="utf-8") as source:
        for line in source:
            try:
                row = json.loads(line)
                stamp = row["ts"]
                target = row["alvo"]
                if (not isinstance(stamp, int) or isinstance(stamp, bool) or not 0 < stamp <= now
                        or not isinstance(target, str) or not target):
                    continue
                if row["tool"] == "Read":
                    path = Path(target)
                    if not path.is_absolute():
                        path = Path(row["cwd"]) / path
                    path = path.resolve()
                    if path.is_relative_to(repo):
                        relative = path.relative_to(repo).as_posix()
                        files[relative] = max(files.get(relative, 0), stamp)
                elif row["tool"] == "Skill":
                    skills[target] = max(skills.get(target, 0), stamp)
                else:
                    continue
                first = stamp if first is None else min(first, stamp)
            except (ValueError, TypeError, KeyError, OSError):
                continue
    return first, files, skills


def collect(repo: Path, log: Path, now: int | None = None) -> dict:
    repo = repo.resolve()
    now = int(time.time()) if now is None else now
    first, files, skills = readings(log, repo, now)
    indexes = read_indexes(repo)
    includes = included_at_boot(repo, indexes)
    candidates = []
    items = inventory(repo)
    for item in items:
        path = repo / item["caminho"]
        if path in includes or (item["tipo"] == "skill" and any(p.is_relative_to(path) for p in includes)):
            continue
        last_read = files.get(item["caminho"], 0)
        if item["tipo"] == "skill":
            last_read = max([last_read] + [stamp for name, stamp in files.items()
                if Path(name).is_relative_to(item["caminho"])] +
                [stamp for name, stamp in skills.items()
                 if name in item["nomes"] or name.split(":")[-1] in item["nomes"]])
        committed = git(repo, "log", "-1", "--format=%ct", "--", item["caminho"])
        if not committed:
            continue
        last_commit = int(committed)
        if now - max(last_read, last_commit) < WINDOW:
            continue
        if git(repo, "status", "--porcelain", "--untracked-files=all", "--", item["caminho"]):
            continue
        candidates.append({key: value for key, value in item.items() if key != "nomes"} | {
            "ultima_leitura": last_read or None, "ultimo_commit": last_commit,
            "dias_parado": (now - max(last_read, last_commit)) // 86400,
            "citado_em": cited_indexes(repo, item["caminho"], indexes),
        })
    return {"modo": "aplicar" if first is not None and now - first >= WINDOW else "relatorio",
            "historico_desde": first, "inventariados": len(items), "candidatos": candidates,
            "novos": 0, "varredura_em": now}


async def new_candidates(report: dict, db: GrupoBorgesDB) -> list[dict]:
    existing = (await db.list_faxina("todos"))["itens"]
    blocked = {item["caminho"] for item in existing if item["status"] != "mantido"
               or (item["decidido_em"] or 0) > report["varredura_em"] - WINDOW}
    return [item for item in report["candidatos"] if item["caminho"] not in blocked]


async def persist(report: dict, db: GrupoBorgesDB, verdicts: dict | None = None) -> list[dict]:
    if report["modo"] != "aplicar":
        return []
    existing = (await db.list_faxina("todos"))["itens"]
    ids = {item["id"] for item in existing}
    created = []
    for candidate in report["candidatos"]:
        fields = {key: value for key, value in candidate.items() if key != "dias_parado"}
        # A idade não autoriza mover: promoção automática exige decisão separada do Rica.
        item = await db.create_faxina_item(**fields, **(verdicts or {}).get(candidate["caminho"], {}))
        if item is not None and item["id"] not in ids:
            created.append(item)
            ids.add(item["id"])
    await db.record_faxina_scan(report["varredura_em"])
    return created


def main() -> None:
    parser = argparse.ArgumentParser(description="Varredura da Faxina, sem arquivamento automático.")
    parser.add_argument("--repo", type=Path, default=ZE_CLAUDE_ROOT)
    parser.add_argument("--leituras", type=Path, default=Path.home() / ".claude/metrics/leituras.jsonl")
    parser.add_argument("--db", default=get_settings().db_path)
    parser.add_argument("--aplicar", action="store_true")
    parser.add_argument("--incluir-cabecalhos", action="store_true",
                        help="Envio externo de cabeçalhos; só habilitar com aprovação do Rica.")
    args = parser.parse_args()
    report = collect(args.repo, args.leituras)
    if not args.aplicar:
        report["modo"] = "relatorio"
    if report["modo"] == "aplicar":
        from faxina_jev import evaluate

        db = GrupoBorgesDB(args.db)
        report["candidatos"] = asyncio.run(new_candidates(report, db))
        verdicts, usage = evaluate(report["candidatos"], repo=args.repo.resolve(),
                                   include_headings=args.incluir_cabecalhos)
        created = asyncio.run(persist(report, db, verdicts))
        report["novos"] = len(created)
        report["jev_uso"] = usage
    report["candidatos"] = len(report["candidatos"])
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
