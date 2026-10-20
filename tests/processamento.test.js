const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function ambiente(opcoes = {}) {
  const abas = {};
  const planilha = {getSheetByName:n=>abas[n] || null, insertSheet:n=>abas[n] = {linhas:[], appendRow(row) {this.linhas.push(row);},getDataRange(){return {getValues:()=>this.linhas};}}};
  const props = {PLANILHA_ID:'planilha', MODELOS_VERSAO:'2'};
  const resposta = {getId:()=> 'resposta-1',getRespondentEmail:()=>opcoes.email || 'medico@example.com',getTimestamp:()=>new Date('2026-10-20T12:00:00Z')};
  const ctx = {PROPS:{getProperty:k=>props[k]}, CONFIG:{ALLOWED_EMAILS:['medico@example.com'],ENFERMARIAS:[{opcao:'Pediatria',modelo:'PEDIATRIA'}],ENVIAR_EMAIL:!!opcoes.falhaEmail},
    SpreadsheetApp:{openById:()=>planilha}, Utilities:{formatDate:(_d,_f,p)=>p==='HH:mm'?'09:00':'20/10/2026'},
    Session:{getEffectiveUser:()=>({getEmail:()=> 'dono@example.com'})},MailApp:{sendEmail:()=>{throw Error('Falha SMTP');}},console:{error(){},warn(){}}};
  vm.createContext(ctx);
  for(const f of ['Regras.gs','Preencher.gs','Rastreio.gs']) {
    const file = path.join(__dirname,'../src',f);
    if(fs.existsSync(file)) vm.runInContext(fs.readFileSync(file,'utf8'),ctx);
  }
  ctx.lerRespostas=()=>({enfermaria:'Pediatria',nome:'PACIENTE TESTE',...opcoes.respostas});
  let geracoes=0;
  ctx.gerarProntuario=(_e,_r,c)=>{geracoes++; c.documentoId='doc-1'; c.documentoUrl='https://docs.google.com/document/d/doc-1/edit'; if(opcoes.falhaGeracao)throw Error('Falha após a cópia');return {nome:'PACIENTE TESTE',url:c.documentoUrl};};
  return {ctx,resposta,props,abas,get geracoes(){return geracoes;}};
}

test('gera registro rastreável por resposta e cria a aba de documentos se ela faltar', () => {
  const a = ambiente(); a.ctx.processarResposta(a.resposta);
  assert.equal(a.abas['Documentos gerados'].linhas.length,2);
  assert.match(JSON.stringify(a.abas.Processamento.linhas),/resposta-1/);
  assert.match(JSON.stringify(a.abas.Processamento.linhas),/GERADO/);
});

test('não cria documento se não for possível registrar a tentativa', () => {
  const a = ambiente(); delete a.props.PLANILHA_ID;
  assert.throws(()=>a.ctx.processarResposta(a.resposta),/planilha/i);
  assert.equal(a.geracoes,0);
});

test('dados inválidos ficam no histórico e impedem geração', () => {
  const a = ambiente({respostas:{data_admissao:'1900-01-01'}});
  assert.throws(()=>a.ctx.processarResposta(a.resposta),/admissão/);
  assert.equal(a.geracoes,0);
  assert.match(JSON.stringify(a.abas.Processamento.linhas),/ERRO/);
});

test('resposta não autorizada também fica rastreável', () => {
  const a = ambiente({email:'fora@example.com'}); a.ctx.processarResposta(a.resposta);
  assert.equal(a.geracoes,0);
  assert.match(JSON.stringify(a.abas.Processamento.linhas),/IGNORADA/);
});

test('erro após criar arquivo conserva o ID do documento no registro', () => {
  const a = ambiente({falhaGeracao:true});
  assert.throws(()=>a.ctx.processarResposta(a.resposta),/após a cópia/);
  const ultimo = a.abas.Processamento.linhas.at(-1);
  assert.match(JSON.stringify(ultimo),/ERRO/);
  assert.match(JSON.stringify(ultimo),/doc-1/);
});

test('falha de e-mail não transforma documento gerado em falha de geração', () => {
  const a = ambiente({falhaEmail:true});
  assert.doesNotThrow(()=>a.ctx.processarResposta(a.resposta));
  assert.match(JSON.stringify(a.abas.Processamento.linhas),/GERADO/);
  assert.match(JSON.stringify(a.abas.Processamento.linhas),/EMAIL_FALHOU/);
});

test('modelo antigo impede geração até recriação segura', () => {
  const a = ambiente(); delete a.props.MODELOS_VERSAO;
  assert.throws(()=>a.ctx.processarResposta(a.resposta),/recriarModelosDoFormulario/);
  assert.equal(a.geracoes,0);
});

test('geração avulsa sem ID rastreável é bloqueada antes de criar pastas', () => {
  const a = ambiente();
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/Preencher.gs'),'utf8'),a.ctx);
  let pastas = 0;
  a.ctx.pastaDaEnfermaria=()=>{pastas++; throw Error('Não deveria criar pasta');};
  assert.throws(()=>a.ctx.gerarProntuario({modelo:'PEDIATRIA'},{nome:'TESTE'},{hoje:'20/10/2026',avisos:[]}),/rastre|resposta/i);
  assert.throws(()=>a.ctx.gerarReceitaAlta({}, {'alta.nome':'TESTE'}, {hoje:'20/10/2026',avisos:[]}),/rastre|resposta/i);
  assert.equal(pastas,0);
});

test('itens selecionados chegam à montagem usada por mãe, RN e receita de alta', () => {
  const a=ambiente();
  a.ctx.CONFIG.OPCOES_PRESCRICAO={PUERPERA:[{texto:'ITEM MÃE',revisado:true}],RN:[{texto:'ITEM RN',revisado:true}],ALTA_PUERPERA:[{texto:'ITEM ALTA',revisado:true}]};
  const r={'PUERPERA.incluir':['ITEM MÃE'],'PUERPERA.incluir_rn':['ITEM RN'],'alta.incluir':['ITEM ALTA'],'PUERPERA.remover':['OPÇÃO ANTIGA']};
  assert.deepEqual(Array.from(a.ctx.prescricaoDaResposta(r,'PUERPERA'),e=>e.texto),['ITEM MÃE']);
  assert.deepEqual(Array.from(a.ctx.prescricaoDaResposta(r,'RN'),e=>e.texto),['ITEM RN']);
  assert.deepEqual(Array.from(a.ctx.prescricaoDaResposta(r,'ALTA_PUERPERA'),e=>e.texto),['ITEM ALTA']);
});
