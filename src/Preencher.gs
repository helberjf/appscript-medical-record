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
    try { avisarErro(evento.response, erro); } catch (erroEmail) { console.error(erroEmail); }
    throw erro; // A execução precisa aparecer como falha no painel do Apps Script.
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

function prescricaoDaResposta(r, catalogo) {
  var rn = catalogo === 'RN', alta = catalogo === 'ALTA_PUERPERA';
  var prefixo = rn ? 'PUERPERA' : alta ? 'alta' : catalogo;
  return montarPrescricaoSelecionada(
    (CONFIG.OPCOES_PRESCRICAO || {})[catalogo],
    r[prefixo + (rn ? '.incluir_rn' : '.incluir')] || [],
    rn || alta ? '' : r[prefixo + '.dieta'],
    r[prefixo + (rn ? '.adicionais_rn' : alta ? '.prescricao' : '.adicionais')]
  );
}

function processarResposta(resposta) {
  var email = resposta.getRespondentEmail();
  var quando = resposta.getTimestamp();
  var contexto = {
    hoje: formatar(quando, 'dd/MM/yyyy'), hora: formatar(quando, 'HH:mm'), email: email, avisos: [],
    respostaId: resposta.getId(), quando: quando,
  };
  if (!contexto.respostaId) throw new Error('Resposta sem ID; não é possível rastrear a geração.');
  registrarTentativa(contexto, 'INICIADA'); // Se a auditoria falhar, não cria documento.
  var resultado, enfermaria;
  try {
    if (!emailPermitido(email)) {
      registrarTentativa(contexto, 'IGNORADA', 'E-mail não autorizado.');
      return;
    }
    var r = lerRespostas(resposta);
    contexto.enfermaria = r.enfermaria;
    enfermaria = CONFIG.ENFERMARIAS.filter(function (e) { return e.opcao === r.enfermaria; })[0];
    if (!enfermaria) throw new Error('Enfermaria desconhecida.');
    validarDadosResposta(r, contexto.hoje, enfermaria.modelo, CONFIG.ANO_MINIMO_ADMISSAO);
    if (!enfermaria.receitaAlta && PROPS.getProperty('MODELOS_VERSAO') !== '2') {
      throw new Error('Modelos antigos bloqueados. Rode recriarModelosDoFormulario() e atualizarFormulario().');
    }
    resultado = enfermaria.receitaAlta ? gerarReceitaAlta(enfermaria, r, contexto) : gerarProntuario(enfermaria, r, contexto);
    registrar(quando, enfermaria, resultado, contexto);
    registrarTentativa(contexto, 'GERADO');
  } catch (erro) {
    erro.documentoUrl = contexto.documentoUrl || '';
    try { registrarTentativa(contexto, 'ERRO', erro); } catch (erroRegistro) { console.error('Falha de auditoria: ' + erroRegistro); }
    throw erro;
  }
  if (CONFIG.GERAR_DOCX) {
    try { salvarDocx(DriveApp.getFileById(contexto.documentoId), DriveApp.getFolderById(resultado.pastaId)); }
    catch (erroDocx) {
      contexto.avisos.push('Google Doc criado, mas a exportação DOCX falhou.');
      registrarTentativa(contexto, 'DOCX_FALHOU', erroDocx);
    }
  }
  if (CONFIG.ENVIAR_EMAIL && email) {
    try { MailApp.sendEmail(
      email,
      'Documento criado – ' + CONFIG.TITULO_FORMULARIO,
      'Paciente: ' + resultado.nome + '\nEnfermaria: ' + enfermaria.opcao + '\n\nDocumento: ' + resultado.url +
      (contexto.avisos.length ? '\n\nAtenção:\n- ' + contexto.avisos.join('\n- ') : '') +
      (CONFIG.MODO_TESTE ? '\n\n(Modo de teste: o documento está na pasta "' + CONFIG.NOME_PASTA_TESTES + '".)' : '')
    ); } catch (erroEmail) { registrarTentativa(contexto, 'EMAIL_FALHOU', erroEmail); }
  }
  return resultado;
}

function gerarProntuario(enfermaria, r, contexto) {
  if (!contexto || !contexto.respostaId) throw new Error('Geração avulsa sem ID da resposta bloqueada para manter a rastreabilidade. Use processarResposta().');
  if (PROPS.getProperty('MODELOS_VERSAO') !== '2') throw new Error('Rode recriarModelosDoFormulario() antes de gerar documentos.');
  validarDadosResposta(r, contexto.hoje, enfermaria.modelo, CONFIG.ANO_MINIMO_ADMISSAO);
  var nome = nomeParaArquivo(r.nome);
  if (!nome) throw new Error('Nome do paciente vazio.');
  var modelo = enfermaria.modelo;
  var itensPrescricao = prescricaoDaResposta(r, modelo);
  var itensRn = modelo === 'PUERPERA' ? prescricaoDaResposta(r, 'RN') : [];
  var pastaPaciente = obterOuCriarPastaPaciente(pastaDaEnfermaria(enfermaria), nome);
  var nomeArquivo = nomeLivre(pastaPaciente, nome + ' - ' + contexto.hoje);
  var copia = DriveApp.getFileById(idsModelosFormulario()[modelo]).makeCopy(nomeArquivo, pastaPaciente);
  vincularDocumento(copia, contexto);
  var doc = DocumentApp.openById(copia.getId());
  var corpo = doc.getBody();
  prepararBlocosClinicos(corpo, modelo === 'PUERPERA');

  // Prescrição
  var tabelas = tabelasPrescricao(corpo);
  if (!tabelas.length) {
    corpo.appendParagraph('PRESCRIÇÃO:');
    itensPrescricao.forEach(function (e) { corpo.appendParagraph(e.texto); });
    contexto.avisos.push('Tabela de prescrição ausente; itens informados incluídos ao final.');
  }
  if (tabelas[0]) {
    aplicarPrescricao(tabelas[0], itensPrescricao, 'PRESCRIÇÃO', contexto);
  }
  if (tabelas[1] && modelo === 'PUERPERA') {
    aplicarPrescricao(tabelas[1], itensRn, 'PRESCRIÇÃO DO RN', contexto);
  }
  if (!tabelas[1] && modelo === 'PUERPERA' && itensRn.length) {
    corpo.appendParagraph('PRESCRIÇÃO DO RN:');
    itensRn.forEach(function (item) { corpo.appendParagraph(item.texto); });
    contexto.avisos.push('Tabela do RN ausente; prescrição do RN incluída ao final.');
  }

  // Todos os campos clínicos substituem o modelo, inclusive quando vazios.
  [['RELATO', r.relato], ['HPP', r.hpp], ['EVOLUCAO', r.evolucao], ['EXAME_FISICO', r.exame_fisico],
    ['CONDUTA', r.conduta], ['SOLICITACAO', r.solicitacao]].concat(modelo === 'PUERPERA' ? [['EXAME_RN', r['PUERPERA.exame_rn']]] : []).forEach(function (par) {
    preencherBlocoClinico(corpo, par[0], par[1], contexto);
  });

  // Marcadores
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
    PRONTUARIO_RN: r['PUERPERA.prontuario_rn'],
    REGISTRO_RN: r['PUERPERA.registro_rn'],
    IDADE_RN: r['PUERPERA.idade_rn'],
    PESO_RN: r['PUERPERA.peso_rn'],
    INDICACAO_RN: r['PUERPERA.indicacao_rn'],
  };
  Object.keys(valores).forEach(function (chave) { preencherCampoGarantido(corpo, chave, valores[chave], contexto); });
  substituirOcorrencias(corpo, '\\{\\{[A-Z_0-9]+\\}\\}', function (marcador) {
    contexto.avisos.push('Marcador sem valor: ' + marcador);
    return 'NÃO INFORMADO — PREENCHER';
  });

  doc.saveAndClose();
  return { nome: nome, url: doc.getUrl(), pastaId: pastaPaciente.getId() };
}

/** Reescreve a coluna "PRESCRIÇÃO MÉDICA" somente com dieta e itens informados no atendimento. */
function aplicarPrescricao(tabela, entradas, titulo, contexto) {
  var celulas = linhasNumeradas(tabela).map(function (r) { return tabela.getRow(r).getCell(1); });
  if (!entradas.length) contexto.avisos.push(titulo + ': sem itens informados; preencher após avaliação médica.');

  celulas.forEach(function (celula, k) {
    var entrada = entradas[k];
    if (!entrada) escreverTextoCelula(celula, '');
    else escreverTextoCelula(celula, entrada.texto);
  });

  var sobra = entradas.slice(celulas.length);
  if (!sobra.length) return;
  var container = tabela.getParent();
  var indice = container.getChildIndex(tabela);
  var linhas = ['CONTINUAÇÃO DA ' + titulo + ':'].concat(sobra.map(function (entrada, k) {
    return numero2(celulas.length + k + 1) + ' – ' + entrada.texto;
  }));
  linhas.forEach(function (linha, k) { container.insertParagraph(indice + 1 + k, linha); });
  contexto.avisos.push(
    'A ' + titulo.toLowerCase() + ' passou de ' + celulas.length + ' itens; ' + sobra.length +
    ' foram para "CONTINUAÇÃO" logo abaixo da tabela.'
  );
}

/** Receita sem medicamentos herdados: somente os itens informados para este atendimento. */
function gerarReceitaAlta(enfermaria, r, contexto) {
  if (!contexto || !contexto.respostaId) throw new Error('Geração avulsa sem ID da resposta bloqueada para manter a rastreabilidade. Use processarResposta().');
  var nome = nomeParaArquivo(r['alta.nome']);
  if (!nome) throw new Error('Nome da puérpera vazio.');
  var itens = prescricaoDaResposta(r, 'ALTA_PUERPERA');
  var pastaPaciente = obterOuCriarPastaPaciente(pastaDaEnfermaria(enfermaria), nome);
  var nomeArquivo = nomeLivre(pastaPaciente, 'RECEITA DE ALTA - ' + nome + ' - ' + contexto.hoje);
  var doc = DocumentApp.create(nomeArquivo);
  var copia = DriveApp.getFileById(doc.getId());
  vincularDocumento(copia, contexto);
  copia.moveTo(pastaPaciente);
  var corpo = doc.getBody();

  corpo.appendParagraph('RECEITA DE ALTA — REVISÃO E ASSINATURA MÉDICA OBRIGATÓRIAS');
  corpo.appendParagraph('NOME DO PACIENTE: ' + nome);
  corpo.appendParagraph('DATA: ' + contexto.hoje);
  corpo.appendParagraph('PRESCRIÇÃO:');
  var linhas = itens.map(function (item) { return item.texto; });
  if (!linhas.length) contexto.avisos.push('Receita de alta sem prescrição informada.');
  (linhas.length ? linhas : ['SEM PRESCRIÇÃO REGISTRADA — PREENCHER']).forEach(function (linha) { corpo.appendParagraph(linha); });
  corpo.appendParagraph('ASSINATURA MÉDICA: ____________________');

  doc.saveAndClose();
  return { nome: nome, url: doc.getUrl(), pastaId: pastaPaciente.getId() };
}

function salvarDocx(arquivo, pasta) {
  var url = 'https://docs.google.com/document/d/' + arquivo.getId() + '/export?format=docx';
  var blob = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } }).getBlob();
  pasta.createFile(blob.setName(nomeLivre(pasta, arquivo.getName() + '.docx')));
}

function registrar(quando, enfermaria, resultado, contexto) {
  var aba = abaDeRegistro('Documentos gerados', ['Quando', 'Enfermaria', 'Paciente', 'Documento', 'Quem preencheu', 'Avisos']);
  aba.appendRow([quando, enfermaria.opcao, resultado.nome, resultado.url, contexto.email, contexto.avisos.join(' | ')]);
}

function avisarErro(resposta, erro) {
  var email = resposta && resposta.getRespondentEmail();
  var dono = Session.getEffectiveUser().getEmail();
  var texto = 'O processamento desta resposta falhou.\n\nErro: ' + (erro && erro.message ? erro.message : erro) +
    (erro.documentoUrl ? '\n\nExiste um arquivo parcial: ' + erro.documentoUrl + '\nNão utilizar antes de conferir.' : '') +
    '\n\nID da resposta: ' + resposta.getId() + '\nConfira a resposta no formulário e o histórico na aba Processamento.';
  // O dono sempre recebe; quem respondeu só se estiver na lista de médicos.
  var destinos = [dono];
  if (email && email !== dono && emailPermitido(email)) destinos.push(email);
  destinos.filter(Boolean).forEach(function (destino) {
    MailApp.sendEmail(destino, 'Erro ao criar documento – ' + CONFIG.TITULO_FORMULARIO, texto);
  });
}
