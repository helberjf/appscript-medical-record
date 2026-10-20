const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('migração preserva IDs e não duplica perguntas ao executar novamente', () => {
  let proximoId=1;
  const campos=[];
  function novo(tipo,titulo='') {
    const item={id:proximoId++,tipo,titulo,getId(){return this.id;},getIndex(){return campos.indexOf(this);},
      asCheckboxItem(){return this;},asMultipleChoiceItem(){return this;},asParagraphTextItem(){return this;},asTextItem(){return this;},asDateItem(){return this;},asPageBreakItem(){return this;},
      setTitle(t){this.titulo=t;return this;},setHelpText(t){this.ajuda=t;return this;},setChoiceValues(v){this.opcoes=v;return this;},setRequired(v){this.obrigatorio=v;return this;},showOtherOption(){return this;},setIncludesYear(v){this.ano=v;return this;},setGoToPage(v){this.destino=v;return this;},setValidation(v){this.validacao=v;return this;}};
    campos.push(item); return item;
  }
  const mapa={};
  for(const chave of ['enfermaria','PEDIATRIA.remover','PEDIATRIA.adicionais','PEDIATRIA.dieta','PUERPERA.adicionais_rn','exame_fisico','conduta','solicitacao','data_nascimento','idade','peso','prontuario','alta.nome']) mapa[novo('ITEM',chave).id]=chave;
  novo('PAGE_BREAK');
  const idsOriginais=campos.map(x=>x.id);
  const props={FORM_ID:'form',FORM_ITENS:JSON.stringify(mapa)};
  const form={setDescription(t){this.descricao=t;},getItemById:id=>campos.find(x=>x.id===id),getItems:tipo=>tipo ? campos.filter(x=>x.tipo===tipo) : campos.slice(),
    addTextItem:()=>novo('TEXT'),addDateItem:()=>novo('DATE'),addTimeItem:()=>novo('TIME'),addParagraphTextItem:()=>novo('PARAGRAPH'),addCheckboxItem:()=>novo('CHECKBOX'),addPageBreakItem:()=>novo('PAGE_BREAK'),moveItem(de,para){const [item]=campos.splice(de,1);campos.splice(para,0,item);}};
  const c={PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k],setProperty:(k,v)=>props[k]=v})},
    FormApp:{createTextValidation:()=>{const v={};return {setHelpText(t){v.ajuda=t;return this;},requireTextMatchesPattern(p){v.padrao=p;return this;},build:()=>v};},openById:()=>form,ItemType:{PAGE_BREAK:'PAGE_BREAK'},PageNavigationType:{SUBMIT:'SUBMIT'}},console:{log(){}}};
  vm.createContext(c);
  for(const file of ['Regras.gs','Config.gs','Setup.gs']) vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),c);
  c.CONFIG.OPCOES_PRESCRICAO={PEDIATRIA:[{texto:'ITEM REVISADO',revisado:true},{texto:'NÃO REVISADO',revisado:false}]};
  c.atualizarFormulario();
  const total=campos.length;
  c.atualizarFormulario();
  assert.equal(campos.length,total);
  for(const id of idsOriginais) assert.ok(campos.find(x=>x.id===id));
  const removidos=campos.find(x=>x.id===Number(Object.keys(mapa).find(k=>mapa[k]==='PEDIATRIA.remover')));
  assert.equal(removidos.obrigatorio,false);
  assert.deepEqual(Array.from(removidos.opcoes),['Nenhum item padrão será incluído']);
  assert.doesNotMatch(form.descricao,/ficam como no modelo/);
  const mapaFinal=JSON.parse(props.FORM_ITENS);
  const idIndicacao=Number(Object.keys(mapaFinal).find(k=>mapaFinal[k]==='PUERPERA.indicacao_rn'));
  const idItensRn=Number(Object.keys(mapaFinal).find(k=>mapaFinal[k]==='PUERPERA.adicionais_rn'));
  assert.ok(campos.findIndex(x=>x.id===idIndicacao)<campos.findIndex(x=>x.id===idItensRn));
  const idIncluir=Number(Object.keys(mapaFinal).find(k=>mapaFinal[k]==='PEDIATRIA.incluir'));
  const incluir=campos.find(x=>x.id===idIncluir);
  assert.ok(incluir);
  assert.match(incluir.titulo,/incluir/i);
  assert.deepEqual(Array.from(incluir.opcoes),['ITEM REVISADO']);
  assert.equal(incluir.obrigatorio,false);
  // Data/hora do atendimento entram uma vez só, antes do prontuário.
  const indice=chave=>campos.findIndex(x=>x.id===Number(Object.keys(mapaFinal).find(k=>mapaFinal[k]===chave)));
  assert.ok(indice('data_atendimento')>=0 && indice('hora_atendimento')>=0);
  assert.ok(indice('data_atendimento')<indice('hora_atendimento') && indice('hora_atendimento')<indice('prontuario'));
  assert.equal(campos.filter(x=>x.tipo==='DATE').length,1);
  // Idade e peso validados no próprio Form, com a mesma regra do script.
  const porChave=chave=>campos[indice(chave)];
  const reIdade=new RegExp(porChave('idade').validacao.padrao), rePeso=new RegExp(porChave('peso').validacao.padrao);
  for(const ok of ['66','1 ano e 3 meses','15 dias']) assert.ok(reIdade.test(ok),ok);
  for(const ruim of ['RN','abc','']) assert.ok(!reIdade.test(ruim),ruim);
  assert.ok(rePeso.test('70,5') && !rePeso.test('70kg'));
  const historico=campos.find(x=>x.id===Number(props.FORM_SECAO_LEGADA));
  assert.equal(historico.destino,'SUBMIT');
  assert.ok(removidos.getIndex()>historico.getIndex());
});
