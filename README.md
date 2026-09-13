# Sistema de Documentos Jurídicos — V1.9 pronta para deploy

Versão preparada para GitHub → Vercel com Supabase já vinculado e Google Cloud Vision já configurado no servidor.

## Uso
1. Suba os arquivos deste projeto no GitHub.
2. Importe o repositório na Vercel ou deixe o projeto já conectado fazer redeploy.
3. Abra o sistema e faça login.
4. Em Novo documento, envie CNH/RG e comprovante em foto JPG/PNG/WebP.
5. Clique para ler os documentos e confira os campos antes de gerar.

O OCR usa Google Cloud Vision na rota server-side `/api/ocr`. O banco, autenticação e storage continuam no Supabase.

Importante: esta cópia contém a chave do Google Vision embutida no código servidor a pedido do proprietário para deploy sem configuração manual. Se o repositório for público, a chave poderá ser vista no código-fonte do repositório.
