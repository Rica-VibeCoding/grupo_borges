"""A troca de conversa chama o controlador do hospedeiro, nunca Incus/tmux kill."""
from __future__ import annotations

import asyncio
import os
import tempfile
import uuid
from pathlib import Path

import httpx


class ClientLifecycle:
    def __init__(self, slug: str, socket: str, token: str, resume_file: str):
        if len(token) < 32 or not Path(socket).is_absolute() or not Path(resume_file).is_absolute():
            raise ValueError("configuração de lifecycle inválida")
        self.slug = slug
        self.socket = socket
        self.token = token
        self.resume_file = Path(resume_file)

    async def _call(self, action: str) -> dict:
        async with httpx.AsyncClient(transport=httpx.AsyncHTTPTransport(uds=self.socket),
                                     base_url="http://local", timeout=30) as client:
            try:
                result = await client.post(f"/v1/clients/{self.slug}/{action}",
                                           headers={"authorization": f"Bearer {self.token}"})
            except httpx.HTTPError as exc:
                raise ValueError("controlador indisponível") from exc
        if result.status_code != 200:
            raise ValueError("controlador recusou ação")
        return result.json()

    async def shutdown_agent(self, session_name: str) -> dict:
        if session_name != "agente":
            raise ValueError("sessão inválida")
        return await self._call("stop")

    async def boot_agent(self, session_name: str, resume_session_id: str | None = None) -> dict:
        if session_name != "agente":
            raise ValueError("sessão inválida")
        if resume_session_id is not None:
            try:
                resume_session_id = str(uuid.UUID(resume_session_id))
            except ValueError as exc:
                raise ValueError("session_id inválido") from exc
        await asyncio.to_thread(self._write_resume, resume_session_id)
        try:
            result = await self._call("start")
        except ValueError:
            await asyncio.to_thread(self.resume_file.unlink, missing_ok=True)
            raise
        if not result.get("tmux_delivered"):
            raise ValueError("partida não confirmada")
        return result

    def _write_resume(self, session_id: str | None) -> None:
        self.resume_file.parent.mkdir(parents=True, exist_ok=True)
        if session_id is None:
            self.resume_file.unlink(missing_ok=True)
            return
        with tempfile.NamedTemporaryFile(mode="w", dir=self.resume_file.parent,
                                         prefix=".resume-", delete=False, encoding="ascii") as handle:
            handle.write(session_id + "\n")
            temporary = handle.name
        os.chmod(temporary, 0o600)
        os.replace(temporary, self.resume_file)
