/** Publicação sobre o formulário existente; não cria outro formulário nem exclui respostas. */
function prepararAtualizacaoOnline() {
  var form = FormApp.openById(PROPS.getProperty('FORM_ID'));
  if (PROPS.getProperty('FORM_ESTADO_ANTES_ATUALIZACAO') === null) {
    PROPS.setProperty('FORM_ESTADO_ANTES_ATUALIZACAO', String(form.isAcceptingResponses()));
    PROPS.setProperty('RESPOSTAS_ANTES_ATUALIZACAO', String(form.getResponses().length));
  }
  form.setAcceptingResponses(false);
  console.log('Envios pausados durante a atualização; respostas anteriores preservadas.');
}

function atualizarVersaoOnline() {
  var trava = LockService.getScriptLock();
  trava.waitLock(30000);
  try {
    prepararAtualizacaoOnline();
    recriarModelosDoFormulario();
    atualizarFormulario();
    verificarAtualizacaoOnline();
    reabrirAposAtualizacao();
  } finally {
    // Se falhar, os envios continuam pausados até reparar e executar novamente.
    trava.releaseLock();
  }
}

function reabrirAposAtualizacao() {
  var form = FormApp.openById(PROPS.getProperty('FORM_ID'));
  form.setAcceptingResponses(PROPS.getProperty('FORM_ESTADO_ANTES_ATUALIZACAO') === 'true');
  PROPS.deleteProperty('FORM_ESTADO_ANTES_ATUALIZACAO');
  PROPS.setProperty('VERSAO_ONLINE', '2026-10-20-selecao-positiva');
  console.log('Atualização concluída. Formulário: ' + form.getPublishedUrl());
}

/** Execute até concluir: cada chamada prepara apenas um modelo e persiste o progresso. */
function migrarProximoModeloOnline() {
  var trava = LockService.getScriptLock();
  trava.waitLock(30000);
  try {
    var estado = lerJsonPropriedade('MIGRACAO_MODELOS_20261020', {ids:{},relatorio:[],carimbo:formatar(new Date(),'dd-MM-yyyy HH.mm')});
    if (estado.concluido) { verificarAtualizacaoOnline(); console.log('Migração já concluída.'); return; }
    prepararAtualizacaoOnline();
    var ordem = Object.keys(CONFIG.MODELOS);
    var chave = ordem.filter(function (k) { return !estado.ids[k]; })[0];
    console.log('Localizando pasta raiz.');
    var raiz = DriveApp.getFolderById(CONFIG.PASTA_RAIZ);
    console.log('Localizando pasta de modelos.');
    var pasta = obterOuCriarPasta(raiz, CONFIG.NOME_PASTA_MODELOS);
    if (chave) {
      console.log('Preparando modelo: ' + chave);
      var criado = criarModeloSeguro(chave, pasta, estado.carimbo);
      estado.ids[chave] = criado.id;
      estado.relatorio.push(criado.relatorio);
      PROPS.setProperty('MIGRACAO_MODELOS_20261020', JSON.stringify(estado));
      console.log('Modelo pronto: ' + chave + '. Progresso: ' + Object.keys(estado.ids).length + '/' + ordem.length);
    }
    if (Object.keys(estado.ids).length !== ordem.length) { console.log('Execute migrarProximoModeloOnline() novamente para continuar.'); return; }
    PROPS.setProperty('MODELOS', JSON.stringify(estado.ids));
    PROPS.setProperty('MODELOS_VERSAO', '2');
    console.log('Relatório: ' + escreverRelatorio(pasta, estado.carimbo, estado.relatorio));
    atualizarFormulario();
    verificarAtualizacaoOnline();
    reabrirAposAtualizacao();
    estado.concluido = true;
    PROPS.setProperty('MIGRACAO_MODELOS_20261020', JSON.stringify(estado));
  } finally { trava.releaseLock(); }
}

/** Diagnóstico somente de leitura do acesso à pasta utilizada na migração. */
function diagnosticarAtualizacaoOnline() {
  console.log('Início do acesso à raiz.');
  var raiz = DriveApp.getFolderById(CONFIG.PASTA_RAIZ);
  console.log('Referência da raiz obtida.');
  console.log('Nome da raiz: ' + raiz.getName());
  var pastas = raiz.getFoldersByName(CONFIG.NOME_PASTA_MODELOS);
  console.log('Consulta de subpastas preparada.');
  console.log('Pasta de modelos existente: ' + pastas.hasNext());
}

function verificarAtualizacaoOnline() {
  if (PROPS.getProperty('MODELOS_VERSAO') !== '2') throw new Error('Versão dos modelos não atualizada.');
  var ids = idsModelosFormulario();
  Object.keys(CONFIG.MODELOS).forEach(function (chave) {
    var corpo = DocumentApp.openById(ids[chave]).getBody();
    ['EXAME_FISICO', 'CONDUTA', 'DATA_NASCIMENTO'].forEach(function (campo) {
      // Nascimento pode usar o fallback no documento final; os blocos clínicos são obrigatórios no modelo.
      if (campo !== 'DATA_NASCIMENTO' && !corpo.findText('\\{\\{' + campo + '\\}\\}')) {
        throw new Error('Modelo ' + chave + ' sem o marcador ' + campo);
      }
    });
    tabelasPrescricao(corpo).forEach(function (tabela) {
      if (itensPadraoDaTabela(tabela).length) throw new Error('Modelo ' + chave + ' ainda contém itens de prescrição.');
    });
  });
  var mapa = lerJsonPropriedade('FORM_ITENS', {});
  var chaves = Object.keys(mapa).map(function (id) { return mapa[id]; });
  Object.keys(CONFIG.MODELOS).forEach(function (chave) {
    if (chaves.indexOf(chave + '.incluir') === -1) throw new Error('Seleção de inclusão ausente: ' + chave);
  });
  var form = FormApp.openById(PROPS.getProperty('FORM_ID'));
  console.log('Verificado: modelos sem prescrições herdadas, seleção positiva e ' + form.getResponses().length + ' respostas preservadas.');
}

/** Teste fictício, rastreável, sem e-mail e sempre na pasta de testes. */
function testarAtualizacaoOnline() {
  return executarTesteFicticioOnline({enfermaria:'Feminina', nome:'TESTE ATUALIZAÇÃO - PACIENTE FICTÍCIO'});
}

/** Confere a transferência de nascimento, conduta e exame do RN sem prescrever. */
function testarPuerperaOnline() {
  return executarTesteFicticioOnline({
    enfermaria:'Puérpera', nome:'TESTE PUÉRPERA - PACIENTE FICTÍCIO',
    data_nascimento:'1996-10-20', idade:'30 anos',
    conduta:'TESTE FICTÍCIO: CONDUTA DIGITADA PARA CONFERIR TRANSFERÊNCIA.',
    'PUERPERA.exame_rn':'TESTE FICTÍCIO: TEXTO DO RN PARA CONFERIR TRANSFERÊNCIA.',
  });
}

function executarTesteFicticioOnline(dados) {
  var mapa = lerJsonPropriedade('FORM_ITENS', {}), ids = {};
  Object.keys(mapa).forEach(function (id) { ids[mapa[id]] = Number(id); });
  var form = FormApp.openById(PROPS.getProperty('FORM_ID'));
  var agora = new Date();
  var resposta = {
    getId: function () { return 'TESTE-ATUALIZACAO-' + agora.getTime(); },
    getRespondentEmail: function () { return Session.getEffectiveUser().getEmail(); },
    getTimestamp: function () { return agora; },
    getItemResponses: function () { return Object.keys(dados).map(function (chave) {
      return {getItem:function () { return form.getItemById(ids[chave]); }, getResponse:function () { return dados[chave]; }};
    }); },
  };
  var modo = CONFIG.MODO_TESTE, email = CONFIG.ENVIAR_EMAIL, docx = CONFIG.GERAR_DOCX;
  try {
    CONFIG.MODO_TESTE = true; CONFIG.ENVIAR_EMAIL = false; CONFIG.GERAR_DOCX = false;
    var resultado = processarResposta(resposta);
    if (!resultado) throw new Error('A conta executora não está na lista de médicos permitidos.');
    console.log('TESTE FICTÍCIO SEM ENVIO DE E-MAIL: ' + resultado.url);
    return resultado;
  } finally { CONFIG.MODO_TESTE = modo; CONFIG.ENVIAR_EMAIL = email; CONFIG.GERAR_DOCX = docx; }
}
