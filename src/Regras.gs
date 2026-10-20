/**
 * Regras puras: só texto e listas, sem nenhuma API do Google.
 * São testadas fora do Apps Script com Node (veja testes/regras.test.js).
 */

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
 * "sufixo": usa _RN na tabela do RN. "padrao": guarda o valor do modelo para quando o campo vier vazio.
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
  { re: /^\s*HPP\s*:?[ \t]*/i, chave: 'HPP', padrao: true },
  { re: /^\s*EVOLU[ÇC][ÃA]O\s+CL[ÍI]NICA\s*:?[ \t]*/i, chave: 'EVOLUCAO', padrao: true },
  { re: /^\s*EXAME\s+(?:DO\s+)?RN\s*:?[ \t]*/i, chave: 'EXAME_RN', padrao: true },
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
    if (regra.padrao) padroes[regra.chave] = valor.trim();
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

function normalizarDieta(dieta) {
  var texto = String(dieta || '').replace(/\s+/g, ' ').trim();
  if (!texto || texto === MANTER_DIETA) return '';
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
 * Monta a prescrição final.
 * itensPadrao: [{ indice, rotulo, ehDieta }] na ordem do modelo (rotulo já único).
 * removidos: rótulos marcados em "Itens padrão a NÃO usar hoje".
 * Devolve [{ tipo: 'padrao', indice, rotulo } | { tipo: 'texto', texto }] sem buracos.
 */
function montarPrescricao(itensPadrao, removidos, dieta, adicionais) {
  var tirar = {};
  (removidos || []).forEach(function (rotulo) { tirar[String(rotulo).toUpperCase()] = true; });
  var novaDieta = normalizarDieta(dieta);
  var dietaUsada = false;
  var entradas = [];

  itensPadrao.forEach(function (item) {
    if (item.ehDieta && novaDieta && !dietaUsada) {
      entradas.push({ tipo: 'texto', texto: novaDieta });
      dietaUsada = true;
      return;
    }
    if (tirar[item.rotulo.toUpperCase()]) return;
    entradas.push({ tipo: 'padrao', indice: item.indice, rotulo: item.rotulo });
  });

  if (novaDieta && !dietaUsada) entradas.unshift({ tipo: 'texto', texto: novaDieta });

  dividirLinhas(adicionais).forEach(function (linha) {
    var texto = normalizarItemAdicional(linha);
    if (texto) entradas.push({ tipo: 'texto', texto: texto });
  });
  return entradas;
}
