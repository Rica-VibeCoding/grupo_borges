// DS-71 round 9: encurta tool names estilo MCP pra chip ficar legível.
//
// CC chama tools de plugin MCP com prefixo enorme:
//   `mcp__plugin_telegram_telegram__reply`
//   `mcp__plugin_whatsapp-rica_whatsapp-rica__reply`
//   `mcp__github__get_pr`
//
// O chip em linha única corta o nome no meio (`Tool: mcp__plugin_telegram_…`)
// e o user não consegue identificar a tool. Esse helper reduz pra forma
// `server.tool` removendo o `mcp__plugin_` e dedupe de server name repetido.
//
// Tools nativas do CC (Bash, Edit, Read, …) NÃO são MCP — passam intactas.
export function prettifyToolName(name: string): string {
  if (!name.startsWith('mcp__')) return name;
  const parts = name.split('__');
  if (parts.length < 3) return name;
  const tool = parts[parts.length - 1];
  let server = parts[parts.length - 2];
  if (server.startsWith('plugin_')) server = server.slice('plugin_'.length);
  const subParts = server.split('_');
  // dedupe trailing: telegram_telegram → telegram
  if (subParts.length > 1 && subParts[subParts.length - 1] === subParts[subParts.length - 2]) {
    server = subParts.slice(0, -1).join('_');
  }
  return `${server}.${tool}`;
}
