/** Auditoria por resposta; os registros são acrescentados, nunca apagados. */
function planilhaDeRegistro() {
  var id = PROPS.getProperty('PLANILHA_ID');
  if (!id) throw new Error('Planilha de registro não configurada (PLANILHA_ID).');
  return SpreadsheetApp.openById(id);
}

function abaDeRegistro(nome, cabecalho) {
  var planilha = planilhaDeRegistro();
  var aba = planilha.getSheetByName(nome);
  if (!aba) {
    aba = planilha.insertSheet(nome);
    aba.appendRow(cabecalho);
  }
  return aba;
}

function registrarTentativa(contexto, estado, erro) {
  var aba = abaDeRegistro('Processamento', [
    'Registrado em', 'ID da resposta', 'Envio em', 'Estado', 'Enfermaria',
    'Documento', 'ID do documento', 'Quem preencheu', 'Detalhes',
  ]);
  aba.appendRow([
    new Date(), contexto.respostaId, contexto.quando, estado, contexto.enfermaria || '',
    contexto.documentoUrl || '', contexto.documentoId || '', contexto.email || '',
    erro ? String(erro.message || erro) : contexto.avisos.join(' | '),
  ]);
}

/** Guarda o vínculo assim que a cópia existe, antes de qualquer preenchimento ou exportação. */
function vincularDocumento(arquivo, contexto) {
  contexto.documentoId = arquivo.getId();
  contexto.documentoUrl = arquivo.getUrl();
  arquivo.setDescription('RESPOSTA_ID=' + contexto.respostaId);
  registrarTentativa(contexto, 'ARQUIVO_CRIADO');
}

/** Conciliação conservadora: diferenças de contagem não demonstram perda de respostas. */
function conciliarRegistros(respostas, documentos, tentativas, arquivos) {
  var linhas = [];
  function idDocumento(url) {
    var texto = String(url || '').trim();
    var m = texto.match(/\/d\/([^/?#]+)/) || texto.match(/[?&]id=([^&#]+)/);
    return m ? m[1] : texto.split(/[?#]/)[0].replace(/\/+$/, '');
  }
  respostas.forEach(function (resposta) {
    var historico = tentativas.filter(function (t) { return t.respostaId === resposta.id; });
    var ultimo = historico[historico.length - 1];
    var sucesso = historico.filter(function (t) { return t.estado === 'GERADO'; })[0];
    var vinculado = arquivos.filter(function (a) { return a.respostaId === resposta.id; })[0];
    var estado = sucesso ? 'GERADO' : ultimo ? ultimo.estado : 'SEM_VINCULO_VERIFICAVEL';
    if (!sucesso && ultimo && ultimo.url) estado = 'ARQUIVO_PARCIAL';
    if (!sucesso && !ultimo && vinculado) estado = 'ARQUIVO_VINCULADO_SEM_CONCLUSAO';
    linhas.push({tipo:'RESPOSTA', id:resposta.id, estado:estado, url:(sucesso || ultimo || vinculado || {}).url || '',
      detalhe: historico.length ? 'Confira o histórico de processamento.' : 'Sem histórico por ID. Conferir manualmente; não comprova perda.'});
  });
  arquivos.forEach(function (arquivo) {
    if (documentos.some(function (d) { return idDocumento(d.url) === arquivo.id; })) return;
    linhas.push({tipo:'ARQUIVO', id:arquivo.id, estado:'ARQUIVO_SEM_REGISTRO', url:arquivo.url,
      detalhe:arquivo.respostaId ? 'Vínculo declarado: ' + arquivo.respostaId : 'Sem ID de resposta; pode ser teste avulso ou arquivo histórico.'});
  });
  documentos.forEach(function (d) {
    if (!d.url || arquivos.some(function (a) { return a.id === idDocumento(d.url); })) return;
    linhas.push({tipo:'REGISTRO',id:idDocumento(d.url),estado:'NAO_LOCALIZADO_NO_ESCOPO',url:d.url,
      detalhe:'Link registrado, mas arquivo não encontrado nas pastas lidas. Conferir link e permissões; não demonstra exclusão.'});
  });
  return linhas;
}

/** Cria um relatório novo, sem alterar respostas, arquivos encontrados ou registros anteriores. */
function conciliarDocumentos() {
  var trava = LockService.getScriptLock();
  trava.waitLock(30000);
  try {
    var planilha = planilhaDeRegistro();
    function lerAba(nome) {
      var aba = planilha.getSheetByName(nome);
      return aba ? aba.getDataRange().getValues().slice(1) : [];
    }
    var respostas = FormApp.openById(PROPS.getProperty('FORM_ID')).getResponses().map(function (r) {
      return {id:r.getId()};
    });
    var documentos = lerAba('Documentos gerados').map(function (r) { return {url:String(r[3] || '')}; });
    var tentativas = lerAba('Processamento').map(function (r) { return {respostaId:String(r[1]),estado:r[3],url:r[5]}; });
    var arquivos = [], visitadas = {}, falhas = [];
    function percorrerPasta(pasta) {
      if (visitadas[pasta.getId()]) return;
      visitadas[pasta.getId()] = true;
      var docs = pasta.getFilesByType(MimeType.GOOGLE_DOCS);
      while (docs.hasNext()) {
        var arquivo = docs.next();
        var vinculo = String(arquivo.getDescription() || '').match(/(?:^|\n)RESPOSTA_ID=(.+)/);
        arquivos.push({id:arquivo.getId(),url:arquivo.getUrl(),respostaId:vinculo ? vinculo[1] : ''});
      }
      var pastas = pasta.getFolders();
      while (pastas.hasNext()) percorrerPasta(pastas.next());
    }
    CONFIG.ENFERMARIAS.forEach(function (e) {
      try { percorrerPasta(DriveApp.getFolderById(e.pastaId)); }
      catch (erro) { falhas.push({tipo:'ESCOPO',id:e.pastaId,estado:'LEITURA_INCOMPLETA',url:'',detalhe:String(erro.message || erro)}); }
    });
    var raiz = DriveApp.getFolderById(CONFIG.PASTA_RAIZ);
    var testes = raiz.getFoldersByName(CONFIG.NOME_PASTA_TESTES);
    while (testes.hasNext()) {
      try { percorrerPasta(testes.next()); }
      catch (erro) { falhas.push({tipo:'ESCOPO',id:'TESTES',estado:'LEITURA_INCOMPLETA',url:'',detalhe:String(erro.message || erro)}); }
    }
    var linhas = conciliarRegistros(respostas,documentos,tentativas,arquivos).concat(falhas);
    var relatorio = SpreadsheetApp.create('Conciliação de prontuários - ' + formatar(new Date(),'dd-MM-yyyy HH.mm.ss'));
    var aba = relatorio.getSheets()[0];
    aba.appendRow(['Tipo','ID','Estado','Documento','Observação']);
    aba.appendRow(['ESCOPO','','INFORMAÇÃO','','Pastas das enfermarias e pasta de testes. Arquivos fora dessas pastas não foram procurados. Não comprova perda de respostas.']);
    linhas.forEach(function (l) { aba.appendRow([l.tipo,l.id,l.estado,l.url,l.detalhe]); });
    DriveApp.getFileById(relatorio.getId()).moveTo(raiz);
    console.log('Conciliação: ' + relatorio.getUrl());
    return relatorio.getUrl();
  } finally { trava.releaseLock(); }
}
