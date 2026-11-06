"""Registro de turnos Claude por eventos Linux, sem sondar transcript ou terminal.

O registro é interno ao CC: só aceitamos PID + procStart exatos. Falha de
leitura/vigia vira desconhecido, nunca ociosidade deduzida de CPU baixa.
"""

import ctypes
import json
import os
from pathlib import Path
import struct
import threading


class RegistrosClaude:
    def __init__(self):
        self._trava = threading.RLock()
        self._pastas = {}
        self._dados = {}
        self._fd = None
        self._falhou = False

    def _ler(self, caminho):
        try:
            with caminho.open('rb') as f:
                dados = json.loads(f.read(65537))
            if not isinstance(dados, dict):
                raise ValueError('registro inválido')
        except (OSError, ValueError):
            dados = {}
        self._dados[caminho] = dados

    def _vigiar(self, pasta):
        if pasta in self._pastas.values():
            return
        if not pasta.is_dir():
            raise FileNotFoundError(pasta)
        libc = ctypes.CDLL(None, use_errno=True)
        if self._fd is None:
            self._fd = libc.inotify_init1(os.O_NONBLOCK | os.O_CLOEXEC)
            if self._fd < 0:
                self._fd = None
                raise OSError(ctypes.get_errno(), 'inotify_init1')
        # MODIFY invalida escrita parcial; CLOSE_WRITE/MOVED_TO recarregam.
        wd = libc.inotify_add_watch(self._fd, os.fsencode(pasta), 0x00000FCE)
        if wd < 0:
            raise OSError(ctypes.get_errno(), 'inotify_add_watch')
        self._pastas[wd] = pasta
        # Vigia antes do snapshot: uma escrita concorrente fica na fila.
        for caminho in pasta.glob('*.json'):
            self._ler(caminho)

    def _eventos(self):
        try:
            while True:
                with self._trava:
                    try:
                        bloco = os.read(self._fd, 65536)
                    except BlockingIOError:
                        return
                    pos = 0
                    while pos < len(bloco):
                        wd, mask, _, tamanho = struct.unpack_from('iIII', bloco, pos)
                        nome = os.fsdecode(bloco[pos + 16:pos + 16 + tamanho].split(b'\0', 1)[0])
                        pos += 16 + tamanho
                        if mask & (0x4000 | 0x8000 | 0x400 | 0x800):
                            # Overflow/remoção da pasta: cache deixou de ser prova.
                            self._falhou = True
                            self._dados.clear()
                            return
                        if wd in self._pastas and nome.endswith('.json'):
                            caminho = self._pastas[wd] / nome
                            if mask & (0x2 | 0x40 | 0x200):
                                self._dados.pop(caminho, None)
                            if mask & (0x8 | 0x80):
                                self._ler(caminho)
        except (OSError, ValueError):
            with self._trava:
                self._falhou = True
                self._dados.clear()

    def ler(self, config, processo):
        with self._trava:
            if self._falhou:
                return {}
            pasta = Path(config) / 'sessions'
            try:
                self._vigiar(pasta)
            except OSError:
                return {}
            self._eventos()
            dados = self._dados.get(pasta / f'{processo.pid}.json', {})
            if (dados.get('pid') != processo.pid
                    or str(dados.get('procStart')) != str(processo.inicio)):
                return {}
            return dados.copy()

    def __del__(self):
        if self._fd is not None:
            os.close(self._fd)
