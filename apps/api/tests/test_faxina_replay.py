import json
from pathlib import Path
import sqlite3
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'scripts'))
import faxina_contexto as context
import faxina_replay as replay


@pytest.fixture
def history(tmp_path):
    db = tmp_path / 'history.db'
    with sqlite3.connect(db) as conn:
        conn.execute('''CREATE TABLE faxina_item (
            id INTEGER PRIMARY KEY, caminho TEXT, workspace TEXT, tipo TEXT,
            status TEXT, decidido_em INTEGER, criado_em INTEGER, jev_veredito TEXT,
            jev_probabilidade REAL, citado_em TEXT, arquivado_para TEXT,
            ultima_leitura INTEGER, ultimo_commit INTEGER, dias_parado INTEGER)''')
        rows = [
            (1, 'tara/docs/antigo.md', 'mantido', 1794060000, 'manter', None),
            (2, 'tara/docs/pesquisa.md', 'arquivado', 1794060001, 'manter', 'tara/arquivo/docs/pesquisa.md'),
            (3, 'tara/docs/automatico.md', 'arquivado', 1794060002, 'arquivar', None),
            (4, 'tara/docs/antes.md', 'mantido', 1794000000, 'manter', None),
            (5, 'tara/docs/.env.local', 'mantido', 1794060003, None, None),
        ]
        for id_, path, status, stamp, verdict, archived in rows:
            conn.execute('INSERT INTO faxina_item VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                         (id_, path, 'tara', 'doc', status, stamp, 1792000000,
                          verdict, 0.9, '[]', archived, 1790000000, 1790000000, 0))
    return db


def test_historico_ro_filtra_automaticos_sem_criar_banco(history, tmp_path):
    before = history.read_bytes()
    rows = context.read_decisions(history)
    assert {r['id'] for r in rows} == {1, 2, 4, 5}
    assert history.read_bytes() == before
    missing = tmp_path / 'ausente.db'
    with pytest.raises(sqlite3.OperationalError):
        context.read_decisions(missing)
    assert not missing.exists()


@pytest.mark.parametrize('sem_exemplos', [False, True])
def test_replay_compara_mesmos_cartoes_sem_gravar_e_sem_vazar(history, tmp_path, monkeypatch, capsys,
                                                           sem_exemplos):
    import faxina_jev as jev
    before = history.read_bytes()
    (tmp_path / 'tara/arquivo/docs').mkdir(parents=True)
    (tmp_path / 'tara/arquivo/docs/pesquisa.md').write_text('# Pesquisa\nEstado: implementado')
    state = tmp_path / 'state'
    monkeypatch.setenv('XDG_STATE_HOME', str(state))
    monkeypatch.setattr(jev, 'openrouter_key', lambda: 'ficticio')
    payloads = []

    def run(*args, **kwargs):
        from types import SimpleNamespace
        payload = json.loads(kwargs['input'])
        payloads.append(payload)
        answers = {}
        for index, (path, record) in enumerate(payload['state']['records'].items()):
            assert all(example['caminho'] != path for example in record['sinais']['decisoes_rica'])
            answers[f'd{index}_destino'] = {'probabilities': {
                'manter' if path.endswith('antigo.md') else 'arquivar': 0.9}}
        return SimpleNamespace(returncode=0, stdout=json.dumps({'response': {'answers': answers}}), stderr='')

    monkeypatch.setattr(jev.subprocess, 'run', run)
    monkeypatch.setattr(sys, 'argv', ['faxina_replay.py', '--db', str(history), '--repo', str(tmp_path)] +
                        (['--sem-exemplos'] if sem_exemplos else []))
    replay.main()
    result = json.loads(capsys.readouterr().out)
    assert result['antes']['acertos'] == 1
    assert result['depois']['acertos'] == result['depois']['total'] == 2
    assert result['excluidos_seguranca'] == 1
    assert result['exemplos_habilitados'] is not sem_exemplos
    assert result['cartoes'] == [
        {'id': 2, 'caminho': 'tara/docs/pesquisa.md', 'rica': 'arquivado'},
        {'id': 1, 'caminho': 'tara/docs/antigo.md', 'rica': 'mantido'}]
    assert result['erros'] == []
    assert result['depois']['matriz_rica_por_jev']['arquivado']['arquivar'] == 1
    assert result['depois']['matriz_rica_por_jev']['mantido']['manter'] == 1
    assert history.read_bytes() == before
    assert not state.exists()
    assert len(payloads) == 1
    records = payloads[0]['state']['records']
    assert records['tara/docs/pesquisa.md']['sinais']['linhas_estado'] == ['Estado: implementado']
    assert 'automatico' not in json.dumps(records)
    assert ('antigo.md' in json.dumps(records['tara/docs/pesquisa.md']['sinais']['decisoes_rica'])) is not sem_exemplos
    assert 'pesquisa.md' not in json.dumps(records['tara/docs/antigo.md']['sinais']['decisoes_rica'])
    assert records['tara/docs/antigo.md']['dias_parado'] > 20


def test_divergencias_incluem_abstencao_sem_inventar_diagnostico():
    items = [{'id': i, 'caminho': str(i), 'status': 'arquivado' if i == 1 else 'mantido'}
             for i in range(3)]
    verdicts = {'0': {'jev_veredito': 'manter'},
                '1': {'jev_veredito': 'manter', 'jev_probabilidade': 0.7,
                      'jev_motivo': 'Referência perene'}}
    assert replay.disagreements(items, verdicts) == [
        {'id': 1, 'caminho': '1', 'rica': 'arquivar', **verdicts['1']},
        {'id': 2, 'caminho': '2', 'rica': 'manter'}]


def test_matriz_conta_abstencoes_e_duplicacoes():
    items = [{'caminho': str(i), 'status': 'arquivado' if i < 2 else 'mantido'} for i in range(4)]
    result = replay.agreement(items, {'0': {'jev_veredito': 'arquivar'}, '1': {'jev_veredito': 'duplica'},
                                      '2': {'jev_veredito': 'manter'}})
    assert result['acertos'] == 2 and result['percentual'] == 50
    assert result['matriz_rica_por_jev']['arquivado']['duplica'] == 1
    assert result['matriz_rica_por_jev']['mantido']['sem_parecer'] == 1


def test_conteudo_arquivado_caminho_longo_com_filtros_preservados(tmp_path):
    original = 'tara/docs/oficina/pesquisa-video/roteiro.md'
    archived = 'tara/arquivo/docs/oficina/pesquisa-video/roteiro.md'
    file = tmp_path / archived
    file.parent.mkdir(parents=True)
    file.write_text('# Pesquisa\nEstado: concluído\nEstado: senha oculta')
    target = {'caminho': original, 'conteudo_caminho': archived, 'tipo': 'doc', 'workspace': 'tara'}
    assert context.SECRET.search(archived)  # Falso positivo em base64 só no endereço local.
    signals = context.enrich(tmp_path, [target], [], include_content=True)[0]['sinais']
    assert signals['linhas_estado'] == ['Estado: concluído']
    target['conteudo_caminho'] = 'ze-shared/vault/nota.md'
    assert context.document(tmp_path, target) == ''
