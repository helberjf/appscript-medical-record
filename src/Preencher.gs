/**
 * Gatilho do formulário: a cada envio, cria a pasta do paciente (se não existir) e o documento preenchido.
 * Nunca apaga, renomeia ou sobrescreve nada: se já existe um arquivo com o mesmo nome, o novo ganha " (2)".
 */

function aoEnviarFormulario(evento) {
  var trava = LockService.getScriptLock();
  trava.waitLock(30000); // dois médicos enviando juntos não criam pastas repetidas
  try {
    processarResposta(evento.response);
  } catch (erro) {
    console.error(erro && erro.stack ? erro.stack : erro);
    avisarErro(evento.response, erro);
  } finally {
    trava.releaseLock();
  }
}

function formatar(data, padrao) {
  return Utilities.formatDate(data, CONFIG.FUSO, padrao);
}

function emailPermitido(email) {
  var permitidos = (CONFIG.ALLOWED_EMAILS.length ? CONFIG.ALLOWED_EMAILS : [Session.getEffectiveUser().getEmail()])
    .map(function (e) { return String(e).trim().toLowerCase(); });
  return !!email && permitidos.indexOf(String(email).trim().toLowerCase()) !== -1;
}

/** Respostas do Form como { chave: valor } usando o mapa de IDs gravado por criarFormulario(). */
function lerRespostas(resposta) {
  var mapa = JSON.parse(PROPS.getProperty('FORM_ITENS') || '{}');
  var valores = {};
  resposta.getItemResponses().forEach(function (itemResposta) {
    var chave = mapa[itemResposta.getItem().getId()];
    if (!chave) return;
    var valor = itemResposta.getResponse();
    valores[chave] = Array.isArray(valor) ? valor : String(valor === null || valor === undefined ? '' : valor).trim();
  });
  return valores;
}

function pastaDaEnfermaria(enfermaria) {
  if (!CONFIG.MODO_TESTE) return DriveApp.getFolderById(enfermaria.pastaId);
  var testes = obterOuCriarPasta(DriveApp.getFolderById(CONFIG.PASTA_RAIZ), CONFIG.NOME_PASTA_TESTES);
  return obterOuCriarPasta(testes, enfermaria.opcao);
}

/** Acha a pasta do paciente comparando sem acento/caixa/espaços extras; se não houver, cria. */
function obterOuCriarPastaPaciente(pastaEnfermaria, nome) {
  var procurado = normalizarNome(nome);
  var pastas = pastaEnfermaria.getFolders();
  while (pastas.hasNext()) {
    var pasta = pastas.next();
    if (normalizarNome(pasta.getName()) === procurado) return pasta;
  }
  return pastaEnfermaria.createFolder(nomeParaArquivo(nome));
}

function nomeLivre(pasta, base) {
  if (!pasta.getFilesByName(base).hasNext()) return base;
  for (var n = 2; ; n++) {
    var candidato = base + ' (' + n + ')';
    if (!pasta.getFilesByName(candidato).hasNext()) return candidato;
  }
}

function processarResposta(resposta) {
  var email = resposta.getRespondentEmail();
  if (!emailPermitido(email)) {
    console.warn('Resposta ignorada: e-mail fora da lista ALLOWED_EMAILS (' + (email || 'sem e-mail') + ').');
    return;
  }
  var r = lerRespostas(resposta);
  var enfermaria = CONFIG.ENFERMARIAS.filter(function (e) { return e.opcao === r.enfermaria; })[0];
  if (!enfermaria) throw new Error('Enfermaria desconhecida: ' + r.enfermaria);

  var quando = resposta.getTimestamp();
  var contexto = { hoje: formatar(quando, 'dd/MM/yyyy'), hora: formatar(quando, 'HH:mm'), email: email, avisos: [] };
  var resultado = enfermaria.receitaAlta
    ? gerarReceitaAlta(enfermaria, r, contexto)
    : gerarProntuario(enfermaria, r, contexto);

  registrar(quando, enfermaria, resultado, contexto);
  if (CONFIG.ENVIAR_EMAIL && email) {
    MailApp.sendEmail(
      email,
      'Documento criado – ' + CONFIG.TITULO_FORMULARIO,
      'Paciente: ' + resultado.nome + '\nEnfermaria: ' + enfermaria.opcao + '\n\nDocumento: ' + resultado.url +
      (contexto.avisos.length ? '\n\nAtenção:\n- ' + contexto.avisos.join('\n- ') : '') +
      (CONFIG.MODO_TESTE ? '\n\n(Modo de teste: o documento está na pasta "' + CONFIG.NOME_PASTA_TESTES + '".)' : '')
    );
  }
}

function gerarProntuario(enfermaria, r, contexto) {
  var nome = nomeParaArquivo(r.nome);
  if (!nome) throw new Error('Nome do paciente vazio.');
  var modelo = enfermaria.modelo;
  var pastaPaciente = obterOuCriarPastaPaciente(pastaDaEnfermaria(enfermaria), nome);
  var nomeArquivo = nomeLivre(pastaPaciente, nome + ' - ' + contexto.hoje);
  var copia = DriveApp.getFileById(idsModelosFormulario()[modelo]).makeCopy(nomeArquivo, pastaPaciente);
  var doc = DocumentApp.openById(copia.getId());
  var corpo = doc.getBody();

  // Prescrição
  var tabelas = tabelasPrescricao(corpo);
  if (!tabelas.length) contexto.avisos.push('Não achei a tabela de prescrição no modelo.');
  if (tabelas[0]) {
    aplicarPrescricao(tabelas[0], r[modelo + '.remover'], r[modelo + '.dieta'], r[modelo + '.adicionais'], 'PRESCRIÇÃO', contexto);
  }
  if (tabelas[1] && modelo === 'PUERPERA') {
    aplicarPrescricao(tabelas[1], r['PUERPERA.remover_rn'], '', r['PUERPERA.adicionais_rn'], 'PRESCRIÇÃO DO RN', contexto);
  }

  // Blocos com texto padrão: só mudam se o médico escreveu algo.
  [['EXAME_FISICO', r.exame_fisico], ['CONDUTA', r.conduta], ['SOLICITACAO', r.solicitacao]].forEach(function (par) {
    var linhas = dividirLinhas(par[1]);
    if (!linhas.length) return;
    var bloco = BLOCOS[par[0]];
    if (!substituirBloco(corpo, bloco.inicio, bloco.parada, linhas, bloco.estiloNovas)) {
      contexto.avisos.push('O modelo não tem o bloco "' + bloco.nome + '"; o texto digitado não entrou.');
    }
  });

  // Marcadores
  var padroes = lerJsonPropriedade('PADROES_' + modelo, {});
  var admissao = formatarDataResposta(r.data_admissao) || contexto.hoje;
  var valores = {
    NOME: nome,
    PRONTUARIO: r.prontuario,
    REGISTRO: r.registro,
    DATA: contexto.hoje,
    DATA_CABECALHO: dataCurta(contexto.hoje),
    HORA: contexto.hora,
    ENFERMARIA: enfermaria.textoEnfermaria,
    LEITO: r.leito,
    IDADE: r.idade,
    PESO: r.peso,
    DATA_ADMISSAO: admissao,
    DATA_NASCIMENTO: formatarDataResposta(r.data_nascimento),
    DIAS_INTERNACAO: diasEntre(admissao, contexto.hoje),
    HIPOTESE: r.hipotese,
    RELATO: r.relato,
    HPP: r.hpp || padroes.HPP,
    EVOLUCAO: r.evolucao || padroes.EVOLUCAO,
    EXAME_RN: r['PUERPERA.exame_rn'] || padroes.EXAME_RN,
    PRONTUARIO_RN: r['PUERPERA.prontuario_rn'],
    REGISTRO_RN: r['PUERPERA.registro_rn'],
    IDADE_RN: r['PUERPERA.idade_rn'],
    PESO_RN: r['PUERPERA.peso_rn'],
  };
  Object.keys(valores).forEach(function (chave) { preencherMarcador(corpo, chave, valores[chave] || ''); });
  // Qualquer marcador que tenha sobrado (ex.: criado à mão no modelo) não aparece no documento final.
  substituirOcorrencias(corpo, '\\{\\{[A-Z_0-9]+\\}\\}', function () { return ''; });

  doc.saveAndClose();
  if (CONFIG.GERAR_DOCX) salvarDocx(copia, pastaPaciente);
  return { nome: nome, url: doc.getUrl() };
}

/** Reescreve a coluna "PRESCRIÇÃO MÉDICA": padrão que ficou + dieta + adicionais, numerado sem buracos. */
function aplicarPrescricao(tabela, removidos, dieta, adicionais, titulo, contexto) {
  var itensPadrao = itensPadraoDaTabela(tabela);
  var entradas = montarPrescricao(itensPadrao, removidos || [], dieta, adicionais);
  var celulas = linhasNumeradas(tabela).map(function (r) { return tabela.getRow(r).getCell(1); });
  var copias = celulas.map(function (celula) { return celula.copy(); }); // foto da tabela antes de mexer

  celulas.forEach(function (celula, k) {
    var entrada = entradas[k];
    if (!entrada) escreverTextoCelula(celula, '');
    else if (entrada.tipo === 'texto') escreverTextoCelula(celula, entrada.texto);
    else if (entrada.indice !== k) copiarConteudoCelula(copias[entrada.indice], celula);
  });

  var sobra = entradas.slice(celulas.length);
  if (!sobra.length) return;
  var container = tabela.getParent();
  var indice = container.getChildIndex(tabela);
  var linhas = ['CONTINUAÇÃO DA ' + titulo + ':'].concat(sobra.map(function (entrada, k) {
    return numero2(celulas.length + k + 1) + ' – ' + (entrada.tipo === 'texto' ? entrada.texto : entrada.rotulo);
  }));
  linhas.forEach(function (linha, k) { container.insertParagraph(indice + 1 + k, linha); });
  contexto.avisos.push(
    'A ' + titulo.toLowerCase() + ' passou de ' + celulas.length + ' itens; ' + sobra.length +
    ' foram para "CONTINUAÇÃO" logo abaixo da tabela.'
  );
}

/** Receita de alta da puérpera: copia o Google Doc do hospital e coloca nome e data. */
function gerarReceitaAlta(enfermaria, r, contexto) {
  var nome = nomeParaArquivo(r['alta.nome']);
  if (!nome) throw new Error('Nome da puérpera vazio.');
  var pastaPaciente = obterOuCriarPastaPaciente(pastaDaEnfermaria(enfermaria), nome);
  var nomeArquivo = nomeLivre(pastaPaciente, 'RECEITA DE ALTA - ' + nome + ' - ' + contexto.hoje);
  var copia = DriveApp.getFileById(CONFIG.RECEITA_ALTA_PUERPERA_ID).makeCopy(nomeArquivo, pastaPaciente);
  var doc = DocumentApp.openById(copia.getId());
  var corpo = doc.getBody();

  var nomes = substituirOcorrencias(corpo, 'NOME DO PACIENTE:[ \\t]*', function () { return 'NOME DO PACIENTE: ' + nome; });
  if (!nomes) contexto.avisos.push('Não achei "NOME DO PACIENTE:" na receita de alta.');
  substituirOcorrencias(corpo, 'DATA:[ \\t]*\\d{1,2}/\\d{1,2}/\\d{4}', function () { return 'DATA: ' + contexto.hoje; });

  doc.saveAndClose();
  if (CONFIG.GERAR_DOCX) salvarDocx(copia, pastaPaciente);
  return { nome: nome, url: doc.getUrl() };
}

function salvarDocx(arquivo, pasta) {
  var url = 'https://docs.google.com/document/d/' + arquivo.getId() + '/export?format=docx';
  var blob = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } }).getBlob();
  pasta.createFile(blob.setName(nomeLivre(pasta, arquivo.getName() + '.docx')));
}

function registrar(quando, enfermaria, resultado, contexto) {
  var id = PROPS.getProperty('PLANILHA_ID');
  if (!id) return;
  var aba = SpreadsheetApp.openById(id).getSheetByName('Documentos gerados');
  if (aba) {
    aba.appendRow([quando, enfermaria.opcao, resultado.nome, resultado.url, contexto.email, contexto.avisos.join(' | ')]);
  }
}

function avisarErro(resposta, erro) {
  var email = resposta && resposta.getRespondentEmail();
  var dono = Session.getEffectiveUser().getEmail();
  var texto = 'Não consegui criar o documento desta resposta.\n\nErro: ' + (erro && erro.message ? erro.message : erro) +
    '\n\nA resposta está salva na planilha do formulário. Nada foi apagado.';
  // O dono sempre recebe; quem respondeu só se estiver na lista de médicos.
  var destinos = [dono];
  if (email && email !== dono && emailPermitido(email)) destinos.push(email);
  destinos.filter(Boolean).forEach(function (destino) {
    MailApp.sendEmail(destino, 'Erro ao criar documento – ' + CONFIG.TITULO_FORMULARIO, texto);
  });
}
