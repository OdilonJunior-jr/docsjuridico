# Documentos Jurídicos — V1.16

Sistema web para conferência de dados de cliente e geração de documentos jurídicos com Supabase, Next.js e armazenamento privado.

## Fluxo

1. Envie RG/CNH e comprovante de residência.
2. O sistema tenta extrair e conferir nome, CPF, RG e endereço.
3. Revise e corrija qualquer campo antes da geração.
4. Sem pessoa jurídica marcada: gera Procuração em DOCX + PDF.
5. Com pessoa jurídica marcada: abre os campos empresariais e gera também a Declaração de Hipossuficiência empresarial em DOCX + PDF.

O texto jurídico e os dados fixos da advogada permanecem nos modelos originais. Dados ausentes não são inventados.

## Revisão V1.16

- Pessoa jurídica passou a ser opcional e os campos empresariais só aparecem quando a opção é marcada.
- A declaração original é empresarial; por isso ela só é gerada quando os dados de pessoa jurídica estiverem habilitados e completos.
- Clientes salvos agora podem ser editados ou excluídos pela tela Clientes.
- A exclusão do cliente remove também os arquivos enviados e os documentos gerados daquele cliente.
- Documentos têm filtro por tipo, download por formato e exclusão com confirmação.
- Campos corrigidos manualmente deixam de aparecer como “extraídos”.
- A leitura de PDFs digitais passou a reconstruir linhas por posição para reduzir mistura de colunas em faturas/comprovantes.
- Parser de nome separado por contexto: identidade e comprovante usam regras diferentes.
- MRZ da CNH continua disponível para nome, mas é bloqueada explicitamente como fonte de RG.
- Nome de empresa, bairro e textos de certificado/Serpro são rejeitados como nome de pessoa.
- RG só é aceito quando passa por validação de formato; linhas de MRZ (`I<BRA...`) nunca entram como RG.
- Nacionalidade nunca aceita os rótulos `nationality / nacionalidad / nacionalidade`; só entra valor textual real, como `BRASILEIRO(A)`.
- Há uma segunda barreira no formulário para impedir que ruído de OCR seja marcado como dado extraído.
- Comprovante com CPF válido tem prioridade para confirmar o titular.
- ViaCEP só corrige o endereço quando cidade/UF são compatíveis, evitando sobrescrever um endereço por causa de CEP mal lido.
- Geração ganhou rollback de arquivos em caso de falha parcial.
- Ao reprocessar um rascunho, arquivos temporários anteriores são removidos para reduzir sobras no Storage.

## Banco existente

A V1.16 não exige nova migration. As tabelas e buckets já criados pela `001_initial.sql` continuam compatíveis.

## OCR de teste

A aplicação usa `OCRSPACE_API_KEY` quando configurada. Se não houver variável, mantém a chave pública de demonstração `helloworld`, adequada apenas para testes e sujeita a limites do fornecedor.

## Vercel

Mantenha as variáveis do Supabase já usadas pelo projeto. Não é necessário alterar o banco para subir esta versão.
