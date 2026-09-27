"""Capturas da etapa 1 da fase 3: mosaico 3x2 dos estados em 393x852 e vídeo curto.

Uso: python capturar.py [moldura mostrador nucleo] [--video] [--sem-mosaico]
Chrome headless (canal 'chrome') com GPU via ANGLE/D3D11; sem GPU o WebGL não sobe no headless.
Cada HTML expõe window.__irPara(t) — relógio simulado —, então quadro e vídeo são determinísticos.
"""
import pathlib
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright

AQUI = pathlib.Path(__file__).resolve().parent
ESTADOS = [('preparando', 'preparando'), ('ouvindo', 'ouvindo'), ('esperandoZe', 'esperando o Zé'),
           ('falando', 'falando'), ('interrompendo', 'interrompendo'), ('erro', 'erro')]
TITULOS = {'moldura': 'Moldura — a borda da tela é o indicador',
           'mostrador': 'Mostrador — instrumento que mede a conversa',
           'nucleo': 'Núcleo — matéria viva que muda de forma'}
ARGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
DPR = 2
FFMPEG = next(pathlib.Path.home().glob('AppData/Local/ms-playwright/ffmpeg-*/ffmpeg-win64.exe'), None)


def fonte(tam, peso='regular'):
    nome = {'regular': 'segoeui.ttf', 'semibold': 'seguisb.ttf'}[peso]
    return ImageFont.truetype(f'C:/Windows/Fonts/{nome}', tam)


def quadros(browser, nome, pasta):
    ctx = browser.new_context(viewport={'width': 393, 'height': 852}, device_scale_factor=DPR)
    pg = ctx.new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    saida = []
    for estado, _ in ESTADOS:
        pg.goto((AQUI / f'{nome}.html').as_uri() + f'?estado={estado}&manual=1&painel=0')
        pg.wait_for_function('window.__pronto === true', timeout=20000)
        pg.evaluate('window.__irPara(window.__capturaPadrao)')
        pg.wait_for_timeout(350)
        arq = pasta / f'{nome}-{estado}.png'
        pg.screenshot(path=str(arq))
        saida.append(arq)
    ctx.close()
    if erros:
        raise RuntimeError(f'{nome}: erro na página: {erros}')
    return saida


def mosaico(nome, arquivos):
    w, h = 393 * DPR, 852 * DPR
    gut, topo, rot = 56, 190, 110
    W, H = 3 * w + 4 * gut, topo + 2 * (h + rot) + gut
    img = Image.new('RGB', (W, H), (14, 14, 14))
    d = ImageDraw.Draw(img)
    d.text((gut, 58), TITULOS[nome], font=fonte(64, 'semibold'), fill=(242, 242, 242))
    mascara = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mascara).rounded_rectangle((0, 0, w - 1, h - 1), radius=55 * DPR, fill=255)
    for i, (arq, (_, rotulo)) in enumerate(zip(arquivos, ESTADOS)):
        x = gut + (i % 3) * (w + gut)
        y = topo + (i // 3) * (h + rot)
        img.paste(Image.open(arq).convert('RGB'), (x, y), mascara)
        d.text((x + 8, y + h + 26), rotulo, font=fonte(52), fill=(177, 177, 177))
    destino = AQUI / f'{nome}.png'
    img.save(destino, optimize=True)
    return destino


def video(browser, nome, pasta, segundos=9.6, fps=30):
    ctx = browser.new_context(viewport={'width': 393, 'height': 852}, device_scale_factor=DPR)
    pg = ctx.new_page()
    pg.goto((AQUI / f'{nome}.html').as_uri() + '?roteiro=rapido&manual=1&painel=0')
    pg.wait_for_function('window.__pronto === true', timeout=20000)
    quadros_jpg = []
    for i in range(int(segundos * fps)):
        pg.evaluate(f'window.__irPara({i / fps})')
        quadros_jpg.append(pg.screenshot(type='jpeg', quality=95))
    ctx.close()
    destino = AQUI / f'{nome}.webm'
    # o ffmpeg que vem com o Playwright só decodifica MJPEG (image2pipe) e só codifica VP8
    fluxo = pasta / f'{nome}.mjpeg'
    fluxo.write_bytes(b''.join(quadros_jpg))
    r = subprocess.run([str(FFMPEG), '-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', str(fps), '-i', str(fluxo),
                        '-c:v', 'libvpx', '-b:v', '6M', '-qmin', '4', '-qmax', '30', str(destino)],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr[-1500:])
    return destino


def main():
    nomes = [a for a in sys.argv[1:] if not a.startswith('--')] or ['moldura', 'mostrador', 'nucleo']
    pasta = pathlib.Path(tempfile.mkdtemp(prefix='fase3-'))
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True, args=ARGS)
        for nome in nomes:
            if '--sem-mosaico' not in sys.argv:
                print(mosaico(nome, quadros(browser, nome, pasta)))
            if '--video' in sys.argv:
                print(video(browser, nome, pasta))
        browser.close()
    print('quadros soltos em', pasta)
    if '--limpar' in sys.argv:
        shutil.rmtree(pasta)


if __name__ == '__main__':
    main()
