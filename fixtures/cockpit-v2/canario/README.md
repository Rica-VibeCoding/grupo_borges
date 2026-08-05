# Casa do canário

Diretório existe só para dar ao canário um `workspace_path` **próprio**.

Não é capricho de organização: o `jsonl_watcher` monta
`{encoded_cwd(workspace_path): slug}` como dict (`jsonl_watcher.py:680`), então
**dois agentes com o mesmo `workspace_path` colidem na mesma chave e o último do
`agents.yaml` vence** — silenciosamente. Enquanto o canário apontou para
`/home/clawd/repos/grupo_borges`, ele sobrescreveu o Daniel (que passou a morar
lá no embed de 04/08) e **todo evento do Daniel era carimbado como `canario`**.
Foi o que o Rica viu em 05/08: mandava para o Daniel e lia no canário.

É subdiretório do próprio repo de propósito — o comentário original no
`agents.yaml` estava certo em dizer que caminho inexistente quebra rota que lê
git do workspace. De dentro daqui o git funciona igual, e o encoded-cwd fica
diferente.

Não apagar sem trocar o `workspace_path` do canário em `agents.yaml` primeiro.
