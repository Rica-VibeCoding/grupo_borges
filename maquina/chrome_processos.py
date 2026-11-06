"""Um Chrome de agente inclui os filhos que o launcher deixou em outro cgroup."""

import os


def agrupar_chromes(maquinas, scopes):
    from maquinas import ScopePorProcessos

    raizes = [s for s in scopes if maquinas.perfil(s.principal) is not None
              and maquinas.classificar(s, {}, scopes) == "agente"]
    if not raizes:
        return scopes
    processos = {p.pid: p for s in scopes for p in s.processos}
    # No Note os filhos ficam em session-N.scope, fora de user@UID.service.
    # O perfil sozinho não prova parentesco: só seguimos PPID + starttime.
    for pasta in maquinas.proc.iterdir():
        try:
            if pasta.name.isdecimal() and pasta.stat().st_uid == os.getuid():
                p = maquinas.processo(int(pasta.name))
                if p is not None:
                    processos[p.pid] = p
        except OSError:
            continue
    filhos = {}
    for p in processos.values():
        filhos.setdefault(p.ppid, []).append(p)
    donos, grupos = {}, {}
    for raiz in raizes:
        if processos.get(raiz.principal.pid) != raiz.principal:
            continue
        membros = {p.pid: p for p in raiz.processos}
        fila = list(raiz.processos)
        while fila:
            pai = fila.pop()
            for p in filhos.get(pai.pid, ()):
                if p.pid in membros or p.inicio < pai.inicio:
                    continue
                # Não captura outro navegador ou serviço que tenha sido lançado
                # como descendente. Crashpad reparentado fica sem dono comprovado.
                if (not p.args or p.args[0].rsplit('/', 1)[-1] not in {
                        "chrome", "google-chrome", "chromium", "chromium-browser"}
                        or maquinas.chrome(p)):
                    continue
                membros[p.pid] = p
                fila.append(p)
        if set(membros) == {p.pid for p in raiz.processos}:
            continue  # Cgroup já representa o browser inteiro.
        if any(pid in donos for pid in membros):
            continue
        grupos[raiz.id] = ScopePorProcessos(raiz.caminho, raiz.nome,
                                           tuple(membros[k] for k in sorted(membros)), raiz.principal)
        donos.update((pid, raiz.id) for pid in membros)
    resultado = []
    for s in scopes:
        if s.id in grupos:
            resultado.append(grupos[s.id])
            continue
        restantes = tuple(p for p in s.processos if p.pid not in donos)
        if not restantes:
            continue
        if len(restantes) == len(s.processos):
            resultado.append(s)
            continue
        pids = {p.pid for p in restantes}
        raizes_restantes = [p for p in restantes if p.ppid not in pids] or restantes
        resultado.append(ScopePorProcessos(s.caminho, s.nome, restantes,
                                          min(raizes_restantes, key=lambda p: (p.inicio, p.pid))))
    return resultado
