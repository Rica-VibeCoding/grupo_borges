from __future__ import annotations

import asyncio
import fcntl
import importlib.util
import stat
from pathlib import Path

import pytest
from test_aprendizado import env as env
from test_aprendizado import git, nodes, write

from services import aprendizado_poda as poda
from services.aprendizado import Aprendizado

SCRIPT = Path(__file__).resolve().parents[3] / 'scripts/faxina_executor.py'
spec = importlib.util.spec_from_file_location('aprendizado_faxina_executor', SCRIPT)
executor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(executor)


def delete(client, node):
    return client.post(f"/api/aprendizado/{node['id']}/apagar", json={'confirmar': True})


def undo(client, operation_id):
    return client.post(f'/api/aprendizado/podas/{operation_id}/desfazer', json={'confirmar': True})


def test_memoria_apagar_desfazer_persistente_preserva_modos_e_indice(env):
    reader, _, client = env
    node = nodes(client, agente='pavan', tipo='memoria')[0]
    source = Path(node['caminho'])
    original = source.read_bytes()
    index = source.parent / 'MEMORY.md'
    index.write_text('# Memórias\n- [Nota](nota.md)\n- [Outra](outra.md)\n')
    before = index.read_bytes()
    source.chmod(0o750)
    index.chmod(0o751)
    response = delete(client, node)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['status'] == 'arquivado'
    assert not source.exists()
    assert nodes(client, agente='pavan', tipo='memoria') == []
    archived = Path(result['arquivado_para'])
    assert archived.read_bytes() == original
    assert stat.S_IMODE(archived.stat().st_mode) == 0o750
    assert 'nota.md' not in index.read_text()
    assert 'outra.md' in index.read_text()
    assert stat.S_IMODE(index.stat().st_mode) == 0o751
    journal = reader.dream_root / 'aprendizado' / f"{result['operacao_id']}.json"
    assert stat.S_IMODE(journal.stat().st_mode) == 0o600
    assert not {'before', 'after', 'digest'} & result.keys()
    # Não depende de estado em RAM, inclusive depois de reiniciar API.
    client.app.state.aprendizado = Aprendizado(reader.memory_root, reader.repo, reader.dream_root, [])
    restored = undo(client, result['operacao_id'])
    assert restored.status_code == 200, restored.text
    assert restored.json()['status'] == 'restaurado'
    assert source.read_bytes() == original and index.read_bytes() == before
    assert stat.S_IMODE(source.stat().st_mode) == 0o750
    assert stat.S_IMODE(index.stat().st_mode) == 0o751
    assert undo(client, result['operacao_id']).json() == restored.json()


@pytest.mark.parametrize('body', [None, {}, {'confirmar': False}, {'confirmar': 1}, {'confirmar': 'true'}])
def test_confirmacao_explicita_em_todas_as_mutacoes(env, body):
    reader, db, client = env
    node = nodes(client, agente='pavan', tipo='memoria')[0]
    for route in [f"/{node['id']}/apagar", f"/{node['id']}/arquivar", '/podas/faxina-1/desfazer']:
        assert client.post('/api/aprendizado' + route, json=body).status_code == 422
    assert Path(node['caminho']).exists()
    assert not (reader.dream_root / 'aprendizado').exists()
    assert asyncio.run(db.list_faxina('todos'))['itens'] == []


def test_compartilhada_somente_leitura_e_sem_desvio_de_tipo(env):
    _, db, client = env
    shared = nodes(client, tipo='memoria_compartilhada')[0]
    assert client.get(f"/api/aprendizado/{shared['id']}/conteudo").status_code == 200
    assert delete(client, shared).status_code == 403
    assert client.post(f"/api/aprendizado/{shared['id']}/arquivar", json={'confirmar': True}).status_code == 403
    assert delete(client, nodes(client, tipo='skill')[0]).status_code == 403
    assert asyncio.run(db.list_faxina('todos'))['itens'] == []


def test_indice_com_varios_links_e_desfazer_preserva_edicao_externa(env):
    _, _, client = env
    node = nodes(client, agente='pavan', tipo='memoria')[0]
    index = Path(node['caminho']).parent / 'MEMORY.md'
    before = '- 🧠 [Nota](./nota.md#topo) · [Outra](outra.md) — lições\n'
    index.write_text(before)
    result = delete(client, node).json()
    assert index.read_text() == '- 🧠 [Outra](outra.md) — lições\n'
    with index.open('a') as out:
        out.write('- [Nova](nova.md)\n')
    restored = undo(client, result['operacao_id'])
    assert restored.status_code == 200, restored.text
    assert index.read_text() == before + '- [Nova](nova.md)\n'


def test_desfazer_linha_removida_preserva_acrescimo_ao_indice(env):
    _, _, client = env
    node = nodes(client, agente='pavan', tipo='memoria')[0]
    index = Path(node['caminho']).parent / 'MEMORY.md'
    before = '# Memórias\n- [Nota](nota.md)\n- [Outra](outra.md)\n'
    index.write_text(before)
    result = delete(client, node).json()
    with index.open('a') as out:
        out.write('- [Nova](nova.md)\n')
    assert undo(client, result['operacao_id']).status_code == 200
    assert index.read_text() == before + '- [Nova](nova.md)\n'


@pytest.mark.parametrize('collision', ['origem', 'indice', 'arquivo'])
def test_desfazer_recusa_sobrescrever_edicoes_externas(env, collision):
    _, _, client = env
    node = nodes(client, agente='pavan', tipo='memoria')[0]
    source = Path(node['caminho'])
    index = source.parent / 'MEMORY.md'
    index.write_text('- [Nota](nota.md) · [Outra](outra.md)\n')
    result = delete(client, node).json()
    archived = Path(result['arquivado_para'])
    if collision == 'origem':
        source.write_text('Memória nova')
    elif collision == 'indice':
        index.write_text('Outra edição no mesmo trecho\n')
    else:
        archived.write_text('Alteração externa no arquivo\n')
    current = index.read_bytes()
    assert undo(client, result['operacao_id']).status_code == 409
    assert archived.exists() and index.read_bytes() == current
    if collision == 'origem':
        assert source.read_text() == 'Memória nova'


@pytest.mark.parametrize('where', ['arquivo', 'indice', 'memoria'])
def test_poda_recusa_links_simbolicos_inclusive_depois_do_cache(env, tmp_path, where):
    reader, _, client = env
    reader.cache_seconds = 60
    reader.invalidate()
    node = nodes(client, agente='pavan', tipo='memoria')[0]
    source = Path(node['caminho'])
    outside = write(tmp_path, 'fora/arquivo.md', 'Conteúdo privado\n')
    target = {'arquivo': source.parent / 'arquivo', 'indice': source.parent / 'MEMORY.md', 'memoria': source}[where]
    if target.exists():
        target.unlink()
    target.symlink_to(outside.parent if where == 'arquivo' else outside)
    assert delete(client, node).status_code == 403
    assert outside.read_text() == 'Conteúdo privado\n'


def test_falha_mover_reverte_indice_e_preserva_memoria(env, monkeypatch):
    _, _, client = env
    node = nodes(client, agente='pavan', tipo='memoria')[0]
    source = Path(node['caminho'])
    index = source.parent / 'MEMORY.md'
    before = index.read_bytes()

    def failure(*args):
        raise OSError('falha simulada')

    monkeypatch.setattr(poda, 'move', failure)
    assert delete(client, node).status_code == 403
    assert source.exists() and index.read_bytes() == before


def test_trava_compartilhada_com_sonho_e_destino_ja_existente(env):
    reader, _, client = env
    node = nodes(client, agente='pavan', tipo='memoria')[0]
    lock = write(reader.dream_root, 'dream-pavan/lock', '')
    with lock.open('a') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        assert delete(client, node).status_code == 409
    write(reader.memory_root, 'memory-pavan/arquivo/nota.md', 'Não sobrescrever\n')
    assert delete(client, node).status_code == 409
    assert Path(node['caminho']).exists()


def test_skill_pedido_e_desfazer_usam_executor_faxina(env):
    reader, db, client = env
    node = nodes(client, tipo='skill')[0]
    url = f"/api/aprendizado/{node['id']}/arquivar"
    request = client.post(url, json={'confirmar': True})
    assert request.status_code == 200, request.text
    result = request.json()
    assert result['status'] == 'arquivar_pedido'
    item = result['faxina_item']
    assert client.post(url, json={'confirmar': True}).json() == result
    assert len(asyncio.run(db.list_faxina('todos'))['itens']) == 1
    folder = Path(node['caminho']).parent
    assert folder.exists()  # API não move; só executor move.
    assert undo(client, result['operacao_id']).status_code == 409
    archived = executor.run_once(db.db_path, reader.repo)[0]
    assert archived['status'] == 'arquivado', archived
    assert not folder.exists()
    assert (reader.repo / archived['arquivado_para'] / 'script.py').exists()
    assert undo(client, result['operacao_id']).json()['status'] == 'desfazer_pedido'
    assert undo(client, result['operacao_id']).status_code == 200
    assert executor.run_once(db.db_path, reader.repo)[0]['status'] == 'mantido'
    assert folder.is_dir()
    assert git(reader.repo, 'status', '--porcelain') == ''
    assert item['tipo'] == 'skill'


def test_skill_recente_e_mantida_pode_ser_podada_por_decisao_explicita(env):
    reader, db, client = env
    path = 'daniel/.claude/skills/recente/SKILL.md'
    write(reader.repo, path, '# Recente\n')
    git(reader.repo, 'add', '--', path)
    git(reader.repo, 'commit', '-qm', 'recente')
    node = nodes(client, agente='daniel', tipo='skill')[0]
    assert asyncio.run(db.create_faxina_item(caminho=str(Path(path).parent), workspace='daniel',
                                            tipo='skill', ultimo_commit=node['data'])) is None
    response = client.post(f"/api/aprendizado/{node['id']}/arquivar", json={'confirmar': True})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['faxina_item']['dias_parado'] == 0
    assert executor.run_once(db.db_path, reader.repo)[0]['status'] == 'arquivado'
    assert undo(client, result['operacao_id']).status_code == 200
    assert executor.run_once(db.db_path, reader.repo)[0]['status'] == 'mantido'
    again = client.post(f"/api/aprendizado/{node['id']}/arquivar", json={'confirmar': True})
    assert again.status_code == 200
    assert again.json()['operacao_id'] != result['operacao_id']


def test_skill_existente_pendente_e_citada_continua_bloqueada_pelo_executor(env):
    reader, db, client = env
    node = nodes(client, tipo='skill')[0]
    relative = str(Path(node['caminho']).parent.relative_to(reader.repo))
    item = asyncio.run(db.create_faxina_item(caminho=relative, workspace='pavan', tipo='skill',
                                            ultimo_commit=node['data']))
    write(reader.repo, 'pavan/README.md', f'[Rotina]({relative})\n')
    response = client.post(f"/api/aprendizado/{node['id']}/arquivar", json={'confirmar': True})
    assert response.status_code == 200
    assert response.json()['faxina_item']['id'] == item['id']
    failure = executor.run_once(db.db_path, reader.repo)[0]
    assert failure['status'] == 'erro' and 'citado em' in failure['erro']
    assert Path(node['caminho']).exists()
    assert client.post(f"/api/aprendizado/{node['id']}/arquivar", json={'confirmar': True}).status_code == 409


def test_undo_ids_travessia_e_inexistentes(env):
    _, _, client = env
    for operation in ['..%2Ffora', 'memoria-../x', 'memoria-123']:
        assert undo(client, operation).status_code in {403, 404}
    assert undo(client, 'memoria-' + 'a' * 32).status_code == 404
    assert undo(client, 'faxina-999').status_code == 404


def test_falha_gravar_resultado_reverte_arquivo_e_indice(env, monkeypatch):
    reader, _, client = env
    node = nodes(client, agente='pavan', tipo='memoria')[0]
    source = Path(node['caminho'])
    index = source.parent / 'MEMORY.md'
    before = index.read_bytes()
    save = poda.save

    def fail_final(reader, record):
        if record['status'] == 'arquivado':
            raise OSError('falha de persistência simulada')
        return save(reader, record)

    monkeypatch.setattr(poda, 'save', fail_final)
    assert delete(client, node).status_code == 403
    assert source.is_file() and index.read_bytes() == before
    assert not (source.parent / 'arquivo' / source.name).exists()


@pytest.mark.parametrize('link', ['[Nota](nota.md)', '[Nota](%6eota.md)', '[Nota](<./nota.md>)', '[[nota]]', '[[nota.md|Nota]]'])
def test_formatos_de_link_crlf_e_linha_sem_newline(env, link):
    _, _, client = env
    node = nodes(client, agente='pavan', tipo='memoria')[0]
    index = Path(node['caminho']).parent / 'MEMORY.md'
    before = f'# Memórias\r\n- {link}\r\n- [Outra](outra.md)'.encode()
    index.write_bytes(before)
    result = delete(client, node)
    assert result.status_code == 200, result.text
    assert index.read_bytes() == b'# Mem\xc3\xb3rias\r\n- [Outra](outra.md)'
    assert undo(client, result.json()['operacao_id']).status_code == 200
    assert index.read_bytes() == before


def test_formato_de_indice_desconhecido_e_indice_ausente_nao_movem(env):
    _, _, client = env
    node = nodes(client, agente='pavan', tipo='memoria')[0]
    source = Path(node['caminho'])
    index = source.parent / 'MEMORY.md'
    index.write_text('Referência fora do formato conhecido: nota.md\n')
    assert delete(client, node).status_code == 409
    assert source.is_file()
    index.unlink()
    assert delete(client, node).status_code == 404
    assert source.is_file()


def test_indice_utf8_invalido_nao_e_regravado(env):
    _, _, client = env
    node = nodes(client, agente='pavan', tipo='memoria')[0]
    source = Path(node['caminho'])
    index = source.parent / 'MEMORY.md'
    before = b'- [Nota](nota.md)\n\xff\n'
    index.write_bytes(before)
    assert delete(client, node).status_code == 409
    assert source.is_file() and index.read_bytes() == before


def test_desfazer_com_indice_ja_restaurado_nao_duplica_linha(env):
    _, _, client = env
    node = nodes(client, agente='pavan', tipo='memoria')[0]
    index = Path(node['caminho']).parent / 'MEMORY.md'
    before = index.read_text()
    result = delete(client, node).json()
    index.write_text(before)
    assert undo(client, result['operacao_id']).status_code == 200
    assert index.read_text() == before


def test_pedido_manual_nao_reaproveita_item_de_outro_tipo(env):
    _, db, client = env
    node = nodes(client, tipo='skill')[0]
    relative = 'pavan/.claude/skills/rotina'
    item = asyncio.run(db.create_faxina_item(caminho=relative, workspace='pavan', tipo='doc',
                                            ultimo_commit=node['data']))
    response = client.post(f"/api/aprendizado/{node['id']}/arquivar", json={'confirmar': True})
    assert response.status_code == 409
    assert asyncio.run(db.get_faxina_item(item['id']))['status'] == 'pendente'
