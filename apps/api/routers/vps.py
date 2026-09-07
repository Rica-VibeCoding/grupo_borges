"""GET /api/vps — o consumo da máquina que roda a frota, pro rodapé da tropa.

Fora do `/api/fleet` de propósito: aquele snapshot é dos AGENTES e o tipo dele
mora no `cockpit-core`, compartilhado pelas três frentes. Máquina é outro
assunto, com outro ritmo de leitura, e um endpoint próprio deixa o bloco da
tela ser dono do seu ciclo sem encostar no contrato da frota.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from services import vps_recursos

router = APIRouter()


class Recurso(BaseModel):
    usado_mb: int
    livre_mb: int
    total_mb: int
    pct: float = Field(description="usado / (usado + livre), a mesma conta do `df`")


class Vilao(BaseModel):
    nome: str = Field(description="nome do agente quando o cgroup entrega; senão o do processo")
    pct: float
    usado_mb: int


class Vilaos(BaseModel):
    """Quem mais come de cada coisa que trava a máquina. `null` = não deu pra medir."""

    cpu: Vilao | None
    ram: Vilao | None


class VpsRecursos(BaseModel):
    cpu_pct: float | None = Field(
        description="média entre as duas últimas leituras; null quando não houve intervalo",
    )
    carga_1m: float
    nucleos: int
    ram: Recurso
    swap: Recurso | None = Field(description="null na máquina sem swap")
    disco: Recurso
    vilao: Vilaos
    no_ar_segundos: int
    medido_em: int


@router.get("", response_model=VpsRecursos)
async def get_vps() -> dict:
    return await vps_recursos.ler()
