# Sistema de Documentos Jurídicos — V1.11

Versão de teste pronta para GitHub → Vercel, mantendo Supabase, autenticação, RLS e storage privado.

## O que mudou
- OCR automático com OCR.Space no servidor.
- Duas leituras (Engine 3 + Engine 2 quando disponível) para reduzir nomes/endereço com letras faltando.
- CEP reconhecido é conferido no ViaCEP para normalizar logradouro, bairro, cidade e UF.
- Procuração e Declaração de Hipossuficiência são geradas juntas.
- Saída simultânea em Word (.docx) e PDF: 4 arquivos por geração.
- PDF é gerado pelo próprio projeto, sem depender de Gotenberg.
- Espaçamento dos modelos DOCX foi ajustado para manter o conteúdo variável dentro das áreas originais e evitar página em branco adicional.
- Texto jurídico e dados fixos da advogada não foram alterados.

## Fluxo
1. Login.
2. Novo documento.
3. Envie RG/CNH + comprovante de residência.
4. Extraia e confira os dados.
5. Preencha somente os dados ausentes e os dados da pessoa jurídica exigidos pelo modelo da declaração.
6. Clique em **Gerar os 2 documentos — Word + PDF**.
7. Baixe Procuração DOCX/PDF e Declaração DOCX/PDF.

## Observação sobre a leitura
O sistema nunca deve inventar informação ausente. CNH/RG e comprovante normalmente não trazem estado civil, profissão e dados da empresa; esses campos devem permanecer vazios até preenchimento/conferência humana.

## OCR de teste
A aplicação usa `OCRSPACE_API_KEY` se ela existir na Vercel. Para teste, quando a variável não estiver configurada, usa a chave pública limitada `helloworld` do OCR.Space.

## Deploy
Suba o conteúdo desta pasta no mesmo repositório já conectado à Vercel. Não é necessário rodar novamente o SQL do Supabase se as tabelas e buckets da versão anterior já estão funcionando.
