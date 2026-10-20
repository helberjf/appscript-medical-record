/**
 * Regras puras: só texto e listas, sem nenhuma API do Google.
 * São testadas fora do Apps Script com Node (veja testes/regras.test.js).
 */

/**
 * Versão dos modelos de formulário exigida pelo código. Sobe quando a preparação dos modelos muda,
 * para bloquear documentos feitos a partir de modelos antigos até recriá-los.
 * 3: título "EVOLUÇÃO / EXAME FÍSICO" preservado; conduta/nascimento ausentes inseridos no lugar certo.
 */
var VERSAO_MODELOS = '3';

function semAcento(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Para comparar nomes de pasta: ignora acento, caixa e espaços extras (ex.: pasta " MARIA SILVA" com espaço no começo). */
function normalizarNome(texto) {
  return semAcento(texto).replace(/\s+/g, ' ').trim().toUpperCase();
}

/** Nome que vai na pasta e no arquivo: maiúsculas, mantendo os acentos. */
function nomeParaArquivo(texto) {
  return String(texto || '').replace(/\s+/g, ' ').trim().toUpperCase();
}

function numero2(n) {
  return (n < 10 ? '0' : '') + n;
}

/** Quebra um texto do Form em linhas não vazias. */
function dividirLinhas(texto) {
  return String(texto || '')
    .split(/\r?\n/)
    .map(function (linha) { return linha.trim(); })
    .filter(function (linha) { return linha !== ''; });
}

/** "2026-10-19" (resposta de data do Form) -> "19/10/2026". Outros formatos voltam como vieram. */
function formatarDataResposta(valor) {
  var texto = String(valor || '').trim();
  var m = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? m[3] + '/' + m[2] + '/' + m[1] : texto;
}

/** "19/10/2026" -> "19/10/26" (a data do cabeçalho da prescrição, como os médicos escrevem). */
function dataCurta(br) {
  var m = String(br || '').match(/^(\d{1,2})\/(\d{1,2})\/\d{2}(\d{2})$/);
  return m ? m[1] + '/' + m[2] + '/' + m[3] : String(br || '');
}

/** Dias entre duas datas "dd/mm/aaaa" (internação -> hoje). Nunca negativo. */
function diasEntre(inicioBr, fimBr) {
  function paraUtc(br) {
    var m = String(br || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
  }
  var inicio = paraUtc(inicioBr);
  var fim = paraUtc(fimBr);
  if (inicio === null || fim === null) return '';
  return String(Math.max(0, Math.round((fim - inicio) / 86400000)));
}

// ---------------------------------------------------------------------------
// Marcadores do modelo de formulário
// ---------------------------------------------------------------------------

/*
 * Os marcadores entram SEM reescrever a linha: o rótulo do modelo fica exatamente como está
 * (mesmo texto, fonte e negrito, ex.: "HPP :  ", "-NOME:") e só o valor de exemplo é trocado.
 * Por isso marcarTexto devolve "edicoes" ({ inicio, fim, texto } sobre o texto original),
 * que o Apps Script aplica com insertText/deleteText e o resto da linha não muda.
 */

/** Data sozinha numa célula (cabeçalho da prescrição). Os médicos escrevem só "19/10/26", sem "DATA:". */
var RE_DATA_CABECALHO = /^\s*DATA\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})?\s*$/i;

/**
 * Rótulos de uma linha inteira: "re" casa o rótulo, que fica; o resto da linha é o valor, que vira o marcador.
 * "sufixo": usa _RN na tabela do RN. Valores clínicos antigos nunca viram padrões.
 * "rotulo": troca também o rótulo (só no "IDAde" da pediatria). "depois": texto depois do marcador.
 */
var REGRAS_LINHA = [
  { re: /^\s*Prontu[áa]rio\s*:?[ \t]*/i, chave: 'PRONTUARIO', sufixo: true },
  { re: /^\s*Registro\s*:?[ \t]*/i, chave: 'REGISTRO', sufixo: true },
  { re: /^\s*HORA\s*:[ \t]*/i, chave: 'HORA' },
  { re: /^\s*ENFERMARIA\s*:[ \t]*/i, chave: 'ENFERMARIA' },
  { re: /^\s*LEITO\s*:?[ \t]*(?=.{0,15}$)/i, chave: 'LEITO' },
  { re: /^\s*IDADE?\s*:?[ \t]*(?=.{0,15}$)/i, chave: 'IDADE', sufixo: true, rotulo: 'IDADE: ' },
  { re: /^\s*PESO\s*:?[ \t]*(?=.{0,15}$)/i, chave: 'PESO', sufixo: true, depois: ' Kg' },
  { re: /^[-–—\\\s]*NOME\s+DO\s+PACIENTE\s*:?[ \t]*$/i, chave: 'NOME' },
  { re: /^[-–—\\\s]*NOME\s*:?[ \t]*$/i, chave: 'NOME' },
  { re: /^\s*RELATO\s+DE\s+INTERNA[ÇC][ÃA]O\s*:?[ \t]*/i, chave: 'RELATO' },
  { re: /^\s*HPP\s*:?[ \t]*/i, chave: 'HPP' },
  { re: /^\s*EVOLU[ÇC][ÃA]O\s+CL[ÍI]NICA\s*:?[ \t]*/i, chave: 'EVOLUCAO' },
  { re: /^\s*EXAME\s+(?:DO\s+)?RN\s*:?[ \t]*/i, chave: 'EXAME_RN' },
];

/** Rótulos que aparecem juntos na caixa da evolução, às vezes sem dois-pontos e com data ou número de exemplo. */
var RE_ROTULOS_INTERNACAO = /(DATA\s+DE\s+ADMISS[ÃA]O|DATA\s+DE\s+NASCIMENTO|DIAS\s+DE\s+INTERNA[ÇC][ÃA]O|HIP[ÓO]TESE\s+DIAGN[ÓO]STICA)([ \t]*:[ \t]*)?(\d{1,2}\/\d{1,2}\/\d{2,4}|\d+(?:[ \t]*DIAS?\b)?)?/gi;

var CHAVES_INTERNACAO = {
  'DATA DE ADMISSAO': 'DATA_ADMISSAO',
  'DATA DE NASCIMENTO': 'DATA_NASCIMENTO',
  'DIAS DE INTERNACAO': 'DIAS_INTERNACAO',
  'HIPOTESE DIAGNOSTICA': 'HIPOTESE',
};

/** Aplica as edições a uma string (o Apps Script faz o mesmo no documento, de trás para frente). */
function aplicarEdicoes(texto, edicoes) {
  var saida = String(texto);
  edicoes.slice().sort(function (a, b) { return b.inicio - a.inicio; }).forEach(function (e) {
    saida = saida.slice(0, e.inicio) + e.texto + saida.slice(e.fim);
  });
  return saida;
}

/** Edição que troca o valor depois de um rótulo, pondo ": " quando o rótulo não tem dois-pontos. */
function edicaoAposRotulo(original, rotulo, marcador) {
  if (rotulo.indexOf(':') !== -1) {
    return { inicio: rotulo.length, fim: original.length, texto: (/\s$/.test(rotulo) ? '' : ' ') + marcador };
  }
  var semEspaco = rotulo.replace(/\s+$/, '').length;
  return { inicio: semEspaco, fim: original.length, texto: ': ' + marcador };
}

/**
 * Onde pôr os {{MARCADORES}} numa linha do modelo.
 * Devolve { texto, edicoes, padroes }: texto é a linha já marcada; padroes guarda o texto padrão do modelo
 * (ex.: HPP "PREVIAMENTE HÍGIDO").
 */
function marcarTexto(texto, sufixo) {
  sufixo = sufixo || '';
  var original = String(texto || '');
  var padroes = {};
  var edicoes = [];
  var pronto = function () { return { texto: aplicarEdicoes(original, edicoes), edicoes: edicoes, padroes: padroes }; };

  if (original.indexOf('{{') !== -1 || !original.trim()) return pronto();

  if (RE_DATA_CABECALHO.test(original)) {
    edicoes.push({ inicio: 0, fim: original.length, texto: '{{DATA_CABECALHO}}' });
    return pronto();
  }

  for (var i = 0; i < REGRAS_LINHA.length; i++) {
    var regra = REGRAS_LINHA[i];
    var m = original.match(regra.re);
    if (!m) continue;
    var marcador = '{{' + regra.chave + (regra.sufixo ? sufixo : '') + '}}';
    var valor = original.slice(m[0].length);
    if (regra.rotulo) {
      edicoes.push({ inicio: 0, fim: original.length, texto: regra.rotulo + marcador + (regra.depois || '') });
      return pronto();
    }
    // Na psiquiatria o HPP está na mesma linha do relato ("RELATO DE INTERNAÇÃO : HPP").
    if (regra.chave === 'RELATO' && /\bHPP\b/i.test(valor)) marcador += '     HPP: {{HPP}}';
    var edicao = edicaoAposRotulo(original, m[0], marcador + (regra.depois || ''));
    edicoes.push(edicao);
    return pronto();
  }

  var re = new RegExp(RE_ROTULOS_INTERNACAO.source, 'gi');
  var m2;
  while ((m2 = re.exec(original))) {
    var chave = CHAVES_INTERNACAO[normalizarNome(m2[1])];
    var fimRotulo = m2.index + m2[1].length;
    var inicio, fimValor, novo;
    if (m2[3]) {
      // Tem valor de exemplo: troca só o valor (o espaço entre ":" e o valor fica como no modelo).
      inicio = fimRotulo + m2[2].length;
      fimValor = inicio + m2[3].length;
      novo = '{{' + chave + '}}';
    } else if (m2[2]) {
      // Sem valor: entra logo depois de ": ", antes da tabulação que separa do próximo rótulo.
      var doisPontos = fimRotulo + m2[2].indexOf(':') + 1;
      inicio = fimValor = doisPontos + (original.charAt(doisPontos) === ' ' ? 1 : 0);
      novo = (original.charAt(doisPontos) === ' ' ? '' : ' ') + '{{' + chave + '}}';
    } else {
      inicio = fimValor = fimRotulo;
      novo = ': {{' + chave + '}}';
    }
    if (fimValor < original.length && !/\s/.test(original.charAt(fimValor))) novo += ' ';
    edicoes.push({ inicio: inicio, fim: fimValor, texto: novo });
  }

  var reData = /\bDATA[ \t]*:[ \t]*(\d{1,2}\/\d{1,2}\/\d{2,4})?/g;
  var m3;
  while ((m3 = reData.exec(original))) {
    var fimData = m3.index + m3[0].length;
    var inicioData = fimData - (m3[1] ? m3[1].length : 0);
    edicoes.push({ inicio: inicioData, fim: fimData, texto: (/\s$/.test(original.slice(0, inicioData)) ? '' : ' ') + '{{DATA}}' });
  }
  return pronto();
}

// ---------------------------------------------------------------------------
// Prescrição
// ---------------------------------------------------------------------------

/** Seta da fonte Wingdings ("se necessário"): no .docx é "ð"; convertida para Google Docs vira o emoji 🆘. */
var SIMBOLO_SOS_CONVERTIDO = '\uD83C\uDD98';
var SETA_SE_NECESSARIO = '➔ ';

/** "ðDIPIRONA 1G ...", "🆘DIPIRONA..." ou "➔ DIPIRONA..." -> "DIPIRONA 1G ...". */
function rotuloItemPrescricao(texto) {
  return String(texto || '')
    .split(SIMBOLO_SOS_CONVERTIDO).join('')
    .replace(/^[\sðÐ➔→►\-•]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function itemPrescricaoVazio(texto) {
  return rotuloItemPrescricao(texto).replace(/[.\-_\s]/g, '') === '';
}

/** Linha numerada da tabela de prescrição (01, 02...). A linha "24 | VIDE VERSO" da pediatria não conta. */
function ehLinhaNumerada(numero, item) {
  return /^\d{1,2}$/.test(String(numero || '').trim()) && !/VIDE\s+VERSO/i.test(String(item || ''));
}

/** Rótulos únicos para as caixas do Form: repetidos ganham " (2)", " (3)"... */
function rotulosUnicos(rotulos) {
  var vistos = {};
  return rotulos.map(function (rotulo) {
    var chave = rotulo.toUpperCase();
    vistos[chave] = (vistos[chave] || 0) + 1;
    return vistos[chave] === 1 ? rotulo : rotulo + ' (' + vistos[chave] + ')';
  });
}

var MANTER_DIETA = 'Manter a do modelo';
var SEM_DIETA = 'Sem dieta informada';
var SEM_OPCOES_PRESCRICAO = 'Nenhuma opção liberada — use o campo de itens adicionais';
var OPCOES_REGISTRO = ['CONFERIR E REGISTRAR ALERGIAS', 'REGISTRAR SINAIS VITAIS', 'REGISTRAR REAVALIAÇÃO MÉDICA', 'REGISTRAR PESO DO RN', 'REGISTRAR ORIENTAÇÕES MÉDICAS DE ALTA'];

function normalizarDieta(dieta) {
  var texto = String(dieta || '').replace(/\s+/g, ' ').trim();
  if (!texto || texto === MANTER_DIETA || texto === SEM_DIETA) return '';
  texto = texto.toUpperCase();
  return /^DIETA\b/.test(texto) ? texto : 'DIETA ' + texto;
}

/** "1- dipirona", "02. dipirona", "- dipirona" -> "DIPIRONA". */
function normalizarItemAdicional(linha) {
  return String(linha || '')
    .replace(/^\s*(?:\d{1,2}\s*[-.)–]\s*|[-•*]\s*)/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * Somente dieta e itens informados neste atendimento. Os dois primeiros argumentos
 * continuam aceitos para compatibilidade com formulários antigos, mas nunca autorizam padrões.
 */
function montarPrescricao(itensPadrao, removidos, dieta, adicionais) {
  var novaDieta = normalizarDieta(dieta);
  var entradas = [];
  if (novaDieta) entradas.push({ tipo: 'texto', texto: novaDieta });

  dividirLinhas(adicionais).forEach(function (linha) {
    var texto = normalizarItemAdicional(linha);
    if (texto) entradas.push({ tipo: 'texto', texto: texto });
  });
  return entradas;
}

/** Somente opções explicitamente liberadas após revisão médica podem ser selecionadas. */
function itensRevisadosPrescricao(catalogo) {
  return (catalogo || []).filter(function (item) {
    return item && (item.revisado === true || (item.tipo === 'registro' && OPCOES_REGISTRO.indexOf(String(item.texto || '').trim()) !== -1)) && String(item.texto || '').trim();
  }).map(function (item) { return String(item.texto).trim(); });
}

/** Lista positiva: não selecionar nada nunca autoriza itens do catálogo. */
function montarPrescricaoSelecionada(catalogo, selecionados, dieta, adicionais) {
  selecionados = selecionados || [];
  if (!Array.isArray(selecionados)) throw new Error('Seleção de prescrição inválida.');
  var disponiveis = itensRevisadosPrescricao(catalogo);
  selecionados.forEach(function (item) {
    if (item !== SEM_OPCOES_PRESCRICAO && disponiveis.indexOf(item) === -1) {
      throw new Error('Opção de prescrição não revisada ou alterada. Atualize o formulário e selecione novamente.');
    }
  });
  var entradas = montarPrescricao([], [], dieta, '');
  disponiveis.filter(function (item, i) {
    return selecionados.indexOf(item) !== -1 && disponiveis.indexOf(item) === i;
  }).forEach(function (item) { entradas.push({tipo:'texto', texto:item}); });
  return entradas.concat(montarPrescricao([], [], '', adicionais));
}

function haSelecaoPrescricao(valor) {
  return Array.isArray(valor) && valor.some(function (item) { return item !== SEM_OPCOES_PRESCRICAO && OPCOES_REGISTRO.indexOf(item) === -1; });
}

/** Remove os valores de linhas obstétricas identificadas, inclusive vários rótulos na mesma linha. */
function limparLinhaObstetrica(texto) {
  var original = String(texto || '');
  var re = /\b(Dilata[çc][ãa]o|Apagamento|Idade\s+Gestacional|Hist[óo]ria\s+Gestacional|BCF|Din[âa]mica\s+Uterina|Toque\s+Vaginal|IG|DU)\s*[:=]\s*/gi;
  var achados = [], m;
  while ((m = re.exec(original))) achados.push({inicio: re.lastIndex, rotulo: m.index});
  var edicoes = achados.map(function (a, i) {
    var fim = i + 1 < achados.length ? achados[i + 1].rotulo : original.length;
    var separador = original.slice(a.inicio, fim).match(/\s*(?:\/\/|;)\s*$/);
    return {inicio: a.inicio, fim: fim, texto: 'NÃO INFORMADO — PREENCHER' + (separador ? separador[0] : (i + 1 < achados.length ? ' ' : ''))};
  });
  return aplicarEdicoes(original, edicoes);
}

/** Datas ISO ou brasileiras com ano completo; não aceita o ajuste automático de 31/02 do Date. */
function dataRespostaUtc(valor) {
  var texto = formatarDataResposta(valor);
  var m = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  var dia = Number(m[1]), mes = Number(m[2]), ano = Number(m[3]);
  if (ano < 1000) return null;
  var data = new Date(Date.UTC(ano, mes - 1, dia));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia ? data : null;
}

/**
 * Idade como os médicos escrevem: "66", "66 anos", "1 ano e 3 meses", "1a 3m", "3 meses e 10 dias", "15d".
 * Devolve { anos, meses, dias, menor } (menor = menor unidade informada) ou null se não entender.
 * Unidades fora de ordem ou repetidas ("3 meses 1 ano") são recusadas para não haver ambiguidade.
 */
function lerIdade(valor) {
  var texto = semAcento(String(valor || '')).trim().toLowerCase();
  if (/^\d+$/.test(texto)) return {anos: Number(texto), meses: 0, dias: 0, menor: 'anos'};
  var resto = texto.replace(/\s*(?:,|\be\b)\s*/g, ' ').trim();
  var ordem = ['anos', 'meses', 'dias'], partes = {anos: 0, meses: 0, dias: 0}, ultima = -1, m;
  while (resto && (m = resto.match(/^(\d+)\s*(anos|ano|a|meses|mes|m|dias|dia|d)(?![a-z])\s*/))) {
    var unidade = /^a/.test(m[2]) ? 'anos' : /^m/.test(m[2]) ? 'meses' : 'dias';
    if (ordem.indexOf(unidade) <= ultima) return null;
    partes[unidade] = Number(m[1]);
    ultima = ordem.indexOf(unidade);
    resto = resto.slice(m[0].length);
  }
  if (resto || ultima === -1) return null;
  partes.menor = ordem[ultima];
  return partes;
}

/** Idade exata entre duas datas UTC: { anos, meses, dias } do calendário, mais totais em meses e dias. */
function idadeExata(nascimento, referencia) {
  var anos = referencia.getUTCFullYear() - nascimento.getUTCFullYear();
  var meses = referencia.getUTCMonth() - nascimento.getUTCMonth();
  var dias = referencia.getUTCDate() - nascimento.getUTCDate();
  if (dias < 0) {
    meses--;
    dias += new Date(Date.UTC(referencia.getUTCFullYear(), referencia.getUTCMonth(), 0)).getUTCDate();
  }
  if (meses < 0) { anos--; meses += 12; }
  return {anos: anos, meses: meses, dias: dias, totalMeses: anos * 12 + meses,
    totalDias: Math.floor((referencia - nascimento) / 86400000)};
}

/** A idade digitada bate com o nascimento? Compara na menor unidade informada; em dias aceita ±1. */
function idadeConfere(idade, nascimento, referencia) {
  var exata = idadeExata(nascimento, referencia);
  if (idade.menor === 'anos') return idade.anos === exata.anos;
  if (idade.menor === 'meses') return idade.anos * 12 + idade.meses === exata.totalMeses;
  if (!idade.anos && !idade.meses) return Math.abs(idade.dias - exata.totalDias) <= 1;
  return idade.anos * 12 + idade.meses === exata.totalMeses && Math.abs(idade.dias - exata.dias) <= 1;
}

/**
 * Mesmos formatos de lerIdade, como expressão regular do Google Forms (RE2, sem lookaround).
 * Barra a digitação errada no próprio formulário, antes do envio.
 */
var UNIDADE_IDADE_FORM = '(?:[Aa](?:[Nn][Oo][Ss]?)?|[Mm](?:[EeÊê][Ss](?:[Ee][Ss])?)?|[Dd](?:[Ii][Aa][Ss]?)?)';
var PADRAO_IDADE_FORM = '^\\s*\\d+\\s*(?:' + UNIDADE_IDADE_FORM +
  '(?:\\s*(?:,|\\s[Ee])?\\s*\\d+\\s*' + UNIDADE_IDADE_FORM + ')*)?\\s*$';
var PADRAO_PESO_FORM = '^\\s*\\d+(?:[.,]\\d+)?\\s*$';

/** Data do atendimento ("dd/mm/aaaa"): a informada no Form ou, se vazia, a data do envio. */
function dataAtendimentoBr(r, envioBr) {
  return formatarDataResposta(r.data_atendimento) || envioBr;
}

/** "9:05" ou "09:05" -> "09:05"; outros formatos voltam vazios. */
function normalizarHora(valor) {
  var m = String(valor || '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? numero2(Number(m[1])) + ':' + m[2] : '';
}

/** Quantos dias antes do envio o atendimento pode ser registrado (pega ano digitado errado). */
var DIAS_MAXIMOS_ATRASO_ATENDIMENTO = 31;

function pesoValido(valor) {
  var texto = String(valor || '').trim().replace(',', '.');
  return /^\d+(?:\.\d+)?$/.test(texto) && Number(texto) > 0;
}

/** Bloqueia dados contraditórios antes de criar qualquer documento. Não valida indicação ou dose clínica. */
function validarDadosResposta(r, hojeBr, modelo, anoMinimoAdmissao) {
  var hoje = dataRespostaUtc(hojeBr);
  if (!hoje) throw new Error('Data de referência inválida.');
  // Data do atendimento: a referência do documento (cabeçalho, dias de internação e idade).
  var atendimentoBr = dataAtendimentoBr(r, hojeBr);
  var atendimento = dataRespostaUtc(atendimentoBr);
  if (!atendimento || atendimento > hoje || (hoje - atendimento) / 86400000 > DIAS_MAXIMOS_ATRASO_ATENDIMENTO) {
    throw new Error('Data do atendimento inválida, futura ou com mais de ' + DIAS_MAXIMOS_ATRASO_ATENDIMENTO +
      ' dias antes do envio; confira dia, mês e ano.');
  }
  if (r.hora_atendimento && !normalizarHora(r.hora_atendimento)) throw new Error('Hora do atendimento inválida.');
  var admissao = dataRespostaUtc(r.data_admissao || atendimentoBr);
  var nascimento = r.data_nascimento ? dataRespostaUtc(r.data_nascimento) : null;
  if (!admissao || admissao.getUTCFullYear() < (anoMinimoAdmissao || 2000) || admissao > atendimento) {
    throw new Error('Data de admissão inválida, antiga ou posterior ao atendimento; corrija o ano e a data.');
  }
  if (r.data_nascimento && (!nascimento || nascimento > hoje || nascimento > admissao)) {
    throw new Error('Data de nascimento inválida ou posterior à admissão/envio.');
  }
  var idade = r.idade ? lerIdade(r.idade) : null;
  if (r.idade && !idade) throw new Error('Idade inválida. Exemplos: 66, 66 anos, 1 ano e 3 meses, 15 dias.');
  if (idade && nascimento && !idadeConfere(idade, nascimento, atendimento)) {
    throw new Error('Idade incompatível com a data de nascimento na data do atendimento.');
  }
  ['peso', 'PUERPERA.peso_rn'].forEach(function (chave) {
    if (r[chave] && !pesoValido(r[chave])) throw new Error('Peso inválido; informe um número positivo em kg.');
  });
  var idadeRn = r['PUERPERA.idade_rn'];
  if (idadeRn && !lerIdade(idadeRn)) throw new Error('Idade do RN inválida. Exemplos: 2 dias, 1 mês e 5 dias.');
  if (modelo === 'PEDIATRIA' && (dividirLinhas(r['PEDIATRIA.adicionais']).length || haSelecaoPrescricao(r['PEDIATRIA.incluir'])) &&
      (!(idade || nascimento) || !pesoValido(r.peso) || !String(r.hipotese || '').trim())) {
    throw new Error('Prescrição pediátrica exige idade/nascimento, peso e indicação neste atendimento.');
  }
  if (modelo === 'PUERPERA' && (dividirLinhas(r['PUERPERA.adicionais_rn']).length || haSelecaoPrescricao(r['PUERPERA.incluir_rn'])) &&
      (!lerIdade(idadeRn) || !pesoValido(r['PUERPERA.peso_rn']) || !String(r['PUERPERA.indicacao_rn'] || '').trim())) {
    throw new Error('Prescrição do RN exige idade, peso e indicação do RN neste atendimento.');
  }
}
