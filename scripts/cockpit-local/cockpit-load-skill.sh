#!/bin/bash
# Hook UserPromptSubmit: cockpit/terminal é o canal DEFAULT da sessão. Dispara
# o lembrete da skill `canal-cockpit` apenas na PRIMEIRA mensagem da sessão
# (ou pós-/clear). Marker file scoped por session_id evita ruído visual no
# cockpit (badge "Skill: canal-cockpit" toda msg) — a skill carrega 1× e o
# conteúdo fica no contexto. /clear muda session_id → marker novo → re-fire.
#
# Roda em todos os agentes (settings.json de cada workspace, menos miga). Sai
# silencioso (exit 0, stdout vazio) quando o prompt é remoto — outro hook cuida.
#
# Contrato (validado em https://code.claude.com/docs/en/hooks, 2026-05):
#   stdin:  JSON com `prompt`, `session_id`, `transcript_path`, …
#   stdout: {"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"..."}}
#   exit:   sempre 0 (exit 2 BLOQUEIA o turno e apaga o prompt — nunca queremos).

INPUT=$(cat)

SHOULD_FIRE=$(printf '%s' "$INPUT" | python3 -c "
import sys, json, re, os

try:
    d = json.load(sys.stdin)
    prompt = (d.get('prompt') or '').lstrip()
    transcript_path = d.get('transcript_path', '')
    session_id = d.get('session_id', '')

    # Match negativo: pula envelope plugin:telegram / plugin:whatsapp.
    # Whitespace inicial tolerado via lstrip. Anchor no início via re.match
    # evita falso-positivo de msg que cita literal 'plugin:telegram' no corpo.
    if re.match(r'<channel\s+source=\"plugin:(telegram|whatsapp)', prompt):
        sys.exit(0)

    # Tela de voz (prefixo 🗣, origem voz do /input): a resposta vira áudio. Vence a skill
    # do cockpit, que pede Markdown rico. 1ª fala da sessão carrega a skill; as outras só
    # lembram se uma compactação veio DEPOIS da última carga — senão o lembrete é ruído.
    if prompt.startswith('🗣'):
        voz = f'/tmp/voz-skill-loaded-{session_id}.flag'
        if session_id and os.path.exists(voz):
            # Linha a linha, pelo JSON: busca crua casa o próprio código citado na conversa.
            carregada = False
            try:
                with open(transcript_path) as f:
                    for linha in f:
                        try:
                            r = json.loads(linha)
                        except ValueError:
                            continue
                        if r.get('subtype') == 'compact_boundary':
                            carregada = False
                        c = (r.get('message') or {}).get('content')
                        if isinstance(c, list):
                            c = ' '.join(b.get('text', '') for b in c if isinstance(b, dict))
                        if isinstance(c, str) and c.startswith('Base directory for this skill:') and 'conversa-por-voz' in c[:200]:
                            carregada = True
                        # A skill colada pelo próprio gancho (ramo lembra) também conta como carregada.
                        anexo = r.get('attachment') or {}
                        if anexo.get('type') == 'hook_additional_context' and any(
                                'volta aqui inteira' in t for t in anexo.get('content') or [] if isinstance(t, str)):
                            carregada = True
            except OSError:
                pass
            if carregada:
                sys.exit(0)
            print('lembra', end='')
        else:
            if session_id:
                open(voz, 'a').close()
            print('voz', end='')
        sys.exit(0)

    # Sem session_id (versão antiga do CC?): mantém comportamento legado — dispara sempre.
    if not session_id:
        print('1', end='')
        sys.exit(0)

    marker = f'/tmp/cockpit-skill-loaded-{session_id}.flag'

    # Marker records a reminder, not a successful Skill call. A bare mention in
    # the transcript (or a failed invocation) must not suppress the real load.
    carregada = False
    if transcript_path and os.path.exists(transcript_path):
        try:
            with open(transcript_path) as f:
                for linha in f:
                    try:
                        r = json.loads(linha)
                    except ValueError:
                        continue
                    c = (r.get('message') or {}).get('content')
                    if isinstance(c, list):
                        c = ' '.join(b.get('text', '') for b in c if isinstance(b, dict))
                    if isinstance(c, str) and c.startswith('Base directory for this skill:') and 'canal-cockpit' in c[:200]:
                        carregada = True
        except OSError:
            pass
        if carregada:
            open(marker, 'a').close()
            sys.exit(0)
    elif os.path.exists(marker):
        # Older harnesses may omit transcript_path; keep their legacy behavior.
        sys.exit(0)

    # 1ª chamada legítima da sessão — cria marker e sinaliza disparo.
    open(marker, 'a').close()
    print('1', end='')
except Exception:
    pass
" 2>/dev/null)

case "$SHOULD_FIRE" in
  voz) REMINDER='Fala do Rica pela tela de voz do cockpit: sua resposta será LIDA EM VOZ ALTA. ANTES de responder, invoque a skill `conversa-por-voz` (Skill tool) e siga-a: curto, sem formatação, aviso antes de tarefa longa, o que é de ler vai pelo Telegram.' ;;
  # Compactou depois da carga: a skill saiu do contexto. Cola o texto dela (sem o cabeçalho YAML)
  # em vez de pedir para invocar de novo — o agente às vezes não invoca e responde como texto.
  lembra)
    SKILL="$HOME/.claude/skills/conversa-por-voz/SKILL.md"
    CORPO=$(awk 'NR==1 && /^---$/ {f=1; next} f && /^---$/ {f=0; next} !f' "$SKILL" 2>/dev/null)
    if [ -n "$CORPO" ]; then
      REMINDER="Fala da tela de voz (🗣): sua resposta será LIDA EM VOZ ALTA. A conversa compactou; a skill \`conversa-por-voz\` volta aqui inteira — siga-a:

$CORPO"
    else
      REMINDER='Fala da tela de voz (🗣): resposta falada, segundo a skill `conversa-por-voz` (invoque de novo se ela não estiver mais no contexto) — no máximo duas frases por turno, sem narrar andamento, detalhe pelo Telegram.'
    fi ;;
  1) REMINDER='' ;;
  *) exit 0 ;;
esac

[ -n "$REMINDER" ] || REMINDER='Mensagem recebida pelo cockpit do grupo_borges. ANTES de compor a resposta, invoque a skill `canal-cockpit` (Skill tool) para aplicar formato Markdown rico (GitHub alerts, code blocks pra copiar, hierarquia visual) e regras anti-verbosidade. Resposta sai pelo stdout normal (sem mcp__plugin_*__reply).'

python3 -c "
import json, sys
print(json.dumps({
    'hookSpecificOutput': {
        'hookEventName': 'UserPromptSubmit',
        'additionalContext': sys.argv[1]
    }
}))
" "$REMINDER"

exit 0
