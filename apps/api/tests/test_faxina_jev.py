import json
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))
import faxina_jev as jev


@pytest.fixture(autouse=True)
def isolate_state(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path / "state"))


def item(path="tara/docs/antigo.md"):
    return {"caminho": path, "workspace": "tara", "tipo": "doc", "dias_parado": 30,
            "ultima_leitura": 1, "ultimo_commit": 1, "citado_em": []}


def report(destination="arquivar", motive="pesquisa_pontual", status="selected"):
    return {"decisions": {"d0_destino": {"status": status, "value": destination},
                          "d0_motivo": {"status": status, "value": motive}},
            "response": {"usage": {"cost": 0.00001}, "answers": {
                "d0_destino": {"probabilities": dict.fromkeys(["manter", "arquivar", "duplica", "incerto"], 0) | {destination: 0.9}},
                "d0_motivo": {"probabilities": dict.fromkeys(jev.MOTIVES, 0) | {motive: 0.9}},
            }}}


def test_duas_perguntas_independentes_e_so_metadados():
    payload = jev.request_for([item() | {"texto": "não transmitir", "segredo": "não transmitir"}])
    assert len(payload["questions"]) == 2
    assert all(q["type"] == "choice" for q in payload["questions"].values())
    assert "não transmitir" not in json.dumps(payload)
    assert "incerto" in payload["questions"]["d0_destino"]["criteria"]


def test_exit_2_preserva_documentos_com_parecer_seguro():
    result = jev.interpret([item()], report(), 2)[item()["caminho"]]
    assert result["jev_veredito"] == "arquivar"


@pytest.mark.parametrize("rc,status,value", [(0, "selected", "incerto")])
def test_abstencao_vira_null(rc, status, value):
    result = jev.interpret([item()], report(destination=value, status=status), rc)
    assert result[item()["caminho"]]["jev_veredito"] is None


def test_parecer_e_motivo_legivel():
    result = jev.interpret([item()], report(), 0)[item()["caminho"]]
    assert result == {"jev_veredito": "arquivar", "jev_probabilidade": 0.9,
                      "jev_motivo": "Pesquisa pontual", "jev_duplica_de": None}


def test_exibicao_preserva_probabilidade_sem_renormalizar():
    assert jev.displayed_choice({"probabilities": {"manter": 0.63, "incerto": 0.37, "arquivar": 0}},
                                {"manter", "arquivar", "duplica"}) == ("manter", 0.63)
    assert jev.displayed_choice({"probabilities": {"manter": 0.2, "arquivar": 0.01, "incerto": 0.79}},
                                {"manter", "arquivar", "duplica"}) == ("manter", 0.2)
    assert jev.displayed_choice({"probabilities": {"manter": 0.15, "arquivar": 0.02, "incerto": 0.83}},
                                {"manter", "arquivar", "duplica"}) == (None, None)


def test_chave_apenas_no_ambiente_do_subprocesso(monkeypatch, tmp_path):
    monkeypatch.setattr(jev, "openrouter_key", lambda: "segredo-ficticio")
    captured = []

    def run(args, **kwargs):
        captured.append((args, kwargs))
        return SimpleNamespace(returncode=0, stdout=json.dumps(report()), stderr="")

    monkeypatch.setattr(jev.subprocess, "run", run)
    verdicts, usage = jev.evaluate([item()], repo=tmp_path)
    assert verdicts[item()["caminho"]]["jev_veredito"] == "arquivar"
    assert usage == [{"cost": 0.00001}]
    args, kwargs = captured[0]
    assert kwargs["env"]["OPENROUTER_API_KEY"] == "segredo-ficticio"
    assert "segredo-ficticio" not in json.dumps(args) + kwargs["input"]
    assert "cabecalhos" not in kwargs["input"]


def test_http_402_interrompe_sem_repetir(monkeypatch, tmp_path):
    monkeypatch.setattr(jev, "openrouter_key", lambda: "ficticio")
    calls = []

    def run(*args, **kwargs):
        calls.append(1)
        return SimpleNamespace(returncode=1, stdout="", stderr="OpenRouter HTTP 402")

    monkeypatch.setattr(jev.subprocess, "run", run)
    with pytest.raises(RuntimeError, match="HTTP 402"):
        jev.evaluate([item()], repo=tmp_path)
    assert len(calls) == 1


def test_sem_candidatos_nao_abre_cofre(monkeypatch, tmp_path):
    def forbidden():
        raise AssertionError("não deve abrir cofre")

    monkeypatch.setattr(jev, "openrouter_key", forbidden)
    assert jev.evaluate([], repo=tmp_path) == ({}, [])


@pytest.mark.parametrize("secret", ["sk-exemplo", "sb_secret_ficticio", "token", "senha",
    "password", "api key", "Bearer", "a" * 32, "QWxhZGRpbjpvcGVuIHNlc2FtZVBhcmFUZXN0ZQ=="])
def test_linha_suspeita_removida_sem_descartar_resto(tmp_path, secret):
    path = tmp_path / item()["caminho"]
    path.parent.mkdir(parents=True)
    path.write_text("# Título\nProsa permitida\n## Seção\n" + secret)
    result = jev.excerpt(tmp_path, item())
    assert result["cabecalhos"] == ["# Título", "## Seção"]
    assert result["trecho"] == "Prosa permitida"
    assert secret not in json.dumps(result)


def test_titulo_cabecalhos_e_trecho_limitado(tmp_path):
    path = tmp_path / item()["caminho"]
    path.parent.mkdir(parents=True)
    path.write_text("# Título\nTexto autorizado. " * 200 + "\n## Seção\n### Subseção\n#### Detalhe")
    result = jev.excerpt(tmp_path, item())
    assert result["titulo"] == "# Título"
    assert len(result["trecho"]) == 1500
    assert "#### Detalhe" in result["cabecalhos"]


@pytest.mark.parametrize("path", ["ze-shared/vault/nota.md", "tara/docs/.env", "tara/docs/.env.local"])
def test_arquivo_proibido_nunca_entra_no_lote(tmp_path, monkeypatch, path):
    target = tmp_path / path
    target.parent.mkdir(parents=True)
    target.write_text("# Conteúdo que não pode sair")
    candidate = item(path)
    assert jev.excerpt(tmp_path, candidate) == {}

    def forbidden():
        raise AssertionError("nem deve abrir o cofre de autenticação")

    monkeypatch.setattr(jev, "openrouter_key", forbidden)
    assert jev.evaluate([candidate], repo=tmp_path) == ({}, [])


def test_modo_metadados_nao_le_documento(tmp_path, monkeypatch):
    import faxina_contexto as context
    monkeypatch.setattr(jev, "openrouter_key", lambda: "ficticio")

    def forbidden(*args):
        raise AssertionError("conteúdo não deve ser lido")

    monkeypatch.setattr(jev, "excerpt", forbidden)
    monkeypatch.setattr(context, "document", forbidden)
    monkeypatch.setattr(context, "active_skills", forbidden)
    monkeypatch.setattr(jev.subprocess, "run", lambda *args, **kwargs:
        SimpleNamespace(returncode=0, stdout=json.dumps(report()), stderr=""))
    assert jev.evaluate([item()], repo=tmp_path, include_content=False)[0]


def test_workspace_nao_e_termo_significativo(tmp_path):
    from faxina_contexto import enrich

    write(tmp_path, 'tara/docs/assunto.md', '# Tema específico')
    write(tmp_path, 'tara/.claude/skills/rotina/SKILL.md',
          '---\nname: rotina\ndescription: Procedimento da Tara\n---')
    signals = enrich(tmp_path, [item('tara/docs/assunto.md')], [], include_content=True)[0]['sinais']
    assert signals['skills_relacionadas'] == []


@pytest.fixture
def context_repo(tmp_path):
    import subprocess

    repo = tmp_path / 'repo'
    repo.mkdir()
    for args in [('init', '-b', 'main'), ('config', 'user.name', 'Teste'),
                 ('config', 'user.email', 'teste@example.invalid'),
                 ('config', 'core.hooksPath', str(tmp_path / 'hooks'))]:
        subprocess.run(['git', '-C', str(repo), *args], check=True, capture_output=True)
    return repo


def write(repo, path, text):
    file = repo / path
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(text)
    return file


def commit(repo, path='.'):
    import os
    import subprocess

    subprocess.run(['git', '-C', str(repo), 'add', '--', path], check=True)
    subprocess.run(['git', '-C', str(repo), 'commit', '-m', 'fixture'], check=True,
                   capture_output=True, env=os.environ | {
                       'GIT_AUTHOR_DATE': '2026-10-01T10:00:00+00:00',
                       'GIT_COMMITTER_DATE': '2026-10-01T10:00:00+00:00'})


def test_estado_vem_do_texto_inteiro_limita_e_filtra(tmp_path):
    from faxina_contexto import enrich

    write(tmp_path, item()['caminho'], '# Tema\n' + 'Prosa permitida.\n' * 120 +
          '\nSTATUS: IMPLEMENTADO\nEstado: senha secreta\n' +
          '\n'.join('Entregue: ' + 'x ' * 200 for _ in range(8)))
    result = enrich(tmp_path, [item()], [], include_content=True)[0]['sinais']
    assert result['linhas_estado'][0] == 'STATUS: IMPLEMENTADO'
    assert len(result['linhas_estado']) == 6
    assert max(map(len, result['linhas_estado'])) <= 240
    assert 'senha' not in json.dumps(result)
    assert 'IMPLEMENTADO' not in jev.excerpt(tmp_path, item())['trecho']


def test_citacoes_repo_inteiro_contagem_caminhos_e_exclusoes(context_repo):
    from faxina_contexto import citations

    repo = context_repo
    path = item()['caminho']
    write(repo, path, path)
    for index in range(7):
        write(repo, f'outro/scripts/uso-{index}.py', 'antigo.md')
    for forbidden in ['tara/arquivo/uso.md', 'ze-shared/vault/uso.md',
                      'tara/docs/.env.local', 'tara/cofre/uso.md', 'tara/docs/token.md']:
        write(repo, forbidden, path)
    commit(repo)
    assert citations(repo, item()) == {
        'contagem': 7, 'caminhos': [f'outro/scripts/uso-{i}.py' for i in range(5)]}


def test_skills_workspace_compartilhadas_aliases_descricao_e_estado(context_repo, tmp_path):
    from faxina_contexto import enrich

    repo = context_repo
    target = item('tara/docs/backups.md')
    write(repo, target['caminho'], '# Backups\nEstado: implementado')
    for index in range(7):
        write(repo, f'tara/.claude/skills/backups-{index}/SKILL.md',
              '---\nname: backups-' + str(index) + '\ndescription: >\n  Procedimento de backups\n  ' +
              'com cópia local. ' * 20 + '\n---\n')
    write(repo, 'ze-shared/.claude/skills/backups-compartilhados/SKILL.md',
          '---\nname: backups-compartilhados\ndescription: Backups reutilizáveis\n---')
    write(repo, 'outro/.claude/skills/backups-fora/SKILL.md',
          '---\nname: backups-fora\ndescription: Backups\n---')
    write(repo, 'tara/arquivo/.claude/skills/backups-morto/SKILL.md',
          '---\nname: backups-morto\ndescription: Backups\n---')
    outside = tmp_path / 'outside'
    outside.mkdir()
    (outside / 'SKILL.md').write_text('---\nname: backups-externo\ndescription: Backups\n---')
    (repo / 'tara/.claude/skills/backups-externo').symlink_to(outside, target_is_directory=True)
    (repo / 'tara/.claude/skills/alias').symlink_to(repo / 'tara/.claude/skills/backups-0', target_is_directory=True)
    write(repo, 'tara/.claude/skills/backups-segredo/SKILL.md',
          '---\nname: backups-segredo\ndescription: Backups ' + 'cópia ' * 40 + 'senha oculta\n---')
    commit(repo)
    skills = enrich(repo, [target], [], include_content=True)[0]['sinais']['skills_relacionadas']
    assert len(skills) == 5
    assert all(len(s['description']) <= 150 for s in skills)
    assert all('fora' not in s['nome'] and 'externo' not in s['nome'] and 'morto' not in s['nome'] for s in skills)
    # Consultar o catálogo sem o teto de cinco para verificar todos os filtros.
    from faxina_contexto import active_skills
    catalog = active_skills(repo, 'tara')
    assert sum(s['nome'] == 'backups-0' for s in catalog) == 1
    assert any(s['nome'] == 'backups-compartilhados' for s in catalog)
    assert next(s for s in catalog if s['nome'] == 'backups-segredo')['description'] == ''
    assert 'senha' not in json.dumps(catalog, default=list)


def test_pasta_usa_commit_irmao_e_cache(context_repo, monkeypatch):
    import os
    import subprocess
    import faxina_contexto as context

    repo = context_repo
    write(repo, item()['caminho'], '# Tema')
    commit(repo)
    write(repo, 'tara/docs/irmao.py', '# Vivo')
    subprocess.run(['git', '-C', str(repo), 'add', '--', 'tara/docs/irmao.py'], check=True)
    subprocess.run(['git', '-C', str(repo), 'commit', '-m', 'irmão'], check=True, capture_output=True,
                   env=os.environ | {'GIT_AUTHOR_DATE': '2026-11-01T10:00:00+00:00',
                                     'GIT_COMMITTER_DATE': '2026-11-01T10:00:00+00:00'})
    original = context.git_output
    calls = []

    def git(*args, **kwargs):
        if 'log' in args:
            calls.append(args)
        return original(*args, **kwargs)

    monkeypatch.setattr(context, 'git_output', git)
    results = context.enrich(repo, [item(), item('tara/docs/outro.md')], [], include_content=True)
    assert all(r['sinais']['ultimo_commit_pasta'] == '2026-11-01T10:00:00+00:00' for r in results)
    assert len(calls) == 1


def test_exemplos_mesma_pasta_sem_proprio_futuro_automatico_ou_segredo(tmp_path):
    from faxina_contexto import past_examples

    target = item() | {'id': 100, 'decidido_em': 3000000}
    def decision(index, path, **kwargs):
        return {'id': index, 'caminho': path, 'workspace': 'tara', 'status': 'mantido',
                'decidido_em': 2000000 + index, 'criado_em': 1,
                'jev_veredito': 'manter', 'jev_probabilidade': 0.9} | kwargs
    rows = [decision(i, f'tara/outro/{i}.md') for i in range(12)] + [
        decision(20, 'tara/docs/irmao.md'), decision(21, target['caminho']),
        decision(100, 'tara/docs/mesmo-id.md'),
        decision(22, 'tara/docs/futuro.md', decidido_em=3000001),
        decision(23, 'outro/docs/tema.md', workspace='outro'),
        decision(24, 'tara/docs/.env'), decision(25, 'tara/docs/segredo-token.md'),
        decision(26, 'tara/docs/automatico.md', status='arquivado', jev_veredito='arquivar'),
        decision(27, 'tara/docs/pendente.md', status='pendente'),
        decision(28, 'tara/docs/irmao.md')]
    examples = past_examples(tmp_path, target, rows)
    assert len(examples) == 8
    assert examples[0] == {'caminho': 'tara/docs/irmao.md', 'decisao': 'mantido'}
    assert all('outro/' in e['caminho'] for e in examples[1:])
    assert len({e['caminho'] for e in examples}) == 8


def test_limite_lote_reduz_sem_perder_sinais(tmp_path, monkeypatch):
    monkeypatch.setattr(jev, 'openrouter_key', lambda: 'ficticio')
    items = [item(f'tara/docs/tema-{i}.md') for i in range(10)]
    for candidate in items:
        write(tmp_path, candidate['caminho'], '# Tema\n' + 'Prosa. ' * 220 +
              '\n' + '\n'.join('Estado: ' + 'concluído ' * 25 for _ in range(6)))
    requests = []

    def run(*args, **kwargs):
        assert len(kwargs['input'].encode()) <= 24000
        requests.append(json.loads(kwargs['input']))
        return SimpleNamespace(returncode=0, stdout=json.dumps(report()), stderr='')

    monkeypatch.setattr(jev.subprocess, 'run', run)
    jev.evaluate(items, repo=tmp_path)
    assert len(requests) > 1
    records = [r for request in requests for r in request['state']['records'].values()]
    assert len(records) == 10
    assert all(len(r['sinais']['linhas_estado']) == 6 for r in records)
    assert all(len(r['conteudo']['trecho']) == 1500 for r in records)


def test_registro_grande_falha_antes_cofre_ou_api(tmp_path, monkeypatch):
    write(tmp_path, item()['caminho'], '# Título\n' + '## Seção permitida\n' * 2000)
    monkeypatch.setattr(jev, 'openrouter_key', lambda: pytest.fail('não pode abrir cofre'))
    with pytest.raises(ValueError, match='24 KB'):
        jev.evaluate([item()], repo=tmp_path)


def test_replay_nao_grava_logs_nem_expoe_status_alvo(tmp_path, monkeypatch):
    monkeypatch.setattr(jev, 'openrouter_key', lambda: 'ficticio')
    monkeypatch.setattr(jev, 'record_usage', lambda *a: pytest.fail('gravou uso'))
    monkeypatch.setattr(jev, 'record_decisions', lambda *a: pytest.fail('gravou decisões'))
    write(tmp_path, 'tara/arquivo/docs/antigo.md', '# Pesquisa\nEstado: concluído')
    target = item() | {'id': 99, 'status': 'arquivado', 'decidido_em': 1234,
                       'conteudo_caminho': 'tara/arquivo/docs/antigo.md'}

    def run(*args, **kwargs):
        record = json.loads(kwargs['input'])['state']['records'][target['caminho']]
        assert record['sinais']['linhas_estado'] == ['Estado: concluído']
        assert 'status' not in record and 'decidido_em' not in record and 'id' not in record
        assert record['sinais']['decisoes_rica'] == []
        return SimpleNamespace(returncode=0, stdout=json.dumps(report()), stderr='')

    monkeypatch.setattr(jev.subprocess, 'run', run)
    assert jev.evaluate([target], repo=tmp_path, log_results=False)[0]
    assert not (tmp_path / 'state').exists()


def test_ablacao_remove_so_decisoes_passadas_sem_ler_banco(tmp_path, monkeypatch):
    candidate = item() | {'id': 100, 'decidido_em': 3000}
    write(tmp_path, candidate['caminho'], '# Pesquisa\nEstado: concluído')
    decisions = [{'id': 1, 'caminho': 'tara/docs/irmao.md', 'workspace': 'tara',
                  'status': 'arquivado', 'decidido_em': 2000, 'criado_em': 1000,
                  'jev_veredito': 'manter', 'jev_probabilidade': 0.9}]
    monkeypatch.setattr(jev, 'openrouter_key', lambda: 'ficticio')
    monkeypatch.setattr(jev, 'read_decisions', lambda path: decisions)
    monkeypatch.setattr(jev, 'record_usage', lambda *a: pytest.fail('gravou uso'))
    monkeypatch.setattr(jev, 'record_decisions', lambda *a: pytest.fail('gravou decisões'))
    requests = []

    def run(*args, **kwargs):
        requests.append(json.loads(kwargs['input']))
        return SimpleNamespace(returncode=0, stdout=json.dumps(report()), stderr='')

    monkeypatch.setattr(jev.subprocess, 'run', run)
    jev.evaluate([candidate], repo=tmp_path, db_path=tmp_path / 'db', log_results=False)
    monkeypatch.setattr(jev, 'read_decisions', lambda *a: pytest.fail('leu exemplos desligados'))
    jev.evaluate([candidate], repo=tmp_path, db_path=tmp_path / 'db', log_results=False,
                 include_examples=False)
    signals = requests[0]['state']['records'][candidate['caminho']]['sinais']
    assert signals.pop('decisoes_rica') == [{'caminho': 'tara/docs/irmao.md', 'decisao': 'arquivado'}]
    assert requests[1]['state']['records'][candidate['caminho']]['sinais'].pop('decisoes_rica') == []
    assert signals['linhas_estado'] == ['Estado: concluído']
    # Mesmos critérios, conteúdo e sinais: só os exemplos mudam.
    assert requests[0] == requests[1]
