'use client'

import type { ExtractionResult } from '@/lib/types'

const STREET_WORDS = /\b(RUA|R\.?|AV(?:ENIDA)?\.?|ALAMEDA|AL\.?|TRAVESSA|TV\.?|RODOVIA|ROD\.?|ESTRADA|EST\.?|PRA[CÇ]A|PCA\.?|LARGO|VIELA|VIA|CONJUNTO|RESIDENCIAL|FAZENDA|S[IÍ]TIO|CH[AÁ]CARA)\b/i
const LABEL_ONLY = /^(?:\d+[A-Z]?\s*)?(?:NOME(?:\s+E\s+SOBRENOME)?|NAME(?:\s+AND\s+SURNAME)?|CPF(?:\s*\/\s*DATA\s+NASCIMENTO)?|DATA\s+DE?\s*NASCIMENTO|NASCIMENTO|DOC\.?\s*IDENTIDADE(?:\s*\/.*)?|DOCUMENTO\s+DE\s+IDENTIDADE|IDENTIDADE|RG|ENDERE[CÇ]O|LOGRADOURO|BAIRRO|MUNIC[IÍ]PIO|CIDADE|CEP|UF|FILIA[CÇ][AÃ]O|ASSINATURA|VALIDADE|DATA\s+EMISS[AÃ]O|N[º°O]?\s*REGISTRO|REGISTRO|HABILITA[CÇ][AÃ]O|CATEGORIA|LOCAL\s+E\s+UF\s+DE\s+NASCIMENTO)(?:\s*[:\-\/].*)?$/i

function clean(s: string) {
  return s
    .replace(/[|]/g, 'I')
    .replace(/[ \t]+/g, ' ')
    .replace(/^[-–—:;,.\s]+|[-–—:;,.\s]+$/g, '')
    .trim()
}

function normalizeForMatch(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
}

function onlyDigits(s: string) { return s.replace(/\D/g, '') }

function formatCpf(value: string) {
  const d = onlyDigits(value).slice(0, 11)
  return d.length === 11 ? `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}` : ''
}

function formatCep(value: string) {
  const d = onlyDigits(value).slice(0, 8)
  return d.length === 8 ? `${d.slice(0,5)}-${d.slice(5)}` : ''
}

function looksLikeName(s: string) {
  const v = clean(s)
  if (v.length < 6 || v.length > 90 || /\d/.test(v) || STREET_WORDS.test(v)) return false
  const words = v.split(/\s+/).filter(Boolean)
  if (words.length < 2) return false
  const letters = v.replace(/[^A-Za-zÀ-ÿ]/g, '')
  return letters.length >= 5 && !LABEL_ONLY.test(v)
}

function looksLikeAddress(s: string) {
  const v = clean(s)
  return v.length >= 5 && STREET_WORDS.test(v)
}

function linesFrom(rawText: string) {
  return rawText
    .replace(/\r/g, '\n')
    .split(/\n+/)
    .map(clean)
    .filter(Boolean)
}

function nextUsefulLine(lines: string[], start: number, predicate?: (value: string) => boolean) {
  for (let i = start + 1; i < Math.min(lines.length, start + 6); i++) {
    const line = clean(lines[i])
    if (!line || LABEL_ONLY.test(line)) continue
    if (!predicate || predicate(line)) return line
  }
  return ''
}

function findAfterLabel(lines: string[], labels: RegExp[], predicate?: (value: string) => boolean) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const normalized = normalizeForMatch(line)
    for (const label of labels) {
      const m = normalized.match(label)
      if (!m) continue

      // Alguns OCRs mantêm o valor na mesma linha depois do rótulo.
      // O índice do texto normalizado continua alinhado com a linha original para os acentos removidos.
      if (typeof m.index === 'number') {
        const after = clean(line.slice(m.index + m[0].length).replace(/^\s*[:\-\/]+\s*/, ''))
        if (after && (!predicate || predicate(after)) && !LABEL_ONLY.test(after)) return after
      }

      const next = nextUsefulLine(lines, i, predicate)
      if (next) return next
    }
  }
  return ''
}

function firstCpf(text: string) {
  const direct = text.match(/\b(\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[-.\s]?\d{2})\b/)
  if (direct) return formatCpf(direct[1])
  const labeled = text.match(/CPF[^\d]{0,25}(\d[\d.\s-]{9,18}\d)/i)
  return labeled ? formatCpf(labeled[1]) : ''
}

function firstCep(text: string) {
  const direct = text.match(/\b(\d{5}[.\s-]?\d{3})\b/)
  return direct ? formatCep(direct[1]) : ''
}

function findIdentity(lines: string[], text: string) {
  // CNH nova/antiga costuma colocar o valor na linha seguinte a DOC IDENTIDADE / ORG. EMISSOR / UF.
  const labeled = findAfterLabel(
    lines,
    [/(?:DOC\.?\s*IDENTIDADE|DOCUMENTO\s+DE\s+IDENTIDADE|IDENTIDADE|\bRG\b)/i],
    (v) => /\d/.test(v) && v.length >= 4 && v.length <= 50,
  )
  if (labeled) return clean(labeled)

  const sameLine = text.match(/(?:RG|IDENTIDADE)\s*[:\-]?\s*([A-Z]{0,4}\s*\d[\d.\-\/\s]{3,20}(?:\s+[A-Z]{2,8})?)/i)
  return sameLine ? clean(sameLine[1]) : ''
}

function parseAddress(lines: string[], text: string) {
  const cep = firstCep(text)
  let logradouro = ''
  let numero = ''
  let bairro = ''
  let cidade = ''
  let uf = ''

  // 1) endereço explicitamente rotulado
  logradouro = findAfterLabel(lines, [/(?:ENDERECO|LOGRADOURO)/i], (v) => v.length >= 4)

  // 2) comprovantes normalmente não escrevem "ENDEREÇO"; procuramos uma linha de logradouro.
  if (!logradouro) {
    const idx = lines.findIndex(looksLikeAddress)
    if (idx >= 0) logradouro = lines[idx]
  }

  if (logradouro) {
    // separa número quando vem na própria linha: "Rua X, 123" ou "Rua X 123".
    const numberMatch = logradouro.match(/^(.*?)(?:,|\s)\s*(?:N[º°O]?\.?\s*)?(\d{1,6}[A-Z]?(?:\s*[-\/]\s*\d+)?)\b(?:\s|,|$)(.*)$/i)
    if (numberMatch && clean(numberMatch[1]).length >= 4) {
      logradouro = clean(numberMatch[1])
      numero = clean(numberMatch[2])
      const tail = clean(numberMatch[3] || '')
      if (tail && !/CEP/i.test(tail) && tail.length <= 60) bairro = tail.replace(/^[-,]\s*/, '')
    }
  }

  numero ||= findAfterLabel(lines, [/(?:NUMERO|N[º°O]\.?)/i], (v) => /^\d{1,6}[A-Z]?(?:\s*[-\/]\s*\d+)?$/i.test(clean(v)))
  bairro ||= findAfterLabel(lines, [/(?:BAIRRO)/i], (v) => v.length >= 2 && v.length <= 70)

  // padrões cidade/UF: UBERABA/MG, UBERABA - MG, UBERABA MG
  const cityPatterns = [
    /\b([A-ZÀ-Ÿ][A-ZÀ-Ÿ .'-]{2,50})\s*[\/-]\s*([A-Z]{2})\b/g,
    /\b([A-ZÀ-Ÿ][A-ZÀ-Ÿ .'-]{2,50})\s+-\s+([A-Z]{2})\b/g,
  ]
  for (const regex of cityPatterns) {
    let match: RegExpExecArray | null
    while ((match = regex.exec(text.toUpperCase()))) {
      const candidate = clean(match[1])
      if (!/BRASIL|VALIDADE|EMISS|IDENTIDADE|NACIONAL|HABILITA|CATEGORIA/.test(normalizeForMatch(candidate))) {
        cidade = candidate
        uf = match[2].toUpperCase()
      }
    }
    if (cidade) break
  }

  // Ao encontrar o CEP, as linhas vizinhas costumam conter bairro/cidade.
  if (cep) {
    const cepIndex = lines.findIndex((l) => onlyDigits(l).includes(onlyDigits(cep)))
    if (cepIndex >= 0) {
      const around = lines.slice(Math.max(0, cepIndex - 3), Math.min(lines.length, cepIndex + 3))
      if (!bairro) {
        for (const candidate of around) {
          const n = normalizeForMatch(candidate)
          if (candidate === logradouro || /CEP|\d{5}[-. ]?\d{3}/.test(candidate) || STREET_WORDS.test(candidate)) continue
          if (!/CPF|CNPJ|CLIENTE|CONTA|INSTALACAO|REFERENCIA|VENCIMENTO|TOTAL|ENERGIA|AGUA|TELEFONE/.test(n) && candidate.length >= 3 && candidate.length <= 60 && !/^\d/.test(candidate)) {
            bairro = candidate.replace(/^BAIRRO\s*[:\-]?\s*/i, '')
            break
          }
        }
      }
      if (!cidade || !uf) {
        for (const candidate of around) {
          const m = candidate.toUpperCase().match(/^([A-ZÀ-Ÿ][A-ZÀ-Ÿ .'-]{2,50})\s*(?:[\/-]|\s+-\s+)\s*([A-Z]{2})\b/)
          if (m) { cidade = clean(m[1]); uf = m[2]; break }
        }
      }
    }
  }

  // Se o logradouro veio com CEP/bairro/cidade grudados, limpa o excesso.
  if (logradouro) {
    logradouro = clean(logradouro
      .replace(/\bCEP\b.*$/i, '')
      .replace(/\bBAIRRO\b.*$/i, '')
    )
  }

  return { cep, logradouro, numero, bairro, cidade, uf }
}

export function parseBrazilianDocumentText(rawText: string): ExtractionResult {
  const text = rawText.replace(/\r/g, '\n').replace(/\n{2,}/g, '\n')
  const lines = linesFrom(text)

  const cpf = firstCpf(text)
  const rg = findIdentity(lines, text)

  let nome = findAfterLabel(
    lines,
    [/(?:NOME\s+E\s+SOBRENOME|NOME\s+DO\s+TITULAR|NOME\s+DO\s+CLIENTE|\bNOME\b|NAME\s+AND\s+SURNAME)/i],
    looksLikeName,
  )

  // CNH pode trazer o rótulo "1 NOME E SOBRENOME" com ruído; fallback próximo ao cabeçalho.
  if (!nome) {
    const headerIndex = lines.findIndex((l) => /HABILITA[CÇ][AÃ]O|DRIVER\s+LICENSE|CARTEIRA\s+NACIONAL/i.test(l))
    if (headerIndex >= 0) {
      for (let i = headerIndex + 1; i < Math.min(lines.length, headerIndex + 10); i++) {
        if (looksLikeName(lines[i])) { nome = lines[i]; break }
      }
    }
  }

  const address = parseAddress(lines, text)
  return { nome, cpf, rg, ...address, rawText: text }
}

function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)) }

async function imageFileToCanvas(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file)
  const maxSide = 2600
  const minSide = 1600
  let scale = 1
  const longest = Math.max(bitmap.width, bitmap.height)
  const shortest = Math.min(bitmap.width, bitmap.height)
  if (longest > maxSide) scale = maxSide / longest
  else if (shortest < minSide) scale = Math.min(2.2, minSide / Math.max(1, shortest))

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return preprocessCanvas(canvas)
}

function preprocessCanvas(source: HTMLCanvasElement) {
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(source, 0, 0)
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = image.data

  // Contraste + tons de cinza. Evita threshold agressivo, que pode apagar caracteres finos da CNH.
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    const contrasted = clamp((gray - 128) * 1.42 + 128, 0, 255)
    d[i] = d[i + 1] = d[i + 2] = contrasted
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

async function extractPdfTextLayer(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  const data = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data }).promise
  const pages = Math.min(pdf.numPages, 4)
  let text = ''
  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .filter(Boolean)
      .join('\n')
    text += `\n${pageText}`
  }
  return text.trim()
}

async function renderPdfPages(file: File): Promise<HTMLCanvasElement[]> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  const data = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data }).promise
  const canvases: HTMLCanvasElement[] = []
  const pages = Math.min(pdf.numPages, 3)
  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 2.25 })
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    canvases.push(preprocessCanvas(canvas))
  }
  return canvases
}

function textLooksUseful(text: string) {
  const normalized = normalizeForMatch(text)
  const score = [
    /\bCPF\b/.test(normalized),
    /\bNOME\b/.test(normalized),
    /\bCEP\b/.test(normalized),
    STREET_WORDS.test(normalized),
    /\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[-.\s]?\d{2}/.test(text),
  ].filter(Boolean).length
  return text.replace(/\s/g, '').length > 120 && score >= 1
}

export async function extractTextFromFile(file: File, onProgress?: (value: number) => void) {
  // PDFs de concessionária/banco muitas vezes já têm texto real. É mais preciso que OCR.
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    try {
      const nativeText = await extractPdfTextLayer(file)
      if (textLooksUseful(nativeText)) {
        onProgress?.(1)
        return nativeText
      }
    } catch {
      // PDF escaneado: segue para OCR abaixo.
    }
  }

  const { createWorker, PSM } = await import('tesseract.js')
  const worker = await createWorker('por', 1, {
    logger: (message) => {
      if (message.status === 'recognizing text' && typeof message.progress === 'number') onProgress?.(message.progress)
    },
  })

  try {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: '1',
    })

    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      const canvases = await renderPdfPages(file)
      let text = ''
      for (let i = 0; i < canvases.length; i++) {
        const result = await worker.recognize(canvases[i])
        text += `\n${result.data.text}`
        onProgress?.((i + 1) / canvases.length)
      }
      return text
    }

    const canvas = await imageFileToCanvas(file)
    const result = await worker.recognize(canvas)
    return result.data.text
  } finally {
    await worker.terminate()
  }
}
