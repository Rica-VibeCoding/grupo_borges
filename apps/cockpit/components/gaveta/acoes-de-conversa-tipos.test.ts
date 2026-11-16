import assert from 'node:assert/strict';
import { test } from 'node:test';
import ts from 'typescript';

test('trocaEmCurso estreita o estado da apresentação', () => {
  const arquivo = `${import.meta.dirname}/acoes-de-conversa.ts`;
  const programa = ts.createProgram([arquivo], { noEmit: true, noResolve: true, types: [] });
  const checker = programa.getTypeChecker();
  const fonte = programa.getSourceFile(arquivo)!;
  for (const nome of ['trocaEmCurso']) {
    const fn = fonte.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === nome)!;
    const assinatura = checker.getSignatureFromDeclaration(fn)!;
    assert.ok(checker.getTypePredicateOfSignature(assinatura));
  }
});
