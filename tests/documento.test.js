const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Modelo mínimo da árvore pública do DocumentApp, sem serviços Google em rede.
class Texto {
  constructor(p) { this.p = p; }
  getText() { return this.p.text; }
  getAttributes() { return {}; }
  getFontSize() { return 12; }
  getFontFamily() { return 'Arial'; }
  isBold() { return false; }
  setAttributes() { return this; }
  setFontSize() { return this; }
  setFontFamily() { return this; }
  setBold() { return this; }
  appendText(t) { this.p.text += t; return this; }
  insertText(i, t) { this.p.text = this.p.text.slice(0,i) + t + this.p.text.slice(i); return this; }
  deleteText(i,j) { this.p.text = this.p.text.slice(0,i) + this.p.text.slice(j+1); return this; }
  asText() { return this; }
  getType() { return 'TEXT'; }
  getParent() { return this.p; }
}
class Paragrafo {
  constructor(t) { this.text = t; }
  getType() { return 'PARAGRAPH'; }
  asParagraph() { return this; }
  getText() { return this.text; }
  setText(t) { this.text = t; return this; }
  clear() { this.text = ''; return this; }
  editAsText() { return new Texto(this); }
  appendText(t) { return this.editAsText().appendText(t); }
  copy() { return new Paragrafo(this.text); }
  getParent() { return this.parent; }
  getNumChildren() { return 1; }
  getChild() { return this.editAsText(); }
  removeFromParent() { this.parent.children.splice(this.parent.getChildIndex(this), 1); }
  setAlignment() { return this; }
}
class Container {
  constructor(children = []) { this.children = children.map(c => typeof c === 'string' ? new Paragrafo(c) : c); this.children.forEach(c => c.parent = this); }
  getNumChildren() { return this.children.length; }
  getChild(i) { return this.children[i]; }
  getChildIndex(c) { return this.children.indexOf(c); }
  getText() { return this.children.map(c => c.getText()).join('\n'); }
  insertParagraph(i,p) { p = typeof p === 'string' ? new Paragrafo(p) : p; this.children.splice(i,0,p); p.parent = this; return p; }
  appendParagraph(p) { return this.insertParagraph(this.children.length,p); }
  findText(padrao, anterior) {
    const achados=[];
    function visitar(container) {
      for(const e of container.children) {
        if(e instanceof Tabela) { visitar(e.celula); continue; }
        const re=new RegExp(padrao,'g'); let m;
        while((m=re.exec(e.text))) {
          const inicio=m.index, fim=inicio+m[0].length-1, indice=achados.length;
          achados.push({indice,getElement:()=>e.editAsText(),getStartOffset:()=>inicio,getEndOffsetInclusive:()=>fim});
        }
      }
    }
    visitar(this);
    return achados[anterior ? anterior.indice+1 : 0] || null;
  }
}
class Tabela {
  constructor(celula) { this.celula = celula; }
  getType() { return 'TABLE'; }
  asTable() { return this; }
  getNumRows() { return 1; }
  getRow() { return {getNumCells:()=>1, getCell:()=>this.celula}; }
  getText() { return this.celula.getText(); }
}
function carregar() {
  const ctx = { DocumentApp: {ElementType:{PARAGRAPH:'PARAGRAPH',LIST_ITEM:'LIST_ITEM',TABLE:'TABLE',TEXT:'TEXT'},HorizontalAlignment:{LEFT:'LEFT'}} };
  vm.createContext(ctx);
  for (const f of ['Regras.gs','Documento.gs']) vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',f),'utf8'),ctx);
  return ctx;
}

test('conduta substitui todas as linhas antigas e preserva a assinatura', () => {
  const c = carregar();
  const corpo = new Container(['CONDUTA: ALTA HOSPITALAR','MEDICAÇÃO ANTIGA','ASSINATURA MÉDICA: ____']);
  c.substituirBloco(corpo,c.BLOCOS.CONDUTA.inicio,c.BLOCOS.CONDUTA.parada,['Acompanhar evolução']);
  assert.doesNotMatch(corpo.getText(),/ALTA HOSPITALAR|MEDICAÇÃO ANTIGA/);
  assert.match(corpo.getText(),/Acompanhar evolução/);
  assert.match(corpo.getText(),/ASSINATURA MÉDICA/);
});

test('exame vazio remove achados antigos dentro de célula e alerta para preenchimento', () => {
  const c = carregar();
  const celula = new Container(['EXAME FÍSICO','HIDRATADO, AFEBRIL, GLASGOW 15','CONDUTA: ALTA HOSPITALAR']);
  const corpo = new Container([new Tabela(celula)]);
  const contexto = {avisos:[]};
  c.prepararBlocosClinicos(corpo);
  c.preencherBlocoClinico(corpo,'EXAME_FISICO','',contexto);
  assert.doesNotMatch(corpo.getText(),/HIDRATADO|GLASGOW/);
  assert.match(corpo.getText(),/SEM AVALIAÇÃO REGISTRADA/);
  assert.match(contexto.avisos.join(),/EXAME FÍSICO/);
});

test('bloco ausente é acrescentado e o texto digitado não se perde', () => {
  const c = carregar();
  const corpo = new Container(['Documento da puérpera']);
  c.preencherBlocoClinico(corpo,'CONDUTA','Texto 1\nTexto 2',{avisos:[]});
  assert.match(corpo.getText(),/CONDUTA/);
  assert.match(corpo.getText(),/Texto 1\nTexto 2/);
});

test('campos sem marcador são acrescentados com rótulo, inclusive nascimento', () => {
  const c = carregar();
  const corpo = new Container(['Documento da puérpera']);
  c.preencherCampoGarantido(corpo,'DATA_NASCIMENTO','19/10/2000',{avisos:[]});
  assert.match(corpo.getText(),/DATA DE NASCIMENTO: 19\/10\/2000/);
});

test('preparação retira achados obstétricos também em tabelas', () => {
  const c = carregar();
  const corpo = new Container([new Tabela(new Container(['Dilatação: 10 cm','BCF: 140','Idade Gestacional: 39+2']))]);
  c.limparObstetriciaDocumento(corpo);
  assert.doesNotMatch(corpo.getText(),/10 cm|140|39\+2/);
});

test('preparação de modelo não conserva evolução, HPP ou conduta antigos', () => {
  const c = carregar();
  const corpo = new Container(['RELATO DE INTERNAÇÃO: relato anterior HPP', 'HPP ANTIGA',
    'EVOLUÇÃO CLÍNICA: alta hospitalar', 'Texto antigo', 'EXAME FÍSICO', 'Afebril', 'CONDUTA: ALTA HOSPITALAR', 'Texto de conduta antiga', 'ASSINATURA MÉDICA: ___']);
  c.prepararBlocosClinicos(corpo);
  assert.doesNotMatch(corpo.getText(),/relato anterior|alta hospitalar|Texto antigo|Afebril|conduta antiga/i);
  assert.match(corpo.getText(),/\{\{HPP\}\}/);
  assert.match(corpo.getText(),/ASSINATURA/);
});

test('modelo feminino com título combinado após identificação não conserva exame antigo', () => {
  const c=carregar();
  const corpo=new Container(['DATA DE ADMISSÃO: {{DATA_ADMISSAO}} EVOLUÇÃO / EXAME FÍSICO',
    'BEG, CORADO, HIDRATADO, AFEBRIL','CONDUTA: ALTA HOSPITALAR','ASSINATURA MÉDICA: ____']);
  c.prepararBlocosClinicos(corpo);
  c.preencherBlocoClinico(corpo,'EXAME_FISICO','',{avisos:[]});
  assert.doesNotMatch(corpo.getText(),/HIDRATADO|AFEBRIL|ALTA HOSPITALAR/);
  assert.match(corpo.getText(),/\{\{DATA_ADMISSAO\}\}/);
  assert.match(corpo.getText(),/SEM AVALIAÇÃO REGISTRADA/);
});

test('subtítulos de exame e prescrição antigos são removidos junto ao bloco clínico', () => {
  const c=carregar();
  const corpo=new Container(['EXAME FÍSICO','Exame neurológico: Glasgow 15, sem déficit',
    'CONDUTA','Prescrição: DIPIRONA PADRÃO','ASSINATURA MÉDICA: ____']);
  c.prepararBlocosClinicos(corpo);
  assert.doesNotMatch(corpo.getText(),/Glasgow|DIPIRONA/);
});

test('rótulo digitado na evolução não é reinterpretado ao preencher a conduta', () => {
  const c=carregar();
  const corpo=new Container(['EVOLUÇÃO CLÍNICA: padrão','CONDUTA: ALTA HOSPITALAR','ASSINATURA MÉDICA: ____']);
  c.prepararBlocosClinicos(corpo);
  c.preencherBlocoClinico(corpo,'EVOLUCAO','Paciente estável\nCONDUTA: Reavaliar em 2 horas',{avisos:[]});
  c.preencherBlocoClinico(corpo,'CONDUTA','',{avisos:[]});
  assert.match(corpo.getText(),/CONDUTA: Reavaliar em 2 horas/);
  assert.doesNotMatch(corpo.getText(),/ALTA HOSPITALAR/);
});

test('preparação esvazia todos os itens da prescrição sem alterar o .docx original', () => {
  const c = carregar();
  c.PropertiesService = {getScriptProperties:()=>({})};
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/Setup.gs'),'utf8'),c);
  c.marcarCelulaNome=()=>{};
  c.trocarSimboloSeNecessario=()=>{};
  const item = new Container(['INSULINA PADRÃO']);
  const numero = new Container(['07']);
  const tabela = {getRow:()=>({getCell:n=>n === 0 ? numero : item})};
  c.linhasNumeradas=()=>[0];
  c.prepararTabelaPrescricao(tabela,false);
  assert.equal(item.getText(),'');
  assert.equal(numero.getText(),'01');
});

module.exports = {carregar, Container, Paragrafo, Tabela};
