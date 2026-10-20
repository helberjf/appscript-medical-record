const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function ambiente(falhar=false) {
  const props={FORM_ID:'form'}; let aberto=true;
  const chamadas=[];
  const form={isAcceptingResponses:()=>aberto,setAcceptingResponses:v=>{aberto=v;},getPublishedUrl:()=> 'https://form.example',getResponses:()=>[1,2,3,4,5]};
  const c={PROPS:{getProperty:k=>props[k] === undefined ? null : props[k],setProperty:(k,v)=>props[k]=v,deleteProperty:k=>delete props[k]},
    FormApp:{openById:()=>form},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},CONFIG:{MODO_TESTE:true},console:{log(){}},
    recriarModelosDoFormulario:()=>{chamadas.push('modelos');if(falhar)throw Error('Falha de conversão');props.MODELOS_VERSAO='2';},
    atualizarFormulario:()=>chamadas.push('formulario'),verificarAtualizacaoOnline:()=>chamadas.push('verificar')};
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/Atualizacao.gs'),'utf8'),c);
  // A validação dos modelos é exercida pelos testes de documento; aqui, o ciclo de publicação.
  c.verificarAtualizacaoOnline=()=>chamadas.push('verificar');
  return {c,props,chamadas,get aberto(){return aberto;}};
}
test('atualização pausa envios, preserva respostas e restaura estado após validar',()=>{
  const a=ambiente();a.c.prepararAtualizacaoOnline();assert.equal(a.aberto,false);
  a.c.atualizarVersaoOnline();assert.equal(a.aberto,true);
  assert.deepEqual(a.chamadas,['modelos','formulario','verificar']);
  assert.equal(a.props.RESPOSTAS_ANTES_ATUALIZACAO,'5');
});
test('falha na atualização mantém formulário pausado para reparar antes de reabrir',()=>{
  const a=ambiente(true);a.c.prepararAtualizacaoOnline();
  assert.throws(()=>a.c.atualizarVersaoOnline(),/conversão/);assert.equal(a.aberto,false);
});
test('migração em etapas salva cada modelo e só reabre depois do último',()=>{
  const a=ambiente();a.c.CONFIG.MODELOS={A:{},B:{}};
  a.c.DriveApp={getFolderById:()=>({})};a.c.obterOuCriarPasta=()=>({});a.c.formatar=()=> 'carimbo';
  a.c.lerJsonPropriedade=(k,d)=>a.props[k] ? JSON.parse(a.props[k]) : d;
  a.c.criarModeloSeguro=k=>{a.chamadas.push(k);return {id:'id-'+k,relatorio:{chave:k}};};
  a.c.escreverRelatorio=()=> 'relatorio';
  a.c.migrarProximoModeloOnline();assert.equal(a.aberto,false);assert.deepEqual(a.chamadas,['A']);
  a.c.migrarProximoModeloOnline();assert.equal(a.aberto,true);assert.deepEqual(a.chamadas,['A','B','formulario','verificar']);
  assert.equal(JSON.parse(a.props.MODELOS).B,'id-B');
  a.c.migrarProximoModeloOnline();assert.equal(a.aberto,true);assert.equal(a.chamadas.filter(x=>x==='A').length,1);
});
