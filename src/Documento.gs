/**
 * Funções de Google Docs usadas pela criação dos modelos (Setup.gs) e pelo preenchimento (Preencher.gs).
 * Tudo aqui mexe só em documentos que o próprio script criou.
 */

function ehParagrafo(elemento) {
  var tipo = elemento.getType();
  return tipo === DocumentApp.ElementType.PARAGRAPH || tipo === DocumentApp.ElementType.LIST_ITEM;
}

function comoParagrafo(elemento) {
  return elemento.getType() === DocumentApp.ElementType.LIST_ITEM ? elemento.asListItem() : elemento.asParagraph();
}

/** Atributos de um caractere sem os valores nulos (nulo = "herdado", e não deve ser regravado). */
function estiloSemNulos(atributos) {
  var limpo = {};
  Object.keys(atributos || {}).forEach(function (chave) {
    if (atributos[chave] !== null && atributos[chave] !== undefined) limpo[chave] = atributos[chave];
  });
  return limpo;
}

/**
 * Troca o texto de um parágrafo mantendo a aparência: o rótulo (até o primeiro ":") fica com o estilo
 * do começo da linha antiga e o resto com o estilo do fim da linha antiga.
 */
function trocarTextoParagrafo(paragrafo, novoTexto) {
  var texto = paragrafo.editAsText();
  var antigo = texto.getText();
  var estiloInicio = antigo.length ? estiloSemNulos(texto.getAttributes(0)) : null;
  var estiloFim = antigo.length ? estiloSemNulos(texto.getAttributes(antigo.length - 1)) : null;
  if (!novoTexto.length) {
    paragrafo.clear(); // o Docs não aceita setText('')
    return;
  }
  paragrafo.setText(novoTexto);
  if (!estiloInicio) return;
  var novo = paragrafo.editAsText();
  var doisPontos = novoTexto.indexOf(':');
  if (doisPontos === -1 || doisPontos === novoTexto.length - 1) {
    novo.setAttributes(0, novoTexto.length - 1, estiloInicio);
    return;
  }
  novo.setAttributes(0, doisPontos, estiloInicio);
  novo.setAttributes(doisPontos + 1, novoTexto.length - 1, estiloFim);
}

/**
 * Aplica edições { inicio, fim, texto } (calculadas por marcarTexto) num parágrafo, de trás para frente.
 * O texto novo é inserido logo DEPOIS do trecho antigo e só então o antigo é apagado: assim ele herda
 * a fonte, o tamanho e o negrito do que estava ali, e o resto da linha (o rótulo) não é tocado.
 */
function aplicarEdicoesParagrafo(paragrafo, edicoes) {
  edicoes.slice().sort(function (a, b) { return b.inicio - a.inicio; }).forEach(function (e) {
    var texto = paragrafo.editAsText();
    // Estilo do texto que estava ali (ou, numa inserção pura, do caractere logo antes).
    var estilo = estiloDoCaractere(texto, e.fim > e.inicio ? e.inicio : e.inicio - 1);
    if (e.texto) {
      if (e.fim >= texto.getText().length) anexarNoFim(paragrafo, e.texto);
      else texto.insertText(e.fim, e.texto);
    }
    if (e.fim > e.inicio) paragrafo.editAsText().deleteText(e.inicio, e.fim - 1);
    if (e.texto) aplicarEstilo(paragrafo.editAsText(), e.inicio, e.inicio + e.texto.length - 1, estilo);
  });
}

/**
 * Fonte, tamanho e negrito de um caractere (null se a posição não existe).
 * Negrito "herdado" (null) vira false: senão uma linha inserida logo depois de um título em negrito
 * (ex.: a 1ª linha do EXAME FÍSICO) pega o negrito do título.
 */
function estiloDoCaractere(texto, posicao) {
  if (posicao < 0 || posicao >= texto.getText().length) return null;
  return { tamanho: texto.getFontSize(posicao), fonte: texto.getFontFamily(posicao), negrito: texto.isBold(posicao) === true };
}

/**
 * Aplica explicitamente fonte, tamanho e negrito num trecho. Texto inserido pelo Apps Script nem sempre
 * herda o estilo do vizinho (ex.: a data do cabeçalho ficava sem tamanho; a 1ª linha do exame, em negrito).
 */
function aplicarEstilo(texto, inicio, fim, estilo) {
  if (!estilo || fim < inicio) return;
  if (estilo.tamanho) texto.setFontSize(inicio, fim, estilo.tamanho);
  if (estilo.fonte) texto.setFontFamily(inicio, fim, estilo.fonte);
  if (estilo.negrito !== null && estilo.negrito !== undefined) texto.setBold(inicio, fim, estilo.negrito);
}

/**
 * Põe texto no fim do parágrafo com o estilo do último trecho. (O appendText de paragrafo.editAsText()
 * escreve no fim do PRIMEIRO trecho: em "-NOME:" o nome iria parar depois do "-", em fonte 2.)
 */
function anexarNoFim(paragrafo, texto) {
  for (var i = paragrafo.getNumChildren() - 1; i >= 0; i--) {
    var filho = paragrafo.getChild(i);
    if (filho.getType() === DocumentApp.ElementType.TEXT) {
      filho.asText().appendText(texto);
      return;
    }
  }
  paragrafo.appendText(texto);
}

// ---------------------------------------------------------------------------
// Tabelas de prescrição
// ---------------------------------------------------------------------------

function linhaCabecalhoPrescricao(tabela) {
  for (var r = 0; r < tabela.getNumRows(); r++) {
    var linha = tabela.getRow(r);
    for (var c = 0; c < linha.getNumCells(); c++) {
      if (/PRESCRI[ÇC][ÃA]O\s+M[ÉE]DICA/i.test(linha.getCell(c).getText())) return r;
    }
  }
  return -1;
}

function ehTabelaPrescricao(tabela) {
  return linhaCabecalhoPrescricao(tabela) !== -1;
}

/** Índices das linhas 01, 02, 03... da tabela (depois da linha "Nº | PRESCRIÇÃO MÉDICA"). */
function linhasNumeradas(tabela) {
  var cabecalho = linhaCabecalhoPrescricao(tabela);
  var linhas = [];
  if (cabecalho === -1) return linhas;
  for (var r = cabecalho + 1; r < tabela.getNumRows(); r++) {
    var linha = tabela.getRow(r);
    if (linha.getNumCells() < 2) continue;
    if (ehLinhaNumerada(linha.getCell(0).getText(), linha.getCell(1).getText())) linhas.push(r);
  }
  return linhas;
}

/** Tabelas de prescrição na ordem do documento (puérpera: [mãe, RN]). */
function tabelasPrescricao(corpo) {
  var tabelas = [];
  var achado = null;
  while ((achado = corpo.findElement(DocumentApp.ElementType.TABLE, achado))) {
    var tabela = achado.getElement().asTable();
    if (ehTabelaPrescricao(tabela)) tabelas.push(tabela);
  }
  return tabelas;
}

/** Itens padrão do modelo: [{ indice (posição entre as linhas numeradas), rotulo único, ehDieta }]. */
function itensPadraoDaTabela(tabela) {
  var itens = [];
  linhasNumeradas(tabela).forEach(function (r, indice) {
    var texto = tabela.getRow(r).getCell(1).getText();
    if (!itemPrescricaoVazio(texto)) itens.push({ indice: indice, rotulo: rotuloItemPrescricao(texto) });
  });
  var unicos = rotulosUnicos(itens.map(function (item) { return item.rotulo; }));
  return itens.map(function (item, k) {
    return { indice: item.indice, rotulo: unicos[k], ehDieta: /^DIETA\b/i.test(item.rotulo) };
  });
}

/** Troca o 🆘 que a conversão do Word deixou pela seta "➔ ", mantendo a fonte do item. */
function trocarSimboloSeNecessario(celula) {
  var texto = celula.editAsText();
  var atual = texto.getText();
  var i;
  while ((i = atual.indexOf(SIMBOLO_SOS_CONVERTIDO)) !== -1) {
    texto.insertText(i, SETA_SE_NECESSARIO);
    texto.deleteText(i + SETA_SE_NECESSARIO.length, i + SETA_SE_NECESSARIO.length + SIMBOLO_SOS_CONVERTIDO.length - 1);
    atual = texto.getText();
  }
}

/** Deixa a célula com um único parágrafo com este texto, no estilo que a célula já tinha. */
function escreverTextoCelula(celula, texto) {
  while (celula.getNumChildren() > 1) celula.getChild(celula.getNumChildren() - 1).removeFromParent();
  var primeiro = celula.getChild(0);
  if (!ehParagrafo(primeiro)) {
    celula.setText(texto);
  } else if (texto) {
    comoParagrafo(primeiro).setText(texto);
  } else {
    comoParagrafo(primeiro).clear(); // o Docs não aceita setText('')
  }
}

/** Copia o conteúdo de uma célula (cópia solta, feita antes de mexer na tabela) para outra, com a formatação. */
function copiarConteudoCelula(origem, alvo) {
  var antigos = alvo.getNumChildren();
  for (var i = 0; i < origem.getNumChildren(); i++) {
    var filho = origem.getChild(i).copy();
    var tipo = filho.getType();
    if (tipo === DocumentApp.ElementType.PARAGRAPH) alvo.appendParagraph(filho.asParagraph());
    else if (tipo === DocumentApp.ElementType.LIST_ITEM) alvo.appendListItem(filho.asListItem());
    else if (tipo === DocumentApp.ElementType.TABLE) alvo.appendTable(filho.asTable());
  }
  if (alvo.getNumChildren() === antigos) return;
  for (var j = antigos - 1; j >= 0; j--) alvo.getChild(j).removeFromParent();
}

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

function escaparRegex(texto) {
  return String(texto).replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
}

/**
 * Para cada trecho que casa com "padrao" (regex em texto, no formato do findText), troca pelo que
 * novoTexto(trecho, elementoTexto) devolver. Junta tudo antes e troca de trás para frente,
 * para uma troca não atrapalhar a posição da próxima.
 */
function substituirOcorrencias(corpo, padrao, novoTexto) {
  var achados = [];
  var achado = null;
  while ((achado = corpo.findText(padrao, achado))) {
    achados.push({
      texto: achado.getElement().asText(),
      inicio: achado.getStartOffset(),
      fim: achado.getEndOffsetInclusive(),
    });
  }
  for (var i = achados.length - 1; i >= 0; i--) {
    var a = achados[i];
    var trecho = a.texto.getText().substring(a.inicio, a.fim + 1);
    var estilo = estiloDoCaractere(a.texto, a.inicio);
    var novo = novoTexto(trecho, a.texto);
    if (novo) {
      // Insere DEPOIS do marcador, apaga o marcador e aplica o estilo dele no texto novo.
      // (Inserido no início da célula, ele herdaria o estilo do parágrafo, que nos modelos às vezes é fonte 2.)
      if (a.fim + 1 >= a.texto.getText().length) a.texto.appendText(novo);
      else a.texto.insertText(a.fim + 1, novo);
      a.texto.deleteText(a.inicio, a.fim);
      aplicarEstilo(a.texto, a.inicio, a.inicio + novo.length - 1, estilo);
    } else {
      a.texto.deleteText(a.inicio, a.fim);
    }
  }
  return achados.length;
}

/** Parágrafo (ou item de lista) que contém este elemento de texto. */
function paragrafoDoTexto(elementoTexto) {
  var atual = elementoTexto;
  while (atual && !ehParagrafo(atual)) atual = atual.getParent();
  return atual ? comoParagrafo(atual) : null;
}

/** Insere linhas novas logo depois do parágrafo, copiando o estilo do fim dele. */
function inserirLinhasDepois(paragrafo, linhas) {
  var container = paragrafo.getParent();
  var indice = container.getChildIndex(paragrafo);
  var estilo = estiloDoCaractere(paragrafo.editAsText(), paragrafo.getText().length - 1);
  linhas.forEach(function (linha, k) {
    var novo = paragrafo.copy();
    novo.setText(linha);
    aplicarEstilo(novo.editAsText(), 0, linha.length - 1, estilo);
    if (novo.getType() === DocumentApp.ElementType.LIST_ITEM) container.insertListItem(indice + 1 + k, novo);
    else container.insertParagraph(indice + 1 + k, novo);
  });
}

/** Troca {{CHAVE}} pelo valor. Valores com várias linhas viram parágrafos seguidos. */
function preencherMarcador(corpo, chave, valor) {
  var linhas = dividirLinhas(valor);
  return substituirOcorrencias(corpo, '\\{\\{' + chave + '\\}\\}', function (_trecho, elementoTexto) {
    if (linhas.length > 1) {
      var paragrafo = paragrafoDoTexto(elementoTexto);
      if (paragrafo) inserirLinhasDepois(paragrafo, linhas.slice(1));
      else return linhas.join(' / ');
    }
    return linhas[0] || '';
  });
}

/**
 * Troca um bloco do documento (ex.: EXAME FÍSICO até CONDUTA) pelo texto digitado.
 * reInicio precisa ter 2 grupos: (rótulo)(texto na mesma linha). O bloco vai até a primeira linha que casa com reParada.
 * Linhas em branco no fim do bloco ficam, para manter o espaçamento. Devolve false se o bloco não existe.
 * estiloNovas: estilo das linhas novas quando o bloco do modelo não tem nenhuma linha de conteúdo para copiar.
 */
function substituirBloco(corpo, reInicio, reParada, linhas, estiloNovas) {
  var total = corpo.getNumChildren();
  var inicio = -1;
  var m = null;
  for (var i = 0; i < total; i++) {
    var elemento = corpo.getChild(i);
    if (!ehParagrafo(elemento)) continue;
    m = elemento.getText().trim().match(reInicio);
    if (m) { inicio = i; break; }
  }
  if (inicio === -1) return false;

  var paragrafoInicio = comoParagrafo(corpo.getChild(inicio));
  var conteudo = [];
  for (var j = inicio + 1; j < total; j++) {
    var proximo = corpo.getChild(j);
    if (!ehParagrafo(proximo) || reParada.test(proximo.getText().trim())) break;
    conteudo.push(comoParagrafo(proximo));
  }
  while (conteudo.length && conteudo[conteudo.length - 1].getText().trim() === '') conteudo.pop();

  var naMesmaLinha = (m[2] || '').trim() !== '';
  var restantes = linhas.slice();
  if (naMesmaLinha) {
    // Troca só o texto depois do rótulo ("CONDUTA: ..."), mantendo o rótulo e a formatação do modelo.
    var bruto = paragrafoInicio.getText();
    var fim = bruto.replace(/\s+$/, '').length;
    aplicarEdicoesParagrafo(paragrafoInicio, [{ inicio: fim - m[2].length, fim: fim, texto: restantes.shift() || '' }]);
  }
  var estiloBase = conteudo.length ? conteudo[0] : paragrafoInicio;
  var copiaEstilo = estiloBase.copy();
  var estiloTexto = estiloDoCaractere(estiloBase.editAsText(), 0);
  var usarEstiloNovas = !conteudo.length && estiloNovas;
  conteudo.forEach(function (paragrafo) { paragrafo.removeFromParent(); });

  var indice = corpo.getChildIndex(paragrafoInicio);
  restantes.forEach(function (linha, k) {
    var novo = copiaEstilo.copy();
    novo.setText(linha);
    aplicarEstilo(novo.editAsText(), 0, linha.length - 1, estiloTexto);
    if (usarEstiloNovas) {
      if (estiloNovas.alinhamento) novo.setAlignment(DocumentApp.HorizontalAlignment[estiloNovas.alinhamento]);
      var t = novo.editAsText();
      if (estiloNovas.tamanho) t.setFontSize(estiloNovas.tamanho);
      if (estiloNovas.negrito !== undefined) t.setBold(estiloNovas.negrito);
    }
    if (novo.getType() === DocumentApp.ElementType.LIST_ITEM) corpo.insertListItem(indice + 1 + k, novo);
    else corpo.insertParagraph(indice + 1 + k, novo);
  });
  return true;
}

function encontrarParagrafo(corpo, re) {
  for (var i = 0; i < corpo.getNumChildren(); i++) {
    var elemento = corpo.getChild(i);
    if (ehParagrafo(elemento) && re.test(elemento.getText().trim())) return comoParagrafo(elemento);
  }
  return null;
}

var BLOCOS = {
  EXAME_FISICO: {
    nome: 'EXAME FÍSICO',
    inicio: /^(EXAME\s+F[ÍI]SICO)\s*:?\s*(.*)$/i,
    parada: /^(CONDUTA|EXAME\s+(DO\s+)?RN|ASSINATURA)/i,
  },
  CONDUTA: {
    nome: 'CONDUTA',
    inicio: /^(CONDUTA)\s*:?\s*(.*)$/i,
    parada: /^/,
  },
  SOLICITACAO: {
    nome: 'SOLICITAÇÃO DE EXAMES',
    inicio: /^(SOLICITA[ÇC][ÃA]O(?:\s+DE\s+EXAMES)?)\s*:?\s*(.*)$/i,
    parada: /^ASSINATURA/i,
    // Como nos prontuários preenchidos: um exame por linha, 14 pt, sem negrito, alinhado à esquerda
    // (com o mesmo recuo do título "SOLICITAÇÃO").
    estiloNovas: { alinhamento: 'LEFT', tamanho: 14, negrito: false },
  },
};
