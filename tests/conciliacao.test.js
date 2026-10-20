const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const c = {}; vm.createContext(c);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/Rastreio.gs'),'utf8'),c);

test('cinco respostas, dois registros e terceiro arquivo não viram conclusão de perda', () => {
  const respostas = [1,2,3,4,5].map(id=>({id:String(id)}));
  const docs = [1,2].map(id=>({url:'https://docs.google.com/document/d/doc'+id+'/edit'}));
  const arquivos = [1,2,3].map(id=>({id:'doc'+id,url:'https://docs.google.com/document/d/doc'+id+'/edit',respostaId:''}));
  const resultado = c.conciliarRegistros(respostas,docs,[],arquivos);
  assert.equal(resultado.filter(r=>r.estado === 'SEM_VINCULO_VERIFICAVEL').length,5);
  assert.equal(resultado.filter(r=>r.estado === 'ARQUIVO_SEM_REGISTRO').length,1);
  assert.doesNotMatch(JSON.stringify(resultado),/PERDIDA|RESPOSTA_PERDIDA/);
});

test('conciliação distingue sucesso, e-mail falho, resposta ignorada e arquivo parcial', () => {
  const tentativas = [
    {respostaId:'1',estado:'GERADO',url:'doc1'}, {respostaId:'1',estado:'EMAIL_FALHOU',url:'doc1'},
    {respostaId:'2',estado:'IGNORADA'}, {respostaId:'3',estado:'ERRO',url:'doc3'},
  ];
  const r = c.conciliarRegistros([{id:'1'},{id:'2'},{id:'3'}],[],tentativas,[]);
  assert.deepEqual(Array.from(r,x=>x.estado),['GERADO','IGNORADA','ARQUIVO_PARCIAL']);
});

test('links equivalentes usam o ID e registro sem arquivo é apontado sem concluir exclusão', () => {
  const r=c.conciliarRegistros([], [{url:'https://docs.google.com/document/d/doc1/edit?usp=sharing'},{url:'https://docs.google.com/document/d/doc2/edit'}], [],
    [{id:'doc1',url:'https://docs.google.com/document/d/doc1/edit',respostaId:''}]);
  assert.equal(r.length,1);
  assert.equal(r[0].estado,'NAO_LOCALIZADO_NO_ESCOPO');
  assert.match(r[0].url,/doc2/);
});

test('arquivo vinculado sem linha de auditoria é evidência a conferir', () => {
  const r = c.conciliarRegistros([{id:'1'}],[],[],[{id:'doc1',url:'doc1',respostaId:'1'}]);
  assert.equal(r[0].estado,'ARQUIVO_VINCULADO_SEM_CONCLUSAO');
});

test('URLs open?id retornadas pelo Apps Script são conciliadas pelo ID', () => {
  const r=c.conciliarRegistros([], [
    {url:'https://docs.google.com/open?id=doc1'},
    {url:'https://drive.google.com/open?usp=sharing&id=doc2'},
  ], [], [
    {id:'doc1',url:'https://docs.google.com/document/d/doc1/edit'},
    {id:'doc2',url:'https://docs.google.com/open?id=doc2'},
  ]);
  assert.equal(r.length,0);
});
