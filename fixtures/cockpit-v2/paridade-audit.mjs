import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = '/home/clawd/repos/grupo_borges';
const fixtureDir = path.join(repo, 'fixtures/cockpit-v2/familias');
const v1 = await import(pathToFileURL(path.join(repo, 'apps/web/lib/render-items.ts')));
const v2Module = process.env.V2_MODULE
  ? path.resolve(process.env.V2_MODULE)
  : path.join(repo, 'packages/cockpit-core/src/render-items.ts');
const v2 = await import(pathToFileURL(v2Module));

function grouping(item) {
  if (item.kind === 'sidechain-group') {
    return {
      kind: item.kind,
      rootUuid: item.rootUuid,
      count: item.count,
      parentUuids: item.parentUuids,
    };
  }
  if (item.kind === 'sidechain-cluster') {
    return {
      kind: item.kind,
      subagentCount: item.subagentCount,
      groups: item.groups.map((g) => ({
        rootUuid: g.rootUuid,
        parentUuids: g.parentUuids,
      })),
    };
  }
  return { kind: item.kind };
}

function observable(items) {
  return {
    count: items.length,
    kinds: items.map((item) => item.kind),
    grouping: items.map(grouping),
  };
}

const files = fs.readdirSync(fixtureDir)
  .filter((name) => name.endsWith('.json') && name !== '_indice.json')
  .sort();
const results = [];

for (const file of files) {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, file), 'utf8'));
  const messages = [fixture.evento];
  const out1 = v1.buildRenderItems(messages);
  const out2 = v2.buildRenderItems(messages);
  const obs1 = observable(out1);
  const obs2 = observable(out2);
  results.push({
    family: fixture.familia,
    file,
    equal: JSON.stringify(obs1) === JSON.stringify(obs2),
    v1: obs1,
    v2: obs2,
  });
}

const summary = {
  fixtureCount: files.length,
  equal: results.filter((r) => r.equal).length,
  divergent: results.filter((r) => !r.equal).length,
  requiredEdges: results.filter((r) =>
    r.family === 'borda__content_none' || r.family === 'borda__content_string'),
  results,
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
