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

test('textos livres guardam o padrão do modelo', () => {
  const hpp = ctx.marcarTexto('HPP : PREVIAMENTE HÍGIDO');
  assert.equal(hpp.texto, 'HPP : {{HPP}}');
  assert.equal(hpp.padroes.HPP, 'PREVIAMENTE HÍGIDO');
  const evo = ctx.marcarTexto('EVOLUÇÃO CLÍNICA:  ADMISSÃO HOSPITALAR');
  assert.equal(evo.texto, 'EVOLUÇÃO CLÍNICA:  {{EVOLUCAO}}');
  assert.equal(evo.padroes.EVOLUCAO, 'ADMISSÃO HOSPITALAR');
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
    'Apagamento: Total // Idade Gestacional: 39+2 // História Gestacional: G1A0P0',
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

test('sem mexer em nada sai a prescrição padrão inteira', () => {
  assert.deepEqual(resumo(ctx.montarPrescricao(padraoMasculina, [], 'Manter a do modelo', '')), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('exemplo do plano: tira ondansetrona, dieta zero e dois adicionais', () => {
  const entradas = ctx.montarPrescricao(padraoMasculina, ['ONDANSETRONA'], 'DIETA ZERO', '1- ceftriaxona 1g ev 12/12h\n\n- omeprazol 40mg ev 1x/dia\n');
  assert.deepEqual(resumo(entradas), ['DIETA ZERO', 1, 2, 3, 4, 5, 6, 7, 8, 9, 'CEFTRIAXONA 1G EV 12/12H', 'OMEPRAZOL 40MG EV 1X/DIA']);
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
