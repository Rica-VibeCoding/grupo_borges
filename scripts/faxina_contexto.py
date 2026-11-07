"""Sinais locais do Jev. Só stdlib; banco sempre aberto com mode=ro."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import re
import sqlite3
import subprocess
import unicodedata

from services.faxina import read_content, restricted_path, safe_path

SECRET = re.compile(r"sk-|sb_secret|token|senha|password|api[ _-]?key|Bearer|[A-Za-z0-9+/]{32,}={0,2}", re.I)
STATE = re.compile(r"status|estado|concluíd|implementad|entregue|desligad|descartável|revogad|substituíd|virou skill|aposentad|fechad", re.I)
STOP = set("para como com uma uns umas dos das que por mais sobre este esta esse essa seu sua the and for with from this that skill skills docs doc plano planos readme memory claude agents projeto projetos pesquisa arquivo arquivos documentação documentacao implementação implementacao".split())


def permitted(repo: Path, path: str, *, transmitted: bool = True) -> bool:
    if not path or (transmitted and SECRET.search(path)) or restricted_path(repo, path):
        return False
    if {"vault", "cofre"} & set(Path(path).parts):
        return False
    try:
        safe_path(repo, path)
    except (ValueError, OSError):
        return False
    return True


def safe_lines(text: str) -> list[str]:
    return [line for line in text.splitlines() if not SECRET.search(line)]


def document(repo: Path, item: dict) -> str:
    path = item.get("conteudo_caminho", item["caminho"])
    if item["tipo"] == "skill":
        path += "/SKILL.md"
    # O endereço físico arquivado não é enviado. SECRET filtra seu conteúdo;
    # aplicá-lo ao endereço também confundiria caminhos longos com base64.
    if not permitted(repo, path, transmitted=False):
        return ""
    try:
        return read_content(repo, path)
    except (ValueError, OSError, OverflowError):
        return ""


def human_decision(row: dict) -> bool:
    if row["status"] not in {"arquivado", "mantido"} or row.get("decidido_em") is None:
        return False
    # O schema não guarda ator/origem. Falha conservadora: excluir TODO arquivo
    # compatível com arquivar_sem_resposta, inclusive possíveis toques humanos.
    automatic = (row["status"] == "arquivado" and row.get("jev_veredito") == "arquivar"
                 and (row.get("jev_probabilidade") or 0) >= 0.8
                 and row["decidido_em"] - row["criado_em"] >= 7 * 86400 - 3600)
    return not automatic


def read_decisions(db_path: Path) -> list[dict]:
    with sqlite3.connect(db_path.resolve().as_uri() + "?mode=ro", uri=True) as conn:
        conn.row_factory = sqlite3.Row
        return [dict(row) for row in conn.execute(
            "SELECT * FROM faxina_item WHERE status IN ('arquivado', 'mantido') "
            "AND decidido_em IS NOT NULL ORDER BY decidido_em DESC, id DESC"
        ) if human_decision(dict(row))]


def past_examples(repo: Path, item: dict, decisions: list[dict]) -> list[dict]:
    path = Path(item["caminho"])
    rows = [row for row in decisions if human_decision(row)
            and row["workspace"] == item["workspace"]
            and row["caminho"] != item["caminho"] and row.get("id") != item.get("id", -1)
            and permitted(repo, row["caminho"])
            and (item.get("decidido_em") is None or row["decidido_em"] < item["decidido_em"])]
    rows.sort(key=lambda row: (Path(row["caminho"]).parent != path.parent,
                              -row["decidido_em"], -row["id"]))
    # Deduplicar o caminho, pois um mantido pode voltar a ser candidato.
    examples, seen = [], set()
    for row in rows:
        if row["caminho"] not in seen:
            examples.append({"caminho": row["caminho"], "decisao": row["status"]})
            seen.add(row["caminho"])
        if len(examples) == 8:
            break
    return examples


def git_output(repo: Path, *args: str, no_match: bool = False) -> str:
    result = subprocess.run(["git", "-C", str(repo), *args], capture_output=True,
                            text=True, encoding="utf-8", errors="replace", timeout=60)
    if result.returncode and not (no_match and result.returncode == 1):
        raise RuntimeError("não foi possível coletar contexto git para o Jev")
    return result.stdout


def citations(repo: Path, item: dict) -> dict:
    path = item["caminho"]
    # Só nomes de arquivos saem do grep, nunca a linha que pode conter segredo.
    names = git_output(repo, "grep", "-l", "-z", "-I", "-F", "-e", path,
                       "-e", Path(path).name, "--", ".", ":(exclude)**/arquivo/**",
                       ":(exclude)**/vault/**", ":(exclude)**/cofre/**",
                       ":(exclude)**/.env*", no_match=True).split("\0")
    found = sorted({name for name in names if name and name != path
                    and not Path(name).is_relative_to(path)
                    and "arquivo" not in Path(name).parts and permitted(repo, name)})
    return {"contagem": len(found), "caminhos": found[:5]}


def terms(text: str) -> set[str]:
    text = "".join(c for c in unicodedata.normalize("NFKD", text.lower())
                   if not unicodedata.combining(c))
    return {word for word in re.findall(r"[a-z0-9]+", text)
            if len(word) >= 4 and not word.isdigit() and word not in STOP}


def frontmatter(text: str) -> dict[str, str]:
    """name/description YAML escalares, inclusive > e |, sem dependência YAML."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    result = {}
    key = None
    for line in lines[1:]:
        if line.strip() == "---":
            break
        match = re.match(r"^(name|description):\s*(.*)$", line)
        if match:
            key, value = match.groups()
            result[key] = "" if value in {">", "|", ">-", "|-"} else value.strip("\"'")
        elif key and line[:1].isspace():
            result[key] += " " + line.strip()
        else:
            key = None
    # Filtrar antes de truncar: segredo após o caractere 150 também elimina o campo.
    return {key: value.strip() for key, value in result.items() if not SECRET.search(value)}


def active_skills(repo: Path, workspace: str) -> list[dict]:
    found = {}
    for space in sorted({workspace, "ze-shared"}):
        if not permitted(repo, space + "/.claude/skills"):
            continue
        for path in sorted((repo / space / ".claude/skills").glob("*/SKILL.md")):
            relative = path.relative_to(repo).as_posix()
            # Aliases internos são resolvidos, mas nunca seguem para cofre/fora.
            canonical = path.resolve()
            if restricted_path(repo, relative) or not canonical.is_relative_to(repo):
                continue
            name = canonical.relative_to(repo).as_posix()
            if "arquivo" in Path(name).parts or not permitted(repo, name, transmitted=False):
                continue
            try:
                metadata = frontmatter(read_content(repo, name))
            except (ValueError, OSError, OverflowError):
                continue
            label = metadata.get("name", path.parent.name)
            if SECRET.search(label) or SECRET.search(relative):
                continue
            description = metadata.get("description", "")
            found.setdefault(name, {"nome": label, "description": description[:150],
                                    "caminho": relative,
                                    "termos": terms(label + " " + description)})
    return list(found.values())


def enrich(repo: Path, items: list[dict], decisions: list[dict], *, include_content: bool) -> list[dict]:
    skills, folders, enriched = {}, {}, []
    # Em teste unitário pode haver só um diretório de conteúdo, sem git.
    has_git = (repo / ".git").exists()
    for item in items:
        path = item["caminho"]
        text = document(repo, item) if include_content else ""
        title = next((line for line in safe_lines(text) if line.startswith("# ")), "")
        workspace = item["workspace"]
        # O nome do assistente aparece em muitas descriptions, mas não é assunto.
        topic = terms("/".join(Path(path).parts[1:]) + " " + title) - terms(workspace)
        if workspace not in skills:
            skills[workspace] = active_skills(repo, workspace) if include_content else []
        matches = [skill for skill in skills[workspace]
                   if topic & skill["termos"]
                   and (repo / skill["caminho"]).resolve().parent != (repo / path).resolve()]
        matches.sort(key=lambda skill: (-len(topic & skill["termos"]), skill["caminho"]))
        folder = str(Path(path).parent)
        if folder not in folders:
            stamp = git_output(repo, "--literal-pathspecs", "log", "-1", "--format=%ct", "--", folder).strip() if has_git else ""
            folders[folder] = (datetime.fromtimestamp(int(stamp), timezone.utc).isoformat()
                               if stamp else None)
        signals = {
            "linhas_estado": [line.strip()[:240] for line in safe_lines(text) if STATE.search(line)][:6],
            "citacoes_repo": citations(repo, item) if has_git else {"contagem": 0, "caminhos": []},
            "skills_relacionadas": [{k: v for k, v in skill.items() if k != "termos"} for skill in matches[:5]],
            "ultimo_commit_pasta": folders[folder],
            "decisoes_rica": past_examples(repo, item, decisions),
        }
        enriched.append(item | {"sinais": signals})
    return enriched
