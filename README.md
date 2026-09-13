# Documentos Jurídicos — versão 1

Sistema web para automação segura de **Procuração** e **Declaração de Hipossuficiência** usando os modelos originais do escritório.

## O que esta versão faz

- Login por e-mail e senha com Supabase Auth.
- Tela inicial simples com ação principal “Novo documento”.
- Upload de RG/CNH e comprovante (JPG, PNG, WEBP ou PDF, até 10 MB cada).
- OCR executado no navegador com Tesseract.js; os arquivos não são enviados a um serviço externo de IA.
- Campos não identificados permanecem vazios e precisam ser preenchidos/revisados.
- Geração de DOCX usando os arquivos originais em `templates/`, alterando apenas campos variáveis e a data atual.
- PDF por conversão LibreOffice através do Gotenberg, preservando o layout do DOCX.
- Clientes e documentos com busca por nome ou CPF.
- RLS em todas as tabelas e buckets privados no Supabase Storage.
- Sem gráficos, tutorial inicial ou módulos extras.

## 1. Supabase

Crie um projeto no Supabase e execute no SQL Editor:

`supabase/migrations/001_initial.sql`

Depois, em **Authentication > Users**, crie o usuário do escritório. Não existe cadastro público nesta versão.

## 2. Variáveis

Copie `.env.example` para `.env.local` e informe:

```env
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
GOTENBERG_URL=http://localhost:3001
# Em produção, se habilitar Basic Auth no Gotenberg:
GOTENBERG_USERNAME=juridico
GOTENBERG_PASSWORD=uma-senha-forte
```

Use somente a **publishable key** no app. Esta versão não usa service role key.

## 3. Rodar localmente

### Forma simples (DOCX + PDF)

```bash
docker compose up --build
```

Acesse `http://localhost:3000`.

### Desenvolvimento do Next.js

Rode o Gotenberg:

```bash
docker run --rm -p 3001:3000 gotenberg/gotenberg:8
```

Depois:

```bash
npm install
npm run dev
```

## Segurança desta versão

- Todas as rotas `/app` exigem sessão autenticada.
- RLS limita clientes, uploads e documentos ao próprio usuário autenticado.
- Os buckets `source-documents` e `generated-documents` são privados.
- Downloads usam links assinados temporários.
- OCR ocorre localmente no navegador antes do armazenamento.
- Nenhum dado ausente é completado automaticamente.
- `robots.txt` e headers impedem indexação do sistema.

## Modelos jurídicos

Os arquivos em `templates/` foram derivados diretamente dos modelos originais enviados. O texto jurídico e os dados fixos da advogada não foram reescritos. Foram inseridos placeholders apenas nos trechos variáveis do cliente/representante/empresa e nas datas.

Para preservar isso, não edite os textos jurídicos no código. Se o modelo oficial mudar, substitua o DOCX de origem e refaça os placeholders de forma controlada.

## PDF

A conversão é feita por uma instância Gotenberg/LibreOffice. No `docker-compose.yml`, ela roda na mesma rede privada do app. Em produção com Vercel, use um Gotenberg protegido por HTTPS e Basic Auth, e configure `GOTENBERG_URL`, `GOTENBERG_USERNAME` e `GOTENBERG_PASSWORD`. Não exponha uma instância Gotenberg sem autenticação na internet.

## Configuração Supabase desta versão

Esta versão já possui o Project URL e a Publishable Key como fallback público no código. Portanto, para este projeto específico, o deploy pode abrir sem cadastrar essas duas variáveis na Vercel. Ainda assim, elas podem ser sobrescritas por `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` nas Environment Variables.

A `SUPABASE_SECRET_KEY`/`service_role` **não é usada nem deve ser incluída no projeto ou GitHub**. Execute `supabase/migrations/001_initial.sql` uma única vez no SQL Editor do Supabase e crie o usuário em Authentication > Users.

## V1.5 — leitura de CNH e comprovante
- Pré-processamento local de imagem antes do Tesseract (escala, cinza e contraste).
- PDFs com camada de texto são lidos diretamente antes de tentar OCR.
- PDFs escaneados usam renderização em maior resolução.
- Parser ampliado para CNH brasileira (inclusive campo Documento de Identidade) e endereços sem rótulo explícito.
- Campos ausentes continuam vazios; nenhuma informação é inventada.


## OCR V1.6
- Worker/WASM/language paths explicit for Vercel/Next.js.
- First pass uses the original image with auto-rotation.
- Second pass uses enlarged grayscale image only when needed.
- CPF validation and CNH/address parsing were strengthened.
- If OCR returns no usable text, the flow now stops with a clear error instead of showing an empty form.
