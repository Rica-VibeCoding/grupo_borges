# Medição histórica do Cockpit V2

A bancada que usava as rotas app/spike foi encerrada quando a decisão do gate foi
tomada. As rotas foram removidas e o agente sintético canario não faz mais parte
da frota.

Os relatórios desta pasta são evidência histórica. Roteiros que apontam para
/spike, /spike/feed ou /spike/sem-lib não devem ser executados: uma medição nova
precisa de tarefa própria, rota explícita e régua atualizada.

O instrumento gate-probe.js continua em apps/cockpit/public apenas como
ferramenta de regressão, fora do pacote de produção.
