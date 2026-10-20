# Correções de segurança — 20/10/2026

Decisão atual do usuário: seleção múltipla positiva dos itens que devem entrar na prescrição. A lista começa sem seleção; só opções escolhidas e itens adicionais digitados entram. O catálogo inicial contém apenas lembretes de documentação, sem medicamentos ou doses. Itens clínicos adicionais dependem de revisão médica. Esta decisão substitui a preferência inicial por digitação de todos os itens.

## Implementação e validação

- Reproduzir os comportamentos herdados em testes Node antes das correções.
- Remover padrões clínicos e achados obstétricos das novas cópias dos modelos. Campos vazios devem indicar ausência de registro e gerar aviso. Substituir blocos também dentro de tabelas; incluir no final qualquer campo cujo marcador esteja ausente.
- Esvaziar prescrições dos modelos e ignorar listas antigas de exclusão. Transferir somente dieta, opções revisadas explicitamente selecionadas e itens adicionais do atendimento. Receitas de alta e RN seguem a mesma seleção positiva. Perguntas de inclusão usam IDs novos; as de exclusão ficam guardadas em uma seção não percorrida pelo participante.
- Validar datas reais, ordem nascimento/admissão/envio, ano de admissão e idade com unidades. Para prescrição pediátrica/RN, exigir idade, peso positivo e indicação. Não calcular nem validar doses médicas automaticamente.
- Registrar cada tentativa com ID da resposta, estado e documento criado, inclusive falhas posteriores à cópia. Impedir geração quando o registro de auditoria não estiver disponível.
- Oferecer conciliação de respostas, registros e arquivos encontrados, sem excluir, recriar prontuários ou concluir perda a partir de contagens diferentes.
- Atualizar o formulário existente preservando IDs de perguntas e respostas. Registrar instruções de migração e limites da verificação local.
- Executar a suíte completa, revisar o diff e conferir a integração real quando o acesso ao Apps Script estiver disponível.

## Publicação conferida em 20/10/2026

O projeto online recebeu as correções com os IDs, e-mails e configurações existentes preservados. Os cinco modelos novos foram criados em etapas, o formulário foi atualizado e reaberto, e a conferência confirmou cinco respostas anteriores preservadas. `MODO_TESTE` permaneceu `true`.

Dois documentos fictícios foram gerados pelo fluxo com auditoria e sem e-mail. No primeiro, o exame vazio contém o aviso de ausência, sem achados normais, medicamentos herdados ou marcadores pendentes. No segundo, nascimento, conduta e exame do RN foram transferidos, sem os valores obstétricos antigos. A suíte local e a revisão independente terminaram com 53 testes passando.

A conferência real identificou e corrigiu também a comparação de links `open?id=…` na conciliação; o teste de regressão falhou antes da correção e passou depois. O relatório preliminar foi identificado como substituído, e a conciliação foi executada novamente. O relatório final aponta cinco respostas históricas sem vínculo verificável por ID e sete arquivos sem registro. Nenhum link registrado ficou sem arquivo no escopo lido. Esses arquivos exigem conferência manual; as contagens não comprovam perda de respostas.

## Limites históricos

O repositório contém IDs fictícios e nenhum modelo ou dado de paciente. Antes da correção, o formulário conservava prescrições padrão e cinco respostas, e o código publicado continha as causas de herança relatadas. O arquivo extra `Código.gs` contém `testeFeminina()`, que chama `gerarProntuario()` diretamente e não chama `registrar()`: uma explicação verificável para testes avulsos fora do registro, sem concluir a origem de cada arquivo ou perda de respostas. Essas chamadas diretas sem ID agora são bloqueadas. Documentos anteriores não foram reescritos. Sua revisão médica e a associação manual de registros históricos sem ID continuam necessárias.
