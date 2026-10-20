/**
 * Prontuário pelo Google Forms
 *
 * REGRA DESTE SCRIPT: NÃO APAGA NADA.
 * Ele só cria pastas e arquivos novos. Nunca manda arquivo ou pasta para a lixeira,
 * nunca renomeia o que já existe e nunca altera os modelos originais (.docx).
 * As únicas edições acontecem dentro dos documentos novos que o próprio script acabou de criar.
 */

var CONFIG = {
  // Pasta principal (a que tem MASCULINA, FEMININA, PSIQUIATRIA...).
  PASTA_RAIZ: 'PASTE_ROOT_FOLDER_ID',

  // Modelos originais em .docx. O script só LÊ estes arquivos para criar cópias em Google Docs.
  MODELOS: {
    MASCULINA: { nome: 'Enfermaria Masculina', docxId: 'PASTE_MALE_WARD_TEMPLATE_DOCX_ID' },
    FEMININA: { nome: 'Enfermaria Feminina', docxId: 'PASTE_FEMALE_WARD_TEMPLATE_DOCX_ID' },
    PSIQUIATRIA: { nome: 'Psiquiatria', docxId: 'PASTE_PSYCHIATRY_TEMPLATE_DOCX_ID' },
    PEDIATRIA: { nome: 'Pediatria', docxId: 'PASTE_PEDIATRICS_TEMPLATE_DOCX_ID' },
    PUERPERA: { nome: 'Puérpera (mãe e RN)', docxId: 'PASTE_POSTPARTUM_TEMPLATE_DOCX_ID' },
  },

  // Google Doc da receita de alta da puérpera (só é copiado, nunca alterado).
  RECEITA_ALTA_PUERPERA_ID: 'PASTE_POSTPARTUM_DISCHARGE_GOOGLE_DOC_ID',

  // Opções da pergunta "Enfermaria" do Form: para qual pasta vai e qual modelo usa.
  ENFERMARIAS: [
    { opcao: 'Masculina', modelo: 'MASCULINA', pastaId: 'PASTE_MALE_WARD_FOLDER_ID', textoEnfermaria: 'MASCULINA' },
    { opcao: 'Feminina', modelo: 'FEMININA', pastaId: 'PASTE_FEMALE_WARD_FOLDER_ID', textoEnfermaria: 'FEMININA' },
    { opcao: 'Psiquiatria', modelo: 'PSIQUIATRIA', pastaId: 'PASTE_PSYCHIATRY_FOLDER_ID', textoEnfermaria: 'PSIQUIÁTRICA' },
    { opcao: 'Pediatria', modelo: 'PEDIATRIA', pastaId: 'PASTE_PEDIATRICS_FOLDER_ID', textoEnfermaria: 'PEDIATRIA' },
    { opcao: 'Puérpera', modelo: 'PUERPERA', pastaId: 'PASTE_POSTPARTUM_FOLDER_ID', textoEnfermaria: 'PUÉRPERA' },
    { opcao: 'Pronto Socorro – Masculino', modelo: 'MASCULINA', pastaId: 'PASTE_ER_MALE_FOLDER_ID', textoEnfermaria: 'PRONTO SOCORRO MASCULINO' },
    { opcao: 'Pronto Socorro – Feminino', modelo: 'FEMININA', pastaId: 'PASTE_ER_FEMALE_FOLDER_ID', textoEnfermaria: 'PRONTO SOCORRO FEMININO' },
    { opcao: 'Puérpera – receita de alta', receitaAlta: true, pastaId: 'PASTE_POSTPARTUM_FOLDER_ID', textoEnfermaria: 'PUÉRPERA' },
  ],

  // E-mails (Google) dos médicos que podem gerar documentos. Vazio = só a conta dona deste script.
  ALLOWED_EMAILS: [
    // 'medico1@gmail.com',
  ],

  // true = tudo vai para a pasta "_TESTES DO FORMULÁRIO" e não para as pastas das enfermarias.
  // Deixe true até conferir os primeiros documentos; depois troque para false.
  MODO_TESTE: true,

  // true = além do Google Doc, salva uma cópia .docx na pasta do paciente.
  GERAR_DOCX: false,

  // true = manda para o médico um e-mail com o link do documento criado.
  ENVIAR_EMAIL: true,

  FUSO: 'America/Sao_Paulo',
  NOME_PASTA_MODELOS: '_MODELOS DO FORMULÁRIO (não apagar)',
  NOME_PASTA_TESTES: '_TESTES DO FORMULÁRIO',
  TITULO_FORMULARIO: 'Prontuário – Hospital',
};

// Função (e não variável) porque o Apps Script não garante a ordem em que carrega os arquivos.
function dietasDoFormulario() {
  return [
    MANTER_DIETA,
    'DIETA ZERO',
    'DIETA ORAL LIVRE',
    'DIETA BRANDA',
    'DIETA PASTOSA',
    'DIETA LÍQUIDA',
    'DIETA ORAL PARA IDADE',
    'DIETA PARA DIABÉTICO',
    'DIETA HIPOSSÓDICA',
  ];
}
