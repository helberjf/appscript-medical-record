# Atualização e conferência no Google Apps Script

As correções foram transferidas ao projeto Google e conferidas em 20/10/2026, mantendo o modo de teste. O formulário foi reaberto com as cinco respostas anteriores preservadas. Os modelos e documentos antigos permanecem guardados. Nenhuma dose foi revisada ou calculada pelo programa. O procedimento abaixo documenta a migração e sua conferência.

## Aplicar ao projeto existente

1. Preserve os IDs reais e os e-mails do `Config.gs` publicado. Não substitua esses valores pelos exemplos do repositório. Mantenha `MODO_TESTE: true` durante a conferência.
2. Atualize `Regras.gs`, `Documento.gs`, `Setup.gs` e `Preencher.gs` com os arquivos deste repositório. Adicione `Rastreio.gs` e `Atualizacao.gs`. Em `Config.gs`, use `SEM_DIETA` como primeira opção de `dietasDoFormulario()` e acrescente `ANO_MINIMO_ADMISSAO: 2000` (ajustável se houver internações anteriores legítimas). Configure `OPCOES_PRESCRICAO` conforme a seção abaixo.
3. Execute `migrarProximoModeloOnline()` até o log indicar conclusão. Cada execução cria uma nova cópia de um modelo, esvazia as prescrições, substitui conteúdos clínicos por marcadores, neutraliza os rótulos obstétricos identificados e salva o progresso. Os envios ficam pausados até terminar os cinco modelos e conferir a atualização do formulário; depois, o estado anterior de recebimento é restaurado. As versões antigas continuam no Drive. A versão de modelos exigida pelo código é `2`; não altere essa propriedade manualmente para liberar modelos antigos.
4. Abra o relatório e cada modelo novo. Confira o documento completo: a limpeza automática reconhece rótulos conhecidos e não substitui uma revisão humana de outros dados herdados. Confira também assinaturas, cabeçalhos e limites dos blocos.
5. A última etapa executa `atualizarFormulario()` e `verificarAtualizacaoOnline()`. A atualização preserva o formulário e suas respostas históricas. As perguntas antigas de exclusão ficam guardadas em uma seção ao final, que o participante não percorre: o formulário envia antes de chegar nela. As novas perguntas de inclusão têm IDs diferentes, para nunca interpretar exclusões antigas como inclusões. Também são adicionadas indicação do RN e prescrição de alta. Executar de novo não deve duplicá-las.
6. O arquivo avulso `Código.gs` observado no projeto publicado contém testes que chamam diretamente `gerarProntuario()`. Essas chamadas sem ID de resposta passam a ser bloqueadas antes de criar pastas. Para testar o fluxo completo, use o formulário com dados fictícios; não execute a rotina antiga `recriarETestar()` sem revisar sua adaptação.

A receita de alta passa a usar um documento novo com os itens digitados, nome, data e assinatura. O layout do antigo modelo fixo de alta não é reaproveitado.

## Seleção dos itens que entram

A pergunta “Itens para incluir na prescrição” permite selecionar vários itens e começa sem nada marcado. Apenas os escolhidos entram no documento. O campo de itens adicionais continua disponível.

Em `CONFIG.OPCOES_PRESCRICAO`, cadastre as listas de `MASCULINA`, `FEMININA`, `PSIQUIATRIA`, `PEDIATRIA`, `PUERPERA`, `RN` e `ALTA_PUERPERA`. Cada item usa `{ texto: 'TEXTO COMPLETO REVISADO PELO MÉDICO', revisado: true }`. O texto completo é exibido na seleção e transferido sem acrescentar doses. Revise indicação, dose, concentração, via e frequência e a adequação da opção à enfermaria/paciente antes de liberá-la. As doses problemáticas dos modelos antigos não são importadas automaticamente.

O catálogo começa apenas com lembretes de documentação: conferir alergias, registrar sinais vitais e reavaliação médica; para o RN, registrar sinais vitais e peso; na alta, registrar orientações médicas. Esses textos usam `tipo: 'registro'` e uma lista exata permitida pelo código. Não contêm medicamentos, doses ou autorização de alta e começam desmarcados. Medicamentos continuam dependendo de itens individualizados pelo médico. Listas vazias mostram um aviso para usar os itens adicionais; esse aviso nunca vira prescrição. Depois de mudar o catálogo, execute `atualizarFormulario()` para atualizar as opções. Seleções de uma versão antiga cujo texto mudou são bloqueadas, evitando trocar uma dose silenciosamente.

Selecionar itens clínicos em pediatria ou para o RN exige idade, peso e indicação do respectivo paciente, assim como a digitação de itens adicionais. Os lembretes de documentação não acionam essa exigência.

## Conferência em modo de teste

- Envie um atendimento fictício com exame físico, conduta e prescrição vazios. O exame deve indicar “SEM AVALIAÇÃO REGISTRADA — PREENCHER”; não devem aparecer afebril, Glasgow, alta ou medicamentos herdados. As células de prescrição ficam vazias e o aviso de ausência deve constar do registro/e-mail.
- Na puérpera, confira que dilatação, idade gestacional, BCF e dinâmica uterina antigos não reaparecem. Digite conduta, nascimento e exame do RN e verifique que todos foram transferidos. Campos sem marcador são acrescentados ao final com rótulo.
- Em pediatria/RN, informar itens sem idade, peso positivo ou indicação deve impedir a criação. A indicação do RN é própria do RN. Doses, concentração, via e frequência precisam de revisão médica em cada atendimento.
- Datas inexistentes ou futuras, admissão em 1900 e idade incompatível com nascimento devem impedir a geração. A idade é comparada com a data do envio e aceita número em anos, meses ou dias; sem unidade significa anos.
- Confira a aba `Processamento`: `INICIADA`, `ARQUIVO_CRIADO`, `GERADO`, `IGNORADA`, `ERRO`, `EMAIL_FALHOU` ou `DOCX_FALHOU`. Falhas depois da cópia devem conservar o ID/link do arquivo parcial. `Documentos gerados` continua com o formato antigo, para preservar sua leitura histórica.

Se `PLANILHA_ID` estiver ausente ou a auditoria falhar no início, nenhum documento será criado. Se falhar depois da cópia, consulte o histórico disponível e as execuções do Apps Script; não use o arquivo parcial sem revisão.

## Conciliar as respostas históricas

Execute `conciliarDocumentos()`. Ela cria uma planilha nova com respostas do Form, estados do processamento e documentos encontrados nas pastas das enfermarias e de testes. Não altera fontes nem gera prontuários de novo.

Respostas antigas sem histórico por ID recebem `SEM_VINCULO_VERIFICAVEL`. Arquivos sem entrada em `Documentos gerados` recebem `ARQUIVO_SEM_REGISTRO`; links registrados sem arquivo nas pastas lidas recebem `NAO_LOCALIZADO_NO_ESCOPO`. Falhas de leitura de pastas aparecem como `LEITURA_INCOMPLETA`. Arquivos fora dessas pastas não são procurados.

Para as cinco respostas e os registros históricos citados, confira manualmente horário, autoria e links quando não houver ID de vínculo. A rotina avulsa de teste identificada pode explicar arquivos sem registro; diferenças de contagem não demonstram perda de respostas.

Somente depois de conferir os documentos reais gerados e a revisão médica, mude `MODO_TESTE` para `false`. Os documentos anteriores não são reescritos automaticamente.
