from __future__ import annotations

import ipaddress
import re
import socket
import subprocess
from pathlib import Path
from urllib.parse import urlparse

import httpx

VALID_PREFIXES = ("file:", "commit:", "url:", "screenshot:", "log:")
SCREENSHOT_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
COMMIT_HASH_RE = re.compile(r"^[0-9a-fA-F]{4,64}$")


def validate_evidence_refs(
    refs: list[str],
    workspace_path: str,
    repo_aliases: dict[str, str],
) -> list[dict[str, str | bool | None]]:
    """Valida referencias de evidencia usadas por reviews e handoffs."""
    if not refs:
        return []

    return [_validate_evidence_ref(ref, workspace_path, repo_aliases) for ref in refs]


def _validate_evidence_ref(
    ref: str,
    workspace_path: str,
    repo_aliases: dict[str, str],
) -> dict[str, str | bool | None]:
    if ref.startswith("file:"):
        return _validate_path_ref(ref, "file", workspace_path)
    if ref.startswith("commit:"):
        return _validate_commit_ref(ref, repo_aliases)
    if ref.startswith("url:"):
        return _validate_url_ref(ref)
    if ref.startswith("screenshot:"):
        return _validate_path_ref(ref, "screenshot", workspace_path, require_screenshot=True)
    if ref.startswith("log:"):
        return _validate_path_ref(ref, "log", workspace_path)

    raise ValueError(f"evidence_ref sem prefixo: {ref}")


def _result(
    ref: str,
    ref_type: str,
    valid: bool,
    reason: str | None = None,
) -> dict[str, str | bool | None]:
    return {"ref": ref, "type": ref_type, "valid": valid, "reason": reason}


def _validate_path_ref(
    ref: str,
    ref_type: str,
    workspace_path: str,
    *,
    require_screenshot: bool = False,
) -> dict[str, str | bool | None]:
    _, raw_path = ref.split(":", 1)
    workspace_root = Path(workspace_path).resolve()
    target = (workspace_root / raw_path).resolve()

    # Path traversal: target precisa permanecer dentro do workspace mesmo após
    # resolver `..` e symlinks. Sem esse check, evidence_ref vira info-disclosure.
    try:
        target.relative_to(workspace_root)
    except ValueError:
        return _result(ref, ref_type, False, "path fora do workspace")

    if require_screenshot and target.suffix.lower() not in SCREENSHOT_EXTENSIONS:
        return _result(ref, ref_type, False, "extensao invalida")

    if not target.exists():
        return _result(ref, ref_type, False, "arquivo nao encontrado")

    return _result(ref, ref_type, True)


def _validate_commit_ref(
    ref: str,
    repo_aliases: dict[str, str],
) -> dict[str, str | bool | None]:
    parts = ref.split(":", 2)
    if len(parts) != 3 or not parts[1] or not parts[2]:
        return _result(ref, "commit", False, "formato invalido")

    _, repo_alias, commit_hash = parts
    if not COMMIT_HASH_RE.match(commit_hash):
        return _result(ref, "commit", False, "hash invalido (so hex 4-64 chars)")

    repo_path = repo_aliases.get(repo_alias)
    if repo_path is None:
        return _result(ref, "commit", False, "repo_alias desconhecido")

    # `--` separa argumentos de refs; impede que hash que comece com '-' vire flag.
    proc = subprocess.run(
        ["git", "-C", repo_path, "cat-file", "-e", "--", commit_hash],
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        return _result(ref, "commit", False, "commit nao encontrado")

    return _result(ref, "commit", True)


def _is_public_address(host: str) -> bool:
    """Bloqueia loopback, link-local, privados e metadata IMDS pra prevenir SSRF."""
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    for info in infos:
        addr = info[4][0]
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            return False
        if ip.is_loopback or ip.is_link_local or ip.is_private or ip.is_multicast or ip.is_reserved:
            return False
    return True


def _validate_url_ref(ref: str) -> dict[str, str | bool | None]:
    _, url = ref.split(":", 1)
    if not url.startswith("https://"):
        return _result(ref, "url", False, "url deve usar https")

    parsed = urlparse(url)
    if not parsed.hostname:
        return _result(ref, "url", False, "hostname ausente")
    if not _is_public_address(parsed.hostname):
        return _result(ref, "url", False, "host interno/privado bloqueado (SSRF)")

    try:
        response = httpx.head(
            url,
            timeout=5.0,
            follow_redirects=False,
            headers={"User-Agent": "grupo_borges-evidence-validator/1.0"},
        )
    except httpx.HTTPError as exc:
        return _result(ref, "url", False, str(exc))

    if response.status_code >= 400:
        return _result(ref, "url", False, f"status HTTP {response.status_code}")

    return _result(ref, "url", True)
