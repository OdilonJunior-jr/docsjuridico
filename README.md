# Documentos Jurídicos — V1.12

Versão focada em leitura fiel de PDFs digitais e CNH SENATRAN, mantendo o fluxo jurídico e os modelos originais.

## Correções desta versão

- PDFs digitais: lê primeiro a camada de texto do próprio PDF (mais fiel que OCR para faturas e comprovantes).
- Comprovante: procura nome/CPF em até 12 páginas; endereço é extraído do documento e conferido pelo CEP via ViaCEP.
- CNH digital SENATRAN: recorta a área útil do cartão/MRZ antes do OCR para evitar que QR Code e rodapé/certificado virem falsos dados.
- O parser rejeita frases de certificado digital/Assinador Serpro como nome.
- MRZ da CNH é reconhecida como fonte adicional para o nome.
- Nacionalidade pode ser extraída da CNH quando legível.
- Complementos como CASA/APTO/BLOCO são preservados junto ao número para não perder parte do endereço.
- Quando comprovante e identidade trazem o mesmo CPF, o nome do comprovante digital serve como confirmação contra ruído do OCR da CNH.
- Geração continua criando 4 arquivos: procuração DOCX/PDF + declaração DOCX/PDF.
- Modelos jurídicos e dados fixos da advogada não foram alterados.

## Observação importante

A declaração original enviada é de pessoa jurídica. Portanto, razão social, CNPJ e endereço da empresa continuam obrigatórios para gerar essa declaração. O sistema não inventa esses dados a partir de CNH/comprovante residencial.
