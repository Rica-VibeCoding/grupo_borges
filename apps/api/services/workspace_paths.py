"""Cerca de workspaces compartilhada pelo launcher e pelas subsessões."""
from pathlib import Path

from config import get_settings


def allowed_roots(default: Path) -> tuple[Path, ...]:
    configured = get_settings().allowed_workspace_roots
    if not configured:
        return (default,)
    paths = configured.split(":")
    if any(not p or not Path(p).is_absolute() for p in paths):
        raise ValueError("GB_ALLOWED_WORKSPACE_ROOTS exige caminhos absolutos")
    return tuple(Path(p).resolve() for p in paths)


def validate_workspace(path: str, default: Path) -> Path:
    resolved = Path(path).resolve()
    roots = allowed_roots(default)
    if not any(resolved.is_relative_to(root) for root in roots):
        raise ValueError(f"workspace_path fora de {', '.join(map(str, roots))}: {path}")
    return resolved
