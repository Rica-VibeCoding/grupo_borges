from __future__ import annotations

import asyncio
import hashlib
import json
import os
import subprocess

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from db.store import GrupoBorgesDB
from routers import aprendizado
from services.aprendizado import Aprendizado
from services.faxina import CONTENT_LIMIT


def git(repo, *args, when=None):
    env = os.environ.copy()
    if when:
        env.update(GIT_AUTHOR_DATE=when, GIT_COMMITTER_DATE=when)
    return subprocess.check_output(['git', '-C', str(repo), *args], env=env, text=True).strip()


def write(root, relative, text):
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path


@pytest.fixture
def env(tmp_path):
    repo = tmp_path / 'ze_claude'
    repo.mkdir()
    git(repo, 'init', '-q')
    git(repo, 'config', 'user.name', 'Teste')
    git(repo, 'config', 'user.email', 'teste@example.invalid')
    skill = 'pavan/.claude/skills/rotina/SKILL.md'
    write(repo, skill, '---\nname: Rotina\ndescription: Explicação\n---\n# Rotina\n')
    write(repo, 'ze-shared/memory/shared_regra.md', '# Regra comum\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-qm', 'cria', when='2026-01-01T10:00:00Z')
    write(repo, 'pavan/.claude/skills/rotina/script.py', '# Mudança auxiliar\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-qm', 'muda script', when='2026-02-01T10:00:00Z')
    memory = tmp_path / 'claude'
    write(memory, 'memory-pavan/nota.md', '---\nname: Nota\ndescription: Lição\nmetadata:\n  modified: 2026-03-01T10:00:00Z\n---\n# Nota\nTexto inteiro\nsenha: nao-exibir\n')
    note = write(memory, 'memory-daniel/outra.md', '# Outra\n')
    os.utime(note, (1772360000, 1772360000))
    write(memory, 'memory-pavan/MEMORY.md', '- [Nota](nota.md)\n')
    reader = Aprendizado(memory, repo, tmp_path / 'state', [
        {'slug': 'pavan', 'workspace_path': str(repo / 'pavan')},
    ], cache_seconds=0)
    db = GrupoBorgesDB(str(tmp_path / 'test.db'))
    asyncio.run(db.startup())
    app = FastAPI()
    app.state.db = db
    app.state.aprendizado = reader
    app.include_router(aprendizado.router, prefix='/api/aprendizado')
    with TestClient(app) as client:
        yield reader, db, client


def nodes(client, **params):
    response = client.get('/api/aprendizado', params=params)
    assert response.status_code == 200, response.text
    return response.json()['itens']


def test_datas_filtros_paginacao_e_ids_estaveis(env):
    reader, _, client = env
    listed = nodes(client)
    assert len(listed) == 5  # 2 memórias + 2 eventos skill + 1 compartilhada
    assert listed == sorted(listed, key=lambda n: (-n['data'], n['id']))
    skill = nodes(client, tipo='skill')
    assert [n['acao'] for n in skill] == ['mudou', 'criou']
    assert skill[0]['data'] == 1769940000
    pavan = nodes(client, agente='pavan', tipo='memoria')[0]
    assert pavan['data'] == 1772359200
    assert pavan['fonte_data'] == 'metadata.modified'
    assert nodes(client, agente='daniel')[0]['data'] == 1772360000
    assert nodes(client, agente='daniel')[0]['fonte_data'] == 'mtime'
    assert nodes(client, desde=1772360000, ate=1772360000)[0]['agente'] == 'daniel'
    assert nodes(client, agente='nao-existe') == []
    page = client.get('/api/aprendizado?limite=2').json()
    assert page['total'] == 5 and page['proximo_offset'] == 2
    assert nodes(client, offset=2, limite=2) == listed[2:4]
    assert client.get('/api/aprendizado?tipo=outro').status_code == 422
    assert client.get('/api/aprendizado?limite=501').status_code == 422
    assert client.get('/api/aprendizado?offset=-1').status_code == 422
    write(reader.memory_root, 'memory-pavan/nota.md', '# Novo texto\n')
    assert nodes(client, agente='pavan', tipo='memoria')[0]['id'] == pavan['id']


def test_conteudo_filtra_segredo_inclusive_metadados(env):
    reader, _, client = env
    node = nodes(client, agente='pavan', tipo='memoria')[0]
    response = client.get(f"/api/aprendizado/{node['id']}/conteudo")
    assert response.status_code == 200
    assert 'Texto inteiro' in response.json()['texto']
    assert 'nao-exibir' not in response.text
    write(reader.memory_root, 'memory-pavan/nota.md', '---\nname: "senha: oculta"\ndescription: "token: oculto"\n---\n# Visível\n')
    node = nodes(client, agente='pavan', tipo='memoria')[0]
    assert 'ocult' not in json.dumps(node)
    assert client.get('/api/aprendizado/inexistente/conteudo').status_code == 404


def test_exclui_antigas_arquivo_cofre_vault_e_alias_externo(env, tmp_path):
    reader, _, client = env
    for relative in ['memory-pavan/arquivo/velha.md', 'memory-pavan/nota.antiga-2026.md',
                     'memory-sobral.antiga-2026/velha.md']:
        write(reader.memory_root, relative, '# Não listar\n')
    for folder in ['cofre', 'vault', '.env-privado', 'arquivo']:
        write(reader.repo, f'pavan/.claude/skills/{folder}/SKILL.md', '# Não listar\n')
    outside = write(tmp_path, 'externo/SKILL.md', 'segredo')
    alias = reader.repo / 'pavan/.claude/skills/externo'
    alias.symlink_to(outside.parent)
    (reader.memory_root / 'memory-pavan/link.md').symlink_to(outside)
    assert len(nodes(client)) == 5


def test_deduplica_skill_alias_pelo_dono_canonico(env):
    reader, _, client = env
    folder = reader.repo / 'daniel/.claude/skills'
    folder.mkdir(parents=True)
    (folder / 'apelido').symlink_to(reader.repo / 'pavan/.claude/skills/rotina')
    assert len(nodes(client, tipo='skill')) == 2
    assert {n['agente'] for n in nodes(client, tipo='skill')} == {'pavan'}


def test_conteudo_limite_e_links(env, tmp_path):
    reader, _, client = env
    path = reader.memory_root / 'memory-pavan/nota.md'
    path.write_text('a' * (CONTENT_LIMIT + 1))
    node = nodes(client, agente='pavan', tipo='memoria')[0]
    assert client.get(f"/api/aprendizado/{node['id']}/conteudo").status_code == 413
    # Validação do leitor também é refeita depois da descoberta.
    asset = next(a for a in reader.scan()[1].values() if a.relative == 'memory-pavan/nota.md')
    path.unlink()
    path.symlink_to(write(tmp_path, 'fora.md', 'fora'))
    with pytest.raises(ValueError):
        reader.content(asset)


def test_sonho_so_marca_ids_aplicados_e_digest_atual(env):
    reader, _, client = env
    state = reader.dream_root / 'dream-pavan'
    round_id = '20261114T060003.205761Z'
    note = reader.memory_root / 'memory-pavan/nota.md'
    info = {'ids': [1], 'proposto_sha256': hashlib.sha256(note.read_bytes()).hexdigest()}
    manifesto = {'agente': 'pavan', 'arquivos': {'nota.md': info},
                 'propostas': [{'id': 1, 'gerados': ['nota.md']}]}
    write(state, f'propostas/{round_id}/manifesto.json', json.dumps(manifesto))
    assert nodes(client, tipo='memoria', agente='pavan')[0]['origem'] == 'agente'
    application = {'ids': [2], 'ts': '2026-11-14T07:00:00Z', 'novos': []}
    write(state, f'backup/{round_id}/aplicacao.json', json.dumps(application))
    assert nodes(client, tipo='memoria', agente='pavan')[0]['origem'] == 'agente'
    application['ids'] = [1]
    write(state, f'backup/{round_id}/aplicacao.json', json.dumps(application))
    node = nodes(client, tipo='memoria', agente='pavan')[0]
    assert node['origem'] == 'sonho' and node['fonte_data'] == 'sonho'
    assert node['data'] == 1794639600
    note.write_text('Mudou depois\n')
    assert nodes(client, tipo='memoria', agente='pavan')[0]['origem'] == 'agente'


def test_cache_inventario_mas_conteudo_sempre_fresco(env, monkeypatch):
    reader, _, client = env
    reader.cache_seconds = 60
    reader.invalidate()
    calls = []
    scan = reader.scan

    def measured():
        calls.append(1)
        return scan()

    monkeypatch.setattr(reader, 'scan', measured)
    node = nodes(client, agente='pavan', tipo='memoria')[0]
    write(reader.memory_root, 'memory-pavan/nota.md', '# Conteúdo novo\n')
    assert nodes(client, agente='pavan', tipo='memoria')[0] == node
    assert 'Conteúdo novo' in client.get(f"/api/aprendizado/{node['id']}/conteudo").json()['texto']
    assert len(calls) == 1
    reader.invalidate()
    assert nodes(client, agente='pavan', tipo='memoria')[0]['titulo'] == 'Conteúdo novo'
    assert len(calls) == 2
