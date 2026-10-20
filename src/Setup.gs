/**
 * Instalação. Rode nesta ordem, uma vez cada:
 *   1. criarModelosDoFormulario()  -> cria cópias em Google Docs dos modelos, com {{MARCADORES}}
 *   2. (confira os modelos novos e o relatório)
 *   3. criarFormulario()           -> cria o Google Form, a planilha de respostas e o gatilho
 * atualizarFormulario() migra perguntas existentes sem excluir suas respostas históricas.
 */

var PROPS = PropertiesService.getScriptProperties();

var FONTE_NOME_CABECALHO = { familia: 'Archivo Black', tamanho: 12 };

var MARCADORES_ESPERADOS = [
  'NOME', 'PRONTUARIO', 'REGISTRO', 'DATA_CABECALHO', 'DATA', 'HORA', 'ENFERMARIA', 'LEITO', 'IDADE', 'PESO',
  'DATA_ADMISSAO', 'DATA_NASCIMENTO', 'DIAS_INTERNACAO', 'HIPOTESE', 'RELATO', 'HPP', 'EVOLUCAO',
];

function lerJsonPropriedade(chave, padrao) {
  var valor = PROPS.getProperty(chave);
  return valor ? JSON.parse(valor) : padrao;
}

function obterOuCriarPasta(pai, nome) {
  var existentes = pai.getFoldersByName(nome);
  return existentes.hasNext() ? existentes.next() : pai.createFolder(nome);
}

/** IDs dos modelos de formulário (Google Docs) criados no passo 1. */
function idsModelosFormulario() {
  var ids = lerJsonPropriedade('MODELOS', null);
  if (!ids) throw new Error('Rode primeiro criarModelosDoFormulario().');
  return ids;
}

// ---------------------------------------------------------------------------
// Passo 1: modelos do formulário
// ---------------------------------------------------------------------------

function criarModelosDoFormulario() {
  if (PROPS.getProperty('MODELOS')) {
    throw new Error(
      'Os modelos do formulário já foram criados. Para criar uma versão nova (as antigas continuam guardadas), ' +
      'rode recriarModelosDoFormulario().'
    );
  }
  recriarModelosDoFormulario();
}

function recriarModelosDoFormulario() {
  var raiz = DriveApp.getFolderById(CONFIG.PASTA_RAIZ);
  var pasta = obterOuCriarPasta(raiz, CONFIG.NOME_PASTA_MODELOS);
  var carimbo = Utilities.formatDate(new Date(), CONFIG.FUSO, 'dd-MM-yyyy HH.mm');
  var ids = {};
  var relatorio = [];

  Object.keys(CONFIG.MODELOS).forEach(function (chave) {
    var criado = criarModeloSeguro(chave, pasta, carimbo);
    relatorio.push(criado.relatorio);
    ids[chave] = criado.id;
  });

  PROPS.setProperty('MODELOS', JSON.stringify(ids));
  PROPS.setProperty('MODELOS_VERSAO', VERSAO_MODELOS);
  var urlRelatorio = escreverRelatorio(pasta, carimbo, relatorio);
  console.log('Modelos criados na pasta "' + CONFIG.NOME_PASTA_MODELOS + '". Relatório: ' + urlRelatorio);
}

/** Unidade de trabalho que pode ser retomada em outra execução do Apps Script. */
function criarModeloSeguro(chave, pasta, carimbo) {
  var original = DriveApp.getFileById(CONFIG.MODELOS[chave].docxId);
  var novo = Drive.Files.create(
    {name:'MODELO FORMULÁRIO - ' + chave + ' (' + carimbo + ')', mimeType:MimeType.GOOGLE_DOCS, parents:[pasta.getId()]},
    original.getBlob()
  );
  var doc = DocumentApp.openById(novo.id);
  var resultado = marcarDocumento(doc.getBody());
  prepararBlocosClinicos(doc.getBody(), chave === 'PUERPERA');
  var relatorio = revisarModelo(chave, doc);
  doc.saveAndClose();
  PROPS.setProperty('PADROES_' + chave, JSON.stringify(resultado.padroes));
  return {id:novo.id, relatorio:relatorio};
}

/** Coloca os {{MARCADORES}} no modelo convertido. Devolve os textos padrão encontrados (HPP, evolução...). */
function marcarDocumento(corpo) {
  var padroes = {};
  var ordemPrescricao = 0;

  function marcarParagrafo(paragrafo, sufixo) {
    var antigo = paragrafo.getText();
    if (!antigo.trim()) return;
    var resultado = marcarTexto(antigo, sufixo);
    Object.keys(resultado.padroes).forEach(function (chave) {
      if (!(chave in padroes)) padroes[chave] = resultado.padroes[chave];
    });
    if (resultado.edicoes.length) aplicarEdicoesParagrafo(paragrafo, resultado.edicoes);
  }

  function percorrer(container, sufixo) {
    for (var i = 0; i < container.getNumChildren(); i++) {
      var elemento = container.getChild(i);
      if (ehParagrafo(elemento)) marcarParagrafo(comoParagrafo(elemento), sufixo);
      else if (elemento.getType() === DocumentApp.ElementType.TABLE) percorrerTabela(elemento.asTable(), sufixo);
    }
  }

  function percorrerTabela(tabela, sufixo) {
    var pular = {};
    var sufixoTabela = sufixo;
    if (ehTabelaPrescricao(tabela)) {
      var ehRn = ordemPrescricao >= 1;
      ordemPrescricao++;
      sufixoTabela = ehRn ? '_RN' : '';
      prepararTabelaPrescricao(tabela, ehRn);
      linhasNumeradas(tabela).forEach(function (r) { pular[r] = true; });
    }
    for (var r = 0; r < tabela.getNumRows(); r++) {
      if (pular[r]) continue;
      var linha = tabela.getRow(r);
      for (var c = 0; c < linha.getNumCells(); c++) percorrer(linha.getCell(c), sufixoTabela);
    }
  }

  percorrer(corpo, '');
  return { padroes: padroes };
}

/**
 * Na tabela de prescrição do modelo: a célula antes de "Prontuário:" vira {{NOME}} (no da puérpera havia
 * o nome de uma paciente), as linhas são renumeradas 01, 02... sem pular e as células com só "." ficam vazias.
 * Os itens de prescrição ficam vazios: nenhuma ordem é herdada do modelo.
 */
function prepararTabelaPrescricao(tabela, ehRn) {
  marcarCelulaNome(tabela, ehRn);
  linhasNumeradas(tabela).forEach(function (r, k) {
    var linha = tabela.getRow(r);
    var numero = linha.getCell(0);
    if (ehParagrafo(numero.getChild(0))) trocarTextoParagrafo(comoParagrafo(numero.getChild(0)), numero2(k + 1));
    var item = linha.getCell(1);
    escreverTextoCelula(item, '');
  });
}

/**
 * A célula antes de "Prontuário:" vira {{NOME}} (ou "RN DE {{NOME}}" na tabela do RN).
 * Células mescladas aparecem no Apps Script como várias células: só a primeira tem colSpan > 0 e é a visível;
 * as outras (colSpan 0) ficam escondidas. Por isso volta até a célula visível e limpa marcadores nas escondidas.
 */
function marcarCelulaNome(tabela, ehRn) {
  for (var r = 0; r < tabela.getNumRows(); r++) {
    var linha = tabela.getRow(r);
    for (var c = 1; c < linha.getNumCells(); c++) {
      if (!/^Prontu[áa]rio/i.test(linha.getCell(c).getText().trim())) continue;
      var k = c - 1;
      while (k > 0 && linha.getCell(k).getColSpan() === 0) k--;
      var visivel = linha.getCell(k);
      var rn = ehRn || /^RN\b/i.test(visivel.getText().trim());
      var nome = rn ? 'RN DE {{NOME}}' : '{{NOME}}';
      escreverTextoCelula(visivel, nome);
      // Como nos prontuários preenchidos pelos médicos: nome em Archivo Black 12.
      // (Convertida do Word, a célula vazia vem com fonte minúscula, tamanho 2.)
      var alvo = visivel.editAsText();
      alvo.setFontFamily(0, nome.length - 1, FONTE_NOME_CABECALHO.familia);
      alvo.setFontSize(0, nome.length - 1, FONTE_NOME_CABECALHO.tamanho);
      alvo.setBold(0, nome.length - 1, false);
      for (var j = k + 1; j < c; j++) {
        if (linha.getCell(j).getText().indexOf('{{') !== -1) escreverTextoCelula(linha.getCell(j), '');
      }
    }
  }
}

function revisarModelo(chave, doc) {
  var corpo = doc.getBody();
  var texto = corpo.getText();
  var encontrados = {};
  (texto.match(/\{\{[A-Z_0-9]+\}\}/g) || []).forEach(function (m) { encontrados[m.slice(2, -2)] = true; });
  var avisos = [];
  var faltando = MARCADORES_ESPERADOS.filter(function (m) { return !encontrados[m]; });
  if (faltando.length) avisos.push('Marcadores ausentes (valores informados serão incluídos ao final): ' + faltando.join(', '));
  Object.keys(BLOCOS).forEach(function (bloco) {
    if (bloco === 'EXAME_RN' && chave !== 'PUERPERA') return;
    var existe = false;
    percorrerContainersDocumento(corpo, function (container) {
      if (encontrarParagrafo(container, BLOCOS[bloco].inicio)) existe = true;
    });
    if (!existe) {
      avisos.push('Bloco "' + BLOCOS[bloco].nome + '" ausente; conteúdo será incluído ao final.');
    }
  });
  var tabelas = tabelasPrescricao(corpo).map(function (tabela, i) {
    return {
      nome: i === 0 ? 'Prescrição' : 'Prescrição do RN',
      linhas: linhasNumeradas(tabela).length,
      itens: itensPadraoDaTabela(tabela).map(function (item) { return item.rotulo; }),
    };
  });
  if (!tabelas.length) avisos.push('Não achei a tabela de prescrição.');
  if (chave === 'PUERPERA') {
    avisos.push(
      'Campos obstétricos identificados foram neutralizados. Confira o modelo completo para localizar outros dados herdados não reconhecidos.'
    );
  }
  return {
    chave: chave,
    url: doc.getUrl(),
    marcadores: Object.keys(encontrados).sort(),
    tabelas: tabelas,
    avisos: avisos,
  };
}

function escreverRelatorio(pasta, carimbo, relatorio) {
  var doc = DocumentApp.create('_RELATÓRIO DOS MODELOS (' + carimbo + ')');
  var corpo = doc.getBody();
  corpo.appendParagraph('Relatório dos modelos do formulário').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  corpo.appendParagraph('Abra cada modelo, confira os {{MARCADORES}} e ajuste à mão o que precisar. Os .docx originais não foram alterados.');
  relatorio.forEach(function (item) {
    corpo.appendParagraph(item.chave).setHeading(DocumentApp.ParagraphHeading.HEADING2);
    corpo.appendParagraph('Modelo: ' + item.url);
    corpo.appendParagraph('Marcadores: ' + (item.marcadores.join(', ') || 'nenhum'));
    item.tabelas.forEach(function (tabela) {
      corpo.appendParagraph(tabela.nome + ': ' + tabela.linhas + ' linhas, ' + tabela.itens.length + ' itens padrão');
      tabela.itens.forEach(function (rotulo) { corpo.appendListItem(rotulo); });
    });
    item.avisos.forEach(function (aviso) { corpo.appendParagraph('⚠ ' + aviso); });
    console.log(item.chave + ': ' + item.avisos.length + ' aviso(s). ' + item.url);
  });
  doc.saveAndClose();
  DriveApp.getFileById(doc.getId()).moveTo(pasta);
  return doc.getUrl();
}

// ---------------------------------------------------------------------------
// Passo 3: formulário
// ---------------------------------------------------------------------------

/** Itens padrão de cada tabela de prescrição de um modelo do formulário: [[rótulos da mãe], [rótulos do RN]]. */
function rotulosPrescricaoDoModelo(docId) {
  var corpo = DocumentApp.openById(docId).getBody();
  return tabelasPrescricao(corpo).map(function (tabela) {
    return itensPadraoDaTabela(tabela).map(function (item) { return item.rotulo; });
  });
}

/**
 * Validação no próprio Form: idade e peso digitados errado são barrados ANTES do envio
 * (antes só o script recusava depois, e o médico tinha de preencher tudo de novo).
 * Datas não têm validação no Google Forms; elas continuam conferidas pelo script.
 */
function aplicarValidacoes(chave, item) {
  var regras = {
    idade: [PADRAO_IDADE_FORM, 'Idade inválida. Ex.: 66, 66 anos, 1 ano e 3 meses, 15 dias.'],
    'PUERPERA.idade_rn': [PADRAO_IDADE_FORM, 'Idade inválida. Ex.: 2 dias, 1 mês e 5 dias.'],
    peso: [PADRAO_PESO_FORM, 'Só o número, em kg. Ex.: 70 ou 70,5.'],
    'PUERPERA.peso_rn': [PADRAO_PESO_FORM, 'Só o número, em kg. Ex.: 3,2.'],
  };
  if (!regras[chave]) return item;
  item.asTextItem().setValidation(FormApp.createTextValidation()
    .setHelpText(regras[chave][1]).requireTextMatchesPattern(regras[chave][0]).build());
  return item;
}

function adicionarPerguntasAtendimento(form) {
  return {
    data: form.addDateItem().setTitle('Data do atendimento').setIncludesYear(true)
      .setHelpText('Em branco = data do envio. Preencha quando registrar depois do atendimento.'),
    hora: form.addTimeItem().setTitle('Hora do atendimento').setHelpText('Em branco = hora do envio.'),
  };
}

function configurarSelecaoPrescricao(item, catalogo) {
  var opcoes = itensRevisadosPrescricao((CONFIG.OPCOES_PRESCRICAO || {})[catalogo]);
  return item.setTitle(catalogo === 'RN' ? 'Itens para incluir na prescrição do RN' : 'Itens para incluir na prescrição')
    .setHelpText('Selecione somente o que deve entrar neste atendimento. Nada selecionado = nenhum item desta lista. Revise os itens para este paciente.')
    .setChoiceValues(opcoes.length ? opcoes : [SEM_OPCOES_PRESCRICAO]).setRequired(false).showOtherOption(false);
}

function criarFormulario() {
  if (PROPS.getProperty('FORM_ID')) {
    var existente = FormApp.openById(PROPS.getProperty('FORM_ID'));
    throw new Error(
      'O formulário já existe: ' + existente.getEditUrl() +
      ' . Para atualizar as listas de itens padrão, rode atualizarFormulario().'
    );
  }
  var ids = idsModelosFormulario();
  var raiz = DriveApp.getFolderById(CONFIG.PASTA_RAIZ);
  var form = FormApp.create(CONFIG.TITULO_FORMULARIO);
  form.setDescription(
    'Preencha os dados e o documento (prescrição + evolução + solicitação) é criado na pasta do paciente. ' +
    'Campos clínicos em branco ficam sem registro e geram aviso para preenchimento. Nenhuma prescrição é herdada do modelo.'
  );
  try {
    form.setEmailCollectionType(FormApp.EmailCollectionType.VERIFIED);
  } catch (erro) {
    form.setCollectEmail(true);
  }
  form.setAllowResponseEdits(false);
  form.setShowLinkToRespondAgain(true);
  form.setConfirmationMessage('Recebido. O documento é criado na pasta do paciente em alguns segundos e o link chega no seu e-mail.');

  var itens = {};
  function guardar(item, chave) {
    itens[item.getId()] = chave;
    return aplicarValidacoes(chave, item);
  }

  // Seção 1
  var enfermaria = guardar(form.addListItem().setTitle('Enfermaria').setRequired(true), 'enfermaria');

  // Uma seção de prescrição por modelo.
  var paginas = {};
  var ordem = Object.keys(CONFIG.MODELOS);
  ordem.forEach(function (chave) {
    paginas[chave] = form.addPageBreakItem()
      .setTitle('Prescrição – ' + CONFIG.MODELOS[chave].nome)
      .setHelpText('Informe os itens deste atendimento. Em branco = sem prescrição registrada. Revise indicação, dose, concentração, via e frequência.');

    guardar(form.addMultipleChoiceItem()
      .setTitle('Dieta')
      .setChoiceValues(dietasDoFormulario())
      .showOtherOption(true), chave + '.dieta');
    guardar(configurarSelecaoPrescricao(form.addCheckboxItem(), chave), chave + '.incluir');
    guardar(form.addParagraphTextItem()
      .setTitle('Itens adicionais da prescrição')
      .setHelpText('Um item completo por linha, individualizado pelo médico. Pediatria: exige idade/nascimento, peso e indicação.'), chave + '.adicionais');

    if (chave === 'PUERPERA') {
      guardar(form.addTextItem().setTitle('Prontuário do RN'), 'PUERPERA.prontuario_rn');
      guardar(form.addTextItem().setTitle('Registro do RN'), 'PUERPERA.registro_rn');
      guardar(form.addTextItem().setTitle('Idade do RN').setHelpText('Informe a unidade: por exemplo, 2 dias.'), 'PUERPERA.idade_rn');
      guardar(form.addTextItem().setTitle('Peso do RN (kg)'), 'PUERPERA.peso_rn');
      guardar(form.addTextItem().setTitle('Indicação da prescrição do RN'), 'PUERPERA.indicacao_rn');
      guardar(configurarSelecaoPrescricao(form.addCheckboxItem(), 'RN'), 'PUERPERA.incluir_rn');
      guardar(form.addParagraphTextItem().setTitle('Itens adicionais da prescrição do RN').setHelpText('Um item completo por linha. Exige idade, peso e indicação do RN.'), 'PUERPERA.adicionais_rn');
      guardar(form.addParagraphTextItem().setTitle('Exame do RN').setHelpText('Em branco = sem avaliação registrada; preencher.'), 'PUERPERA.exame_rn');
    }
  });

  // Identificação
  var identificacao = form.addPageBreakItem().setTitle('Identificação do paciente');
  guardar(form.addTextItem().setTitle('Nome completo do paciente').setRequired(true), 'nome');
  var atendimento = adicionarPerguntasAtendimento(form);
  guardar(atendimento.data, 'data_atendimento');
  guardar(atendimento.hora, 'hora_atendimento');
  guardar(form.addTextItem().setTitle('Prontuário'), 'prontuario');
  guardar(form.addTextItem().setTitle('Registro'), 'registro');
  guardar(form.addDateItem().setTitle('Data de nascimento').setIncludesYear(true), 'data_nascimento');
  guardar(form.addTextItem().setTitle('Idade').setHelpText('Ex.: 66, 66 anos, 1 ano e 3 meses, 15 dias. Deve coincidir com o nascimento na data do atendimento.'), 'idade');
  guardar(form.addTextItem().setTitle('Peso (kg)'), 'peso');
  guardar(form.addTextItem().setTitle('Leito'), 'leito');
  guardar(form.addDateItem().setTitle('Data de admissão').setIncludesYear(true).setHelpText('Em branco = hoje. Confira o ano completo.'), 'data_admissao');
  guardar(form.addTextItem().setTitle('Hipótese diagnóstica'), 'hipotese');

  // Evolução
  form.addPageBreakItem().setTitle('Evolução / exame físico').setHelpText('Campos vazios ficam sem registro; nenhum achado ou conduta é presumido.');
  guardar(form.addParagraphTextItem().setTitle('Relato de internação'), 'relato');
  guardar(form.addParagraphTextItem().setTitle('HPP'), 'hpp');
  guardar(form.addParagraphTextItem().setTitle('Evolução clínica'), 'evolucao');
  guardar(form.addParagraphTextItem().setTitle('Exame físico').setHelpText('Em branco = sem avaliação registrada; preencher.'), 'exame_fisico');
  guardar(form.addParagraphTextItem().setTitle('Conduta').setHelpText('Informe a decisão deste atendimento. Em branco = não informada; preencher.'), 'conduta');
  guardar(form.addParagraphTextItem().setTitle('Solicitação de exames').setHelpText('Um exame por linha. Em branco = não informada.'), 'solicitacao');

  // Receita de alta da puérpera
  var alta = form.addPageBreakItem().setTitle('Receita de alta – puérpera');
  guardar(form.addTextItem().setTitle('Nome da puérpera').setRequired(true), 'alta.nome');
  guardar(configurarSelecaoPrescricao(form.addCheckboxItem(), 'ALTA_PUERPERA'), 'alta.incluir');
  guardar(form.addParagraphTextItem().setTitle('Prescrição de alta deste atendimento').setHelpText('Um item completo por linha. Em branco = sem prescrição registrada.'), 'alta.prescricao');

  // Navegação: o salto definido numa quebra de página vale para quem termina a seção ANTERIOR a ela.
  for (var i = 1; i < ordem.length; i++) paginas[ordem[i]].setGoToPage(identificacao);
  alta.setGoToPage(FormApp.PageNavigationType.SUBMIT); // depois da evolução, envia
  enfermaria.setChoices(CONFIG.ENFERMARIAS.map(function (opcao) {
    return enfermaria.createChoice(opcao.opcao, opcao.receitaAlta ? alta : paginas[opcao.modelo]);
  }));

  // Planilha de respostas + aba de documentos gerados
  var planilha = SpreadsheetApp.create(CONFIG.TITULO_FORMULARIO + ' – respostas');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, planilha.getId());
  planilha.insertSheet('Documentos gerados').appendRow(['Quando', 'Enfermaria', 'Paciente', 'Documento', 'Quem preencheu', 'Avisos']);

  DriveApp.getFileById(form.getId()).moveTo(raiz);
  DriveApp.getFileById(planilha.getId()).moveTo(raiz);

  ScriptApp.newTrigger('aoEnviarFormulario').forForm(form).onFormSubmit().create();

  PROPS.setProperty('FORM_ID', form.getId());
  PROPS.setProperty('PLANILHA_ID', planilha.getId());
  PROPS.setProperty('FORM_ITENS', JSON.stringify(itens));

  console.log('Formulário para os médicos: ' + form.getPublishedUrl());
  console.log('Editar o formulário: ' + form.getEditUrl());
  console.log('Planilha: ' + planilha.getUrl());
}

/** Migra textos e campos sem excluir perguntas nem mudar seus IDs ou respostas existentes. */
function atualizarFormulario() {
  var form = FormApp.openById(PROPS.getProperty('FORM_ID'));
  var itens = lerJsonPropriedade('FORM_ITENS', {});
  var porChave = {};
  Object.keys(itens).forEach(function (id) { porChave[itens[id]] = Number(id); });

  form.setDescription('Campos clínicos vazios ficam sem registro e geram aviso. A prescrição contém somente os itens informados neste atendimento. Revisão e assinatura médica obrigatórias.');
  Object.keys(porChave).forEach(function (chave) {
    var item = form.getItemById(porChave[chave]);
    aplicarValidacoes(chave, item);
    if (/\.remover(?:_rn)?$/.test(chave)) {
      item.asCheckboxItem().setTitle('Campo antigo — não utilizar').setHelpText('Ignorado: nenhum item padrão é prescrito.').setChoiceValues(['Nenhum item padrão será incluído']).setRequired(false).showOtherOption(false);
    } else if (/\.incluir(?:_rn)?$/.test(chave)) {
      configurarSelecaoPrescricao(item.asCheckboxItem(), chave === 'alta.incluir' ? 'ALTA_PUERPERA' : /_rn$/.test(chave) ? 'RN' : chave.split('.')[0]);
    } else if (/\.dieta$/.test(chave)) item.asMultipleChoiceItem().setChoiceValues(dietasDoFormulario());
    else if (/\.adicionais(?:_rn)?$/.test(chave)) {
      item.asParagraphTextItem().setTitle(/_rn$/.test(chave) ? 'Itens adicionais da prescrição do RN' : 'Itens adicionais da prescrição')
        .setHelpText('Um item completo por linha, individualizado pelo médico. Pediatria/RN: exige idade, peso e indicação.');
    } else if (['exame_fisico','conduta','solicitacao','PUERPERA.exame_rn'].indexOf(chave) !== -1) {
      item.asParagraphTextItem().setHelpText('Em branco = sem registro; preencher após avaliação.');
    } else if (chave === 'data_admissao' || chave === 'data_nascimento') item.asDateItem().setIncludesYear(true).setHelpText('Confira dia, mês e ano completo.');
    else if (chave === 'idade' || chave === 'PUERPERA.idade_rn') item.asTextItem().setHelpText('Ex.: 66, 66 anos, 1 ano e 3 meses, 15 dias.');
  });
  form.getItems(FormApp.ItemType.PAGE_BREAK).forEach(function (item) {
    item.asPageBreakItem().setHelpText('Campos vazios ficam sem registro. Prescrições e decisões dependem da avaliação médica deste atendimento.');
  });
  function adicionarSeFaltar(chave, item, antesDe) {
    itens[item.getId()] = chave;
    if (antesDe && porChave[antesDe] !== undefined) form.moveItem(item.getIndex(), form.getItemById(porChave[antesDe]).getIndex());
    porChave[chave] = item.getId();
  }
  if (porChave.data_atendimento === undefined) {
    var atendimento = adicionarPerguntasAtendimento(form);
    adicionarSeFaltar('data_atendimento', atendimento.data, 'prontuario');
    adicionarSeFaltar('hora_atendimento', atendimento.hora, 'prontuario');
  }
  if (porChave['PUERPERA.indicacao_rn'] === undefined) adicionarSeFaltar('PUERPERA.indicacao_rn', form.addTextItem().setTitle('Indicação da prescrição do RN'), 'PUERPERA.adicionais_rn');
  if (porChave['alta.prescricao'] === undefined) adicionarSeFaltar('alta.prescricao', form.addParagraphTextItem().setTitle('Prescrição de alta deste atendimento').setHelpText('Um item completo por linha, individualizado pelo médico.'));
  Object.keys(CONFIG.MODELOS).forEach(function (chave) {
    if (porChave[chave + '.incluir'] === undefined) adicionarSeFaltar(chave + '.incluir', configurarSelecaoPrescricao(form.addCheckboxItem(), chave), chave + '.adicionais');
  });
  if (porChave['PUERPERA.incluir_rn'] === undefined) adicionarSeFaltar('PUERPERA.incluir_rn', configurarSelecaoPrescricao(form.addCheckboxItem(), 'RN'), 'PUERPERA.adicionais_rn');
  if (porChave['alta.incluir'] === undefined) adicionarSeFaltar('alta.incluir', configurarSelecaoPrescricao(form.addCheckboxItem(), 'ALTA_PUERPERA'), 'alta.prescricao');

  // As perguntas antigas ficam após uma seção que envia o formulário antes de exibi-las.
  // IDs distintos impedem interpretar uma exclusão histórica como inclusão atual.
  var antigas = Object.keys(porChave).filter(function (chave) { return /\.remover(?:_rn)?$/.test(chave); });
  if (antigas.length) {
    var idHistorico = PROPS.getProperty('FORM_SECAO_LEGADA');
    var historico = idHistorico ? form.getItemById(Number(idHistorico)).asPageBreakItem() : form.addPageBreakItem().setTitle('Histórico do formulário — não preencher');
    historico.setGoToPage(FormApp.PageNavigationType.SUBMIT);
    PROPS.setProperty('FORM_SECAO_LEGADA', String(historico.getId()));
    antigas.forEach(function (chave) {
      var item = form.getItemById(porChave[chave]);
      form.moveItem(item.getIndex(), form.getItems().length - 1);
    });
  }
  PROPS.setProperty('FORM_ITENS', JSON.stringify(itens));
  console.log('Formulário atualizado; IDs e respostas anteriores preservados.');
}
