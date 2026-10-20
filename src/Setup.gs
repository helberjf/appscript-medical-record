/**
 * Instalação. Rode nesta ordem, uma vez cada:
 *   1. criarModelosDoFormulario()  -> cria cópias em Google Docs dos modelos, com {{MARCADORES}}
 *   2. (confira os modelos novos e o relatório)
 *   3. criarFormulario()           -> cria o Google Form, a planilha de respostas e o gatilho
 * Se mudar um item padrão de prescrição num modelo de formulário, rode atualizarFormulario().
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
    var modelo = CONFIG.MODELOS[chave];
    var original = DriveApp.getFileById(modelo.docxId);
    // Converte uma CÓPIA do .docx em Google Doc. O arquivo original não é tocado.
    var novo = Drive.Files.create(
      { name: 'MODELO FORMULÁRIO - ' + chave + ' (' + carimbo + ')', mimeType: MimeType.GOOGLE_DOCS, parents: [pasta.getId()] },
      original.getBlob()
    );
    var doc = DocumentApp.openById(novo.id);
    var resultado = marcarDocumento(doc.getBody());
    relatorio.push(revisarModelo(chave, doc));
    doc.saveAndClose();

    ids[chave] = novo.id;
    PROPS.setProperty('PADROES_' + chave, JSON.stringify(resultado.padroes));
  });

  PROPS.setProperty('MODELOS', JSON.stringify(ids));
  var urlRelatorio = escreverRelatorio(pasta, carimbo, relatorio);
  console.log('Modelos criados na pasta "' + CONFIG.NOME_PASTA_MODELOS + '". Relatório: ' + urlRelatorio);
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
 * Os itens padrão continuam como estão, com a formatação do hospital.
 */
function prepararTabelaPrescricao(tabela, ehRn) {
  marcarCelulaNome(tabela, ehRn);
  linhasNumeradas(tabela).forEach(function (r, k) {
    var linha = tabela.getRow(r);
    var numero = linha.getCell(0);
    if (ehParagrafo(numero.getChild(0))) trocarTextoParagrafo(comoParagrafo(numero.getChild(0)), numero2(k + 1));
    var item = linha.getCell(1);
    if (itemPrescricaoVazio(item.getText()) && item.getText().trim() !== '') escreverTextoCelula(item, '');
    else trocarSimboloSeNecessario(item);
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
  if (faltando.length) avisos.push('Marcadores que não achei (o campo do Form não vai aparecer no documento): ' + faltando.join(', '));
  Object.keys(BLOCOS).forEach(function (bloco) {
    if (!encontrarParagrafo(corpo, BLOCOS[bloco].inicio)) {
      avisos.push('Não achei o bloco "' + BLOCOS[bloco].nome + '": o que o médico digitar nesse campo não entra.');
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
      'O modelo da puérpera tinha dados de uma paciente. Confira e apague à mão o que sobrou dela ' +
      '(linhas de dinâmica uterina, dilatação, BCF etc.) ou deixe só os rótulos.'
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
    'Campos em branco ficam como no modelo da enfermaria.'
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
    return item;
  }

  // Seção 1
  var enfermaria = guardar(form.addListItem().setTitle('Enfermaria').setRequired(true), 'enfermaria');

  // Uma seção de prescrição por modelo.
  var paginas = {};
  var ordem = Object.keys(CONFIG.MODELOS);
  ordem.forEach(function (chave) {
    var rotulos = rotulosPrescricaoDoModelo(ids[chave]);
    paginas[chave] = form.addPageBreakItem()
      .setTitle('Prescrição – ' + CONFIG.MODELOS[chave].nome)
      .setHelpText('Sem mexer em nada, sai a prescrição padrão da enfermaria inteira.');

    guardar(form.addMultipleChoiceItem()
      .setTitle('Dieta')
      .setChoiceValues(dietasDoFormulario())
      .showOtherOption(true), chave + '.dieta');
    if (rotulos[0] && rotulos[0].length) {
      guardar(form.addCheckboxItem()
        .setTitle('Itens padrão a NÃO usar hoje')
        .setHelpText('Marque só o que deve SAIR. O que não for marcado fica na prescrição.')
        .setChoiceValues(rotulos[0]), chave + '.remover');
    }
    guardar(form.addParagraphTextItem()
      .setTitle('Medicações / itens adicionais')
      .setHelpText('Um item por linha. Ex.: CEFTRIAXONA 1G EV 12/12H'), chave + '.adicionais');

    if (chave === 'PUERPERA') {
      guardar(form.addTextItem().setTitle('Prontuário do RN'), 'PUERPERA.prontuario_rn');
      guardar(form.addTextItem().setTitle('Registro do RN'), 'PUERPERA.registro_rn');
      guardar(form.addTextItem().setTitle('Idade do RN'), 'PUERPERA.idade_rn');
      guardar(form.addTextItem().setTitle('Peso do RN (kg)'), 'PUERPERA.peso_rn');
      if (rotulos[1] && rotulos[1].length) {
        guardar(form.addCheckboxItem()
          .setTitle('Itens padrão do RN a NÃO usar hoje')
          .setHelpText('Marque só o que deve SAIR da prescrição do RN.')
          .setChoiceValues(rotulos[1]), 'PUERPERA.remover_rn');
      }
      guardar(form.addParagraphTextItem().setTitle('Itens adicionais do RN').setHelpText('Um item por linha.'), 'PUERPERA.adicionais_rn');
      guardar(form.addParagraphTextItem().setTitle('Exame do RN').setHelpText('Em branco = texto do modelo.'), 'PUERPERA.exame_rn');
    }
  });

  // Identificação
  var identificacao = form.addPageBreakItem().setTitle('Identificação do paciente');
  guardar(form.addTextItem().setTitle('Nome completo do paciente').setRequired(true), 'nome');
  guardar(form.addTextItem().setTitle('Prontuário'), 'prontuario');
  guardar(form.addTextItem().setTitle('Registro'), 'registro');
  guardar(form.addDateItem().setTitle('Data de nascimento'), 'data_nascimento');
  guardar(form.addTextItem().setTitle('Idade'), 'idade');
  guardar(form.addTextItem().setTitle('Peso (kg)'), 'peso');
  guardar(form.addTextItem().setTitle('Leito'), 'leito');
  guardar(form.addDateItem().setTitle('Data de admissão').setHelpText('Em branco = hoje.'), 'data_admissao');
  guardar(form.addTextItem().setTitle('Hipótese diagnóstica'), 'hipotese');

  // Evolução
  form.addPageBreakItem().setTitle('Evolução / exame físico').setHelpText('Campos em branco ficam com o texto do modelo.');
  guardar(form.addParagraphTextItem().setTitle('Relato de internação'), 'relato');
  guardar(form.addParagraphTextItem().setTitle('HPP'), 'hpp');
  guardar(form.addParagraphTextItem().setTitle('Evolução clínica'), 'evolucao');
  guardar(form.addParagraphTextItem().setTitle('Exame físico').setHelpText('Em branco = exame físico padrão do modelo.'), 'exame_fisico');
  guardar(form.addParagraphTextItem().setTitle('Conduta').setHelpText('Em branco = conduta do modelo.'), 'conduta');
  guardar(form.addParagraphTextItem().setTitle('Solicitação de exames').setHelpText('Um exame por linha. Em branco = a do modelo.'), 'solicitacao');

  // Receita de alta da puérpera
  var alta = form.addPageBreakItem().setTitle('Receita de alta – puérpera');
  guardar(form.addTextItem().setTitle('Nome da puérpera').setRequired(true), 'alta.nome');

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

/** Atualiza as caixas "Itens padrão a NÃO usar hoje" a partir dos modelos do formulário. */
function atualizarFormulario() {
  var form = FormApp.openById(PROPS.getProperty('FORM_ID'));
  var ids = idsModelosFormulario();
  var itens = lerJsonPropriedade('FORM_ITENS', {});
  var porChave = {};
  Object.keys(itens).forEach(function (id) { porChave[itens[id]] = Number(id); });

  Object.keys(CONFIG.MODELOS).forEach(function (chave) {
    var rotulos = rotulosPrescricaoDoModelo(ids[chave]);
    [[chave + '.remover', rotulos[0]], ['PUERPERA.remover_rn', chave === 'PUERPERA' ? rotulos[1] : null]].forEach(function (par) {
      if (!par[1] || !par[1].length || porChave[par[0]] === undefined) return;
      form.getItemById(porChave[par[0]]).asCheckboxItem().setChoiceValues(par[1]);
    });
  });
  console.log('Listas de itens padrão atualizadas.');
}
