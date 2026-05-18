"""MCP tools — funções de side-effect invocáveis pelo agente-pai.

Cada módulo expõe uma async function + Pydantic input model.
O router de agents.py expõe essas funções via HTTP pra o client web.
"""
from mcp_tools.spawn_subsession import SpawnSubsessionInput, spawn_subsession

__all__ = ["SpawnSubsessionInput", "spawn_subsession"]
