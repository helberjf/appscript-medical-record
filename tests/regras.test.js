// Testa as regras puras do Apps Script fora do Google: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'Regras.gs'), 'utf8'), ctx);

const marcar = (texto, sufixo) => ctx.marcarTexto(texto, sufixo).texto;

test('cabeçalho da tabela: rótulo do modelo fica, só o valor vira marcador', () => {
  assert.equal(marcar('Prontuário:  '), 'Prontuário:  {{PRONTUARIO}}');
  assert.equal(marcar('Registro:'), 'Registro: {{REGISTRO}}');
  assert.equal(marcar('HORA:  '), 'HORA:  {{HORA}}');
  assert.equal(marcar('ENFERMARIA: PSIQUIÁTRICA'), 'ENFERMARIA: {{ENFERMARIA}}');
  assert.equal(marcar('LEITO: 32'), 'LEITO: {{LEITO}}');
  assert.equal(marcar('IDADE: 96'), 'IDADE: {{IDADE}}');
  assert.equal(marcar('IDAde'), 'IDADE: {{IDADE}}');
  assert.equal(marcar('PESO: Kg'), 'PESO: {{PESO}} Kg');
  assert.equal(marcar('PESO:  '), 'PESO:  {{PESO}} Kg');
});

test('data do cabeçalho fica só com a data, como os médicos preenchem ("19/10/26")', () => {
  assert.equal(marcar('DATA: 17/10/2026'), '{{DATA_CABECALHO}}');
  assert.equal(marcar('DATA:'), '{{DATA_CABECALHO}}');
});

test('as edições começam depois do rótulo (não reescrevem o rótulo)', () => {
  const r = ctx.marcarTexto('HPP :  PREVIAMENTE HÍGIDO');
  assert.deepEqual(JSON.parse(JSON.stringify(r.edicoes)), [{ inicio: 7, fim: 25, texto: '{{HPP}}' }]);
  const nome = ctx.marcarTexto('-NOME:');
  assert.deepEqual(JSON.parse(JSON.stringify(nome.edicoes)), [{ inicio: 6, fim: 6, texto: ' {{NOME}}' }]);
});

test('tabela do RN usa sufixo próprio', () => {
  assert.equal(marcar('IDADE: 96', '_RN'), 'IDADE: {{IDADE_RN}}');
  assert.equal(marcar('Prontuário:', '_RN'), 'Prontuário: {{PRONTUARIO_RN}}');
});

test('variações de NOME mantêm o rótulo do modelo', () => {
  assert.equal(marcar('-NOME:'), '-NOME: {{NOME}}');
  assert.equal(marcar('NOME'), 'NOME: {{NOME}}');
  assert.equal(marcar('NOME DO PACIENTE:'), 'NOME DO PACIENTE: {{NOME}}');
  assert.equal(marcar('NOME DO PACIENTE: {{NOME}}'), 'NOME DO PACIENTE: {{NOME}}');
});

test('caixa da evolução com rótulos colados e valores de exemplo', () => {
  assert.equal(
    marcar('DATA DE ADMISSÃO: DATA DE NASCIMENTO HIPÓTESE DIAGNÓSTICA DIAS DE INTERNAÇÃO: 0'),
    'DATA DE ADMISSÃO: {{DATA_ADMISSAO}} DATA DE NASCIMENTO: {{DATA_NASCIMENTO}} HIPÓTESE DIAGNÓSTICA: {{HIPOTESE}} DIAS DE INTERNAÇÃO: {{DIAS_INTERNACAO}}',
  );
  assert.equal(
    marcar('DATA DE ADMISSÃO: 09/10/2026 DIAS DE INTERNAÇÃO: 0 DIA HIPÓTESE DIAGNÓSTICA: DATA DE NASCIMENTO:'),
    'DATA DE ADMISSÃO: {{DATA_ADMISSAO}} DIAS DE INTERNAÇÃO: {{DIAS_INTERNACAO}} HIPÓTESE DIAGNÓSTICA: {{HIPOTESE}} DATA DE NASCIMENTO: {{DATA_NASCIMENTO}}',
  );
  // Sem valor de exemplo, o valor entra logo depois de ": " e a tabulação do modelo fica depois dele.
  assert.equal(
    marcar('HIPÓTESE DIAGNÓSTICA: \tDIAS DE INTERNAÇÃO:  0'),
    'HIPÓTESE DIAGNÓSTICA: {{HIPOTESE}}\tDIAS DE INTERNAÇÃO:  {{DIAS_INTERNACAO}}',
  );
  // Feminina: o título "EVOLUÇÃO / EXAME FÍSICO" está na mesma célula e precisa ficar.
  assert.equal(
    marcar(' DATA DE ADMISSÃO: 11/10/2026 DATA DE NASCIMENTO HIPÓTESE DIAGNÓSTICA: DIAS DE INTERNAÇÃO:  0 EVOLUÇÃO / EXAME FÍSICO'),
    ' DATA DE ADMISSÃO: {{DATA_ADMISSAO}} DATA DE NASCIMENTO: {{DATA_NASCIMENTO}} HIPÓTESE DIAGNÓSTICA: {{HIPOTESE}} DIAS DE INTERNAÇÃO:  {{DIAS_INTERNACAO}} EVOLUÇÃO / EXAME FÍSICO',
  );
});

test('linha de assinatura troca só a data', () => {
  assert.equal(marcar('ASSINATURA MÉDICA: ___________________ DATA: 17/10/2026'), 'ASSINATURA MÉDICA: ___________________ DATA: {{DATA}}');
});

test('textos livres nunca guardam achados clínicos como padrão', () => {
  const hpp = ctx.marcarTexto('HPP : PREVIAMENTE HÍGIDO');
  assert.equal(hpp.texto, 'HPP : {{HPP}}');
  assert.equal(hpp.padroes.HPP, undefined);
  const evo = ctx.marcarTexto('EVOLUÇÃO CLÍNICA:  ADMISSÃO HOSPITALAR');
  assert.equal(evo.texto, 'EVOLUÇÃO CLÍNICA:  {{EVOLUCAO}}');
  assert.equal(evo.padroes.EVOLUCAO, undefined);
  assert.equal(marcar('RELATO DE INTERNAÇÃO : '), 'RELATO DE INTERNAÇÃO : {{RELATO}}');
  assert.equal(marcar('RELATO DE INTERNAÇÃO: Pacinete gestante G1A0P0, expulsa RN'), 'RELATO DE INTERNAÇÃO: {{RELATO}}');
  assert.equal(marcar('RELATO DE INTERNAÇÃO : HPP'), 'RELATO DE INTERNAÇÃO : {{RELATO}}     HPP: {{HPP}}');
  assert.equal(marcar('EXAME RN: Avalio RN no leito'), 'EXAME RN: {{EXAME_RN}}');
});

test('linhas que não são rótulos ficam iguais', () => {
  for (const linha of [
    'BEG, CORADO, HIDRATADO, ANICTÉRICO, ACIANÓTICO, AFEBRIL',
    'CONDUTA: INTERNAÇÃO HOSPITALAR',
    'EXAME FÍSICO',
    'EVOLUÇÃO / EXAME FÍSICO',
    'SOLICITAÇÃO DE EXAMES:',
    'Rua Exemplo, 123, Centro - MG',
  ]) {
    assert.equal(marcar(linha), linha);
  }
});

test('itens da prescrição', () => {
  assert.equal(ctx.rotuloItemPrescricao('ðDIPIRONA 1G 01 AMP  + ABD'), 'DIPIRONA 1G 01 AMP + ABD');
  assert.equal(ctx.rotuloItemPrescricao('\u{1F198}SVD SOS // SNG SOS'), 'SVD SOS // SNG SOS');
  assert.equal(ctx.rotuloItemPrescricao('➔ PLASIL 10MG'), 'PLASIL 10MG');
  assert.equal(ctx.itemPrescricaoVazio('.'), true);
  assert.equal(ctx.itemPrescricaoVazio('  '), true);
  assert.equal(ctx.ehLinhaNumerada('05', 'x'), true);
  assert.equal(ctx.ehLinhaNumerada('24', 'VIDE VERSO'), false);
  assert.equal(ctx.ehLinhaNumerada('VIDE VERSO', ''), false);
  assert.deepEqual(Array.from(ctx.rotulosUnicos(['A', 'B', 'a'])), ['A', 'B', 'a (2)']);
});

const padraoMasculina = [
  'DIETA BRANDA', 'CABECEIRA ELEVADA A 30º', 'DADOS VITAIS DE 06/06 H', 'ACESSO SALINIZADO VENOSO SE NECESSÁRIO',
  'DIPIRONA 1G', 'SVD SOS // SNG SOS', 'OXIGÊNIO', 'INSULINA', 'GLICOSE', 'PLASIL', 'ONDANSETRONA',
].map((rotulo, indice) => ({ indice, rotulo, ehDieta: /^DIETA\b/.test(rotulo) }));

const resumo = (entradas) => Array.from(entradas).map((e) => (e.tipo === 'padrao' ? e.indice : e.texto));

test('sem informar itens a prescrição permanece vazia, mesmo com modelo antigo', () => {
  assert.deepEqual(resumo(ctx.montarPrescricao(padraoMasculina, [], 'Manter a do modelo', '')), []);
  assert.deepEqual(resumo(ctx.montarPrescricao(padraoMasculina, [], 'Sem dieta informada', '')), []);
});

test('exemplo do plano: tira ondansetrona, dieta zero e dois adicionais', () => {
  const entradas = ctx.montarPrescricao(padraoMasculina, ['ONDANSETRONA'], 'DIETA ZERO', '1- ceftriaxona 1g ev 12/12h\n\n- omeprazol 40mg ev 1x/dia\n');
  assert.deepEqual(resumo(entradas), ['DIETA ZERO', 'CEFTRIAXONA 1G EV 12/12H', 'OMEPRAZOL 40MG EV 1X/DIA']);
});

test('dieta digitada em "Outra" sem a palavra DIETA', () => {
  assert.equal(ctx.montarPrescricao(padraoMasculina, [], 'pastosa hipossódica', '')[0].texto, 'DIETA PASTOSA HIPOSSÓDICA');
});

test('modelo sem item de dieta recebe a dieta no topo', () => {
  const semDieta = padraoMasculina.slice(1);
  assert.equal(ctx.montarPrescricao(semDieta, [], 'DIETA ZERO', '')[0].texto, 'DIETA ZERO');
});

test('datas', () => {
  assert.equal(ctx.formatarDataResposta('2026-10-09'), '09/10/2026');
  assert.equal(ctx.dataCurta('19/10/2026'), '19/10/26');
  assert.equal(ctx.diasEntre('09/10/2026', '19/10/2026'), '10');
  assert.equal(ctx.diasEntre('19/10/2026', '19/10/2026'), '0');
  assert.equal(ctx.diasEntre('', '19/10/2026'), '');
  assert.equal(ctx.normalizarNome('  mária  Silva '), 'MARIA SILVA');
});

test('achados obstétricos antigos são retirados, preservando os rótulos', () => {
  for (const linha of [
    'Dilatação: 10 cm // BCF: 140 bpm // Dinâmica uterina: 3/10',
    'Apagamento: Total // Idade Gestacional: 39+2 // História Gestacional: G1A0P0',
    'IG: 39 semanas e 2 dias; DU: presente; Toque vaginal: dilatação total',
  ]) {
    const limpa = ctx.limparLinhaObstetrica(linha);
    assert.doesNotMatch(limpa, /10 cm|140 bpm|3\/10|Total|39\+2|G1A0P0|39 semanas|presente|dilatação total/i);
    assert.match(limpa, /NÃO INFORMADO/);
  }
});

test('validação rejeita datas inexistentes, futuras, admissão em 1900 e anterior ao nascimento', () => {
  for (const r of [
    { data_admissao: '1900-01-01' }, { data_admissao: '2026-02-31' },
    { data_nascimento: '2027-01-01' }, { data_admissao: '2026-10-21' },
    { data_nascimento: '2026-10-19', data_admissao: '2026-10-18' },
    { data_nascimento: '01/01/2000', idade: '40 anos' },
    { idade: '-2' }, { idade: 'dois anos' }, { peso: '0' },
  ]) assert.throws(() => ctx.validarDadosResposta(r, '20/10/2026', 'MASCULINA'), /./);
});

test('validação respeita aniversário, meses e dias, sem tratar bebês como adultos', () => {
  for (const r of [
    { data_nascimento: '2000-10-21', idade: '25 anos' },
    { data_nascimento: '2026-08-20', idade: '2 meses' },
    { data_nascimento: '2026-10-19', idade: '1 dia' },
    { data_nascimento: '2000-02-29', idade: '26' },
    { data_nascimento: '2026-10-20', idade: '0 dias', peso: '3,2' },
  ]) assert.doesNotThrow(() => ctx.validarDadosResposta(r, '20/10/2026', 'PEDIATRIA'));
  assert.throws(() => ctx.validarDadosResposta({data_nascimento:'2026-08-20', idade:'3 meses'}, '20/10/2026', 'PEDIATRIA'), /idade/i);
});

test('prescrição pediátrica exige idade, peso e indicação por atendimento', () => {
  const completa = {idade:'2 anos', peso:'12,5', hipotese:'Indicação informada pelo médico', 'PEDIATRIA.adicionais':'Item informado pelo médico'};
  assert.doesNotThrow(() => ctx.validarDadosResposta(completa, '20/10/2026', 'PEDIATRIA'));
  for (const chave of ['idade', 'peso', 'hipotese']) {
    assert.throws(() => ctx.validarDadosResposta({...completa, [chave]:''}, '20/10/2026', 'PEDIATRIA'), /pediátrica/i);
  }
  assert.throws(() => ctx.validarDadosResposta({'PUERPERA.adicionais_rn':'Item do RN'}, '20/10/2026', 'PUERPERA'), /RN/);
});

const catalogoSelecao = [
  {texto:'ITEM A REVISADO', revisado:true},
  {texto:'ITEM B REVISADO', revisado:true},
  {texto:'ITEM ANTIGO SEM REVISÃO', revisado:false},
];

test('seleção positiva inclui somente os itens escolhidos e nunca inclui os demais', () => {
  assert.deepEqual(resumo(ctx.montarPrescricaoSelecionada(catalogoSelecao,['ITEM B REVISADO'],'','')),['ITEM B REVISADO']);
  assert.deepEqual(resumo(ctx.montarPrescricaoSelecionada(catalogoSelecao,[],'','')),[]);
});

test('seleção múltipla mantém dieta e adicionais sem duplicar itens selecionados', () => {
  const itens=ctx.montarPrescricaoSelecionada(catalogoSelecao,['ITEM B REVISADO','ITEM A REVISADO','ITEM B REVISADO'],'DIETA ZERO','Item adicional');
  assert.deepEqual(resumo(itens),['DIETA ZERO','ITEM A REVISADO','ITEM B REVISADO','ITEM ADICIONAL']);
});

test('opção desconhecida ou não revisada não pode entrar pela seleção', () => {
  assert.throws(()=>ctx.montarPrescricaoSelecionada(catalogoSelecao,['ITEM ANTIGO SEM REVISÃO'],'',''),/opção|revis/i);
  assert.throws(()=>ctx.montarPrescricaoSelecionada(catalogoSelecao,['OPÇÃO REMOVIDA'],'',''),/opção|revis/i);
  assert.throws(()=>ctx.montarPrescricaoSelecionada(catalogoSelecao,'ITEM A REVISADO','',''),/seleção/i);
});

test('catálogo sem opções não gera prescrição ao selecionar o aviso de indisponibilidade', () => {
  assert.deepEqual(resumo(ctx.montarPrescricaoSelecionada([],[ctx.SEM_OPCOES_PRESCRICAO],'','')),[]);
});

test('seleções pediátricas e do RN exigem os mesmos dados dos itens digitados', () => {
  assert.throws(()=>ctx.validarDadosResposta({'PEDIATRIA.incluir':['ITEM A REVISADO']},'20/10/2026','PEDIATRIA'),/pediátrica/i);
  assert.throws(()=>ctx.validarDadosResposta({'PUERPERA.incluir_rn':['ITEM A REVISADO']},'20/10/2026','PUERPERA'),/RN/);
});

test('opções iniciais de registro não afirmam revisão médica nem liberam medicamentos', () => {
  const opcoes=[{texto:'REGISTRAR SINAIS VITAIS',tipo:'registro'},{texto:'MEDICAMENTO COM DOSE FIXA',tipo:'registro'}];
  assert.deepEqual(resumo(ctx.montarPrescricaoSelecionada(opcoes,['REGISTRAR SINAIS VITAIS'],'','')),['REGISTRAR SINAIS VITAIS']);
  assert.throws(()=>ctx.montarPrescricaoSelecionada(opcoes,['MEDICAMENTO COM DOSE FIXA'],'',''),/opção|revis/i);
  assert.doesNotThrow(()=>ctx.validarDadosResposta({'PEDIATRIA.incluir':['REGISTRAR SINAIS VITAIS']},'20/10/2026','PEDIATRIA'));
});
