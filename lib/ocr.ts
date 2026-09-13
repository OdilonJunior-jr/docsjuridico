'use client'

import type { ExtractionResult } from '@/lib/types'

const STREET_WORDS = /\b(RUA|R\.?|AV(?:ENIDA)?\.?|ALAMEDA|AL\.?|TRAVESSA|TV\.?|RODOVIA|ROD\.?|ESTRADA|EST\.?|PRA[CÇ]A|PCA\.?|LARGO|VIELA|VIA|CONJUNTO|RESIDENCIAL|FAZENDA|S[IÍ]TIO|CH[AÁ]CARA)\b/i
const BAD_NAME = /REP[ÚU]BLICA|FEDERATIVA|BRASIL|CARTEIRA|NACIONAL|HABILITA[CÇ][AÃ]O|DRIVER|LICENSE|VALIDADE|EMISS[AÃ]O|IDENTIDADE|DOCUMENTO|ASSINATURA|FILIA[CÇ][AÃ]O|DETRAN|SECRETARIA|MINIST[EÉ]RIO|TRANSPORTES|CPF|NASCIMENTO|REGISTRO|CATEGORIA|PERMISS[AÃ]O/i
const PURE_LABEL = /^(?:\d+[A-Z]?\s*)?(?:NOME(?:\s+E\s+SOBRENOME)?|NAME(?:\s+AND\s+SURNAME)?|CPF(?:\s*\/\s*DATA\s+NASCIMENTO)?|DATA\s+DE?\s*NASCIMENTO|NASCIMENTO|DOC\.?\s*IDENTIDADE(?:\s*\/.*)?|DOCUMENTO\s+DE\s+IDENTIDADE|IDENTIDADE|RG|ENDERE[CÇ]O|LOGRADOURO|BAIRRO|MUNIC[IÍ]PIO|CIDADE|CEP|UF|FILIA[CÇ][AÃ]O|ASSINATURA|VALIDADE|DATA\s+EMISS[AÃ]O|N[º°O]?\s*REGISTRO|REGISTRO|HABILITA[CÇ][AÃ]O|CATEGORIA|LOCAL\s+E\s+UF\s+DE\s+NASCIMENTO)\s*[:\-\/]?\s*$/i

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
function digitsFromOcr(s: string) {
  return s
    .toUpperCase()
    .replace(/[OQ]/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/[^0-9]/g, '')
}

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
  if (v.length < 6 || v.length > 90 || /\d/.test(v) || STREET_WORDS.test(v) || BAD_NAME.test(v) || PURE_LABEL.test(v)) return false
  const words = v.split(/\s+/).filter(Boolean)
  if (words.length < 2 || words.length > 8) return false
  const letters = v.replace(/[^A-Za-zÀ-ÿ]/g, '')
  return letters.length >= 5
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
  for (let i = start + 1; i < Math.min(lines.length, start + 8); i++) {
    const line = clean(lines[i])
    if (!line || PURE_LABEL.test(line)) continue
    if (!predicate || predicate(line)) return line
  }
  return ''
}

function findAfterLabel(lines: string[], labels: RegExp[], predicate?: (value: string) => boolean) {
  for (let i = 0; i < lines.length; i++) {
    const original = lines[i]
    const normalized = normalizeForMatch(original)
    for (const label of labels) {
      const m = normalized.match(label)
      if (!m || typeof m.index !== 'number') continue

      const after = clean(original.slice(m.index + m[0].length).replace(/^\s*[:\-\/]+\s*/, ''))
      if (after && (!predicate || predicate(after)) && !PURE_LABEL.test(after)) return after

      const next = nextUsefulLine(lines, i, predicate)
      if (next) return next
    }
  }
  return ''
}

function validCpfDigits(d: string) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false
  const calc = (base: string, factor: number) => {
    let sum = 0
    for (const digit of base) sum += Number(digit) * factor--
    const r = (sum * 10) % 11
    return r === 10 ? 0 : r
  }
  return calc(d.slice(0, 9), 10) === Number(d[9]) && calc(d.slice(0, 10), 11) === Number(d[10])
}

function firstCpf(text: string, lines: string[]) {
  const compact = text.replace(/\s+/g, ' ')
  const directMatches = compact.match(/\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[-.\s]?\d{2}/g) || []
  for (const value of directMatches) {
    const d = onlyDigits(value)
    if (validCpfDigits(d)) return formatCpf(d)
  }

  // OCR costuma separar CPF em muitos blocos ou trocar 0/O e 1/I. Só corrige isso em contexto rotulado como CPF.
  for (let i = 0; i < lines.length; i++) {
    if (!/\bCPF\b/i.test(lines[i])) continue
    const context = [lines[i], lines[i + 1] || '', lines[i + 2] || ''].join(' ')
    const chunks = context.split(/DATA\s*(?:DE\s*)?NASCIMENTO|NASCIMENTO/i)[0]
    const d = digitsFromOcr(chunks.replace(/^.*?CPF/i, ''))
    for (let start = 0; start + 11 <= d.length; start++) {
      const candidate = d.slice(start, start + 11)
      if (validCpfDigits(candidate)) return formatCpf(candidate)
    }
  }

  // Último fallback: um bloco isolado de 11 dígitos válido.
  const candidates = compact.match(/(?:\D|^)(\d[\d.\s-]{9,22}\d)(?:\D|$)/g) || []
  for (const value of candidates) {
    const d = onlyDigits(value)
    for (let start = 0; start + 11 <= d.length; start++) {
      const candidate = d.slice(start, start + 11)
      if (validCpfDigits(candidate)) return formatCpf(candidate)
    }
  }
  return ''
}

function firstCep(text: string, lines: string[]) {
  const direct = text.match(/\b(\d{5}[.\s-]?\d{3})\b/)
  if (direct) return formatCep(direct[1])
  for (let i = 0; i < lines.length; i++) {
    if (!/\bCEP\b/i.test(lines[i])) continue
    const d = digitsFromOcr(`${lines[i]} ${lines[i + 1] || ''}`.replace(/^.*?CEP/i, ''))
    if (d.length >= 8) return formatCep(d.slice(0, 8))
  }
  return ''
}

function findIdentity(lines: string[], text: string) {
  const labeled = findAfterLabel(
    lines,
    [/(?:DOC\.?\s*IDENTIDADE|DOCUMENTO\s+DE\s+IDENTIDADE|IDENTIDADE|\bRG\b)/i],
    (v) => /\d/.test(v) && v.length >= 4 && v.length <= 60,
  )
  if (labeled) return clean(labeled)

  const sameLine = text.match(/(?:RG|IDENTIDADE)\s*[:\-]?\s*([A-Z]{0,5}\s*\d[\d.\-\/\s]{3,25}(?:\s+[A-Z]{2,10})?)/i)
  return sameLine ? clean(sameLine[1]) : ''
}

function findName(lines: string[]) {
  let nome = findAfterLabel(
    lines,
    [/(?:NOME\s+E\s+SOBRENOME|NOME\s+DO\s+TITULAR|NOME\s+DO\s+CLIENTE|\bNOME\b|NAME\s+AND\s+SURNAME)/i],
    looksLikeName,
  )
  if (nome) return nome

  // Na CNH, procure nomes nas linhas próximas de CPF / nascimento / cabeçalho, evitando cabeçalhos oficiais.
  const anchors = lines
    .map((line, idx) => (/CPF|NASCIMENTO|HABILITA[CÇ][AÃ]O|DRIVER\s+LICENSE/i.test(line) ? idx : -1))
    .filter((idx) => idx >= 0)
  for (const anchor of anchors) {
    const from = Math.max(0, anchor - 8)
    const to = Math.min(lines.length, anchor + 8)
    for (let i = from; i < to; i++) {
      if (looksLikeName(lines[i])) return clean(lines[i])
    }
  }

  // Fallback conservador: primeiro nome plausível no primeiro terço do documento.
  const limit = Math.max(1, Math.ceil(lines.length / 3))
  for (let i = 0; i < limit; i++) if (looksLikeName(lines[i])) return clean(lines[i])
  return ''
}

function parseAddress(lines: string[], text: string) {
  const cep = firstCep(text, lines)
  let logradouro = ''
  let numero = ''
  let bairro = ''
  let cidade = ''
  let uf = ''

  logradouro = findAfterLabel(lines, [/(?:ENDERECO|LOGRADOURO)/i], (v) => v.length >= 4)
  if (!logradouro) {
    const idx = lines.findIndex(looksLikeAddress)
    if (idx >= 0) logradouro = lines[idx]
  }

  if (logradouro) {
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

  if (cep) {
    const cepIndex = lines.findIndex((l) => onlyDigits(l).includes(onlyDigits(cep)))
    if (cepIndex >= 0) {
      const around = lines.slice(Math.max(0, cepIndex - 4), Math.min(lines.length, cepIndex + 4))
      if (!bairro) {
        for (const candidate of around) {
          const n = normalizeForMatch(candidate)
          if (candidate === logradouro || /CEP|\d{5}[-. ]?\d{3}/.test(candidate) || STREET_WORDS.test(candidate)) continue
          if (!/CPF|CNPJ|CLIENTE|CONTA|INSTALACAO|REFERENCIA|VENCIMENTO|TOTAL|ENERGIA|AGUA|TELEFONE|FATURA/.test(n) && candidate.length >= 3 && candidate.length <= 60 && !/^\d/.test(candidate)) {
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

  if (logradouro) {
    logradouro = clean(logradouro
      .replace(/\bCEP\b.*$/i, '')
      .replace(/\bBAIRRO\b.*$/i, '')
    )
  }

  return { cep, logradouro, numero, bairro, cidade, uf }
}

export function parseBrazilianDocumentText(rawText: string): ExtractionResult {
  const text = rawText.replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  const lines = linesFrom(text)
  const cpf = firstCpf(text, lines)
  const rg = findIdentity(lines, text)
  const nome = findName(lines)
  const address = parseAddress(lines, text)
  return { nome, cpf, rg, ...address, rawText: text }
}

function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)) }

async function fileToEnhancedCanvas(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const maxSide = 3400
  const minSide = 1900
  let scale = 1
  const longest = Math.max(bitmap.width, bitmap.height)
  const shortest = Math.min(bitmap.width, bitmap.height)
  if (longest > maxSide) scale = maxSide / longest
  else if (shortest < minSide) scale = Math.min(2.8, minSide / Math.max(1, shortest))

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = image.data
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    const contrasted = clamp((gray - 128) * 1.22 + 128, 0, 255)
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
      .join(' ')
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
    const viewport = page.getViewport({ scale: 3 })
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    canvases.push(canvas)
  }
  return canvases
}

function textStrength(text: string) {
  const compact = text.replace(/\s/g, '')
  const letters = (text.match(/[A-Za-zÀ-ÿ]/g) || []).length
  const digits = (text.match(/\d/g) || []).length
  return compact.length + letters * 2 + digits * 2
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
  return text.replace(/\s/g, '').length > 70 && score >= 1
}

async function createOcrWorker(onProgress?: (value: number) => void) {
  const { createWorker } = await import('tesseract.js')
  // Caminhos explícitos evitam resolução incorreta do worker/WASM em builds Next.js/Vercel.
  return createWorker('por+eng', 1, {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0',
    langPath: 'https://tessdata.projectnaptha.com/4.0.0',
    logger: (message) => {
      if (message.status === 'recognizing text' && typeof message.progress === 'number') onProgress?.(message.progress)
    },
  })
}

export async function extractTextFromFile(file: File, onProgress?: (value: number) => void) {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

  if (isPdf) {
    try {
      const nativeText = await extractPdfTextLayer(file)
      if (textLooksUseful(nativeText)) {
        onProgress?.(1)
        return nativeText
      }
    } catch {
      // PDF escaneado: OCR abaixo.
    }
  }

  const { PSM } = await import('tesseract.js')
  const worker = await createOcrWorker(onProgress)
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    })

    if (isPdf) {
      const canvases = await renderPdfPages(file)
      const pieces: string[] = []
      for (let i = 0; i < canvases.length; i++) {
        const first = await worker.recognize(canvases[i], { rotateAuto: true })
        let best = first.data.text || ''
        if (textStrength(best) < 220) {
          await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '1', user_defined_dpi: '300' })
          const second = await worker.recognize(canvases[i], { rotateAuto: true })
          if (textStrength(second.data.text || '') > textStrength(best)) best = second.data.text || ''
          await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1', user_defined_dpi: '300' })
        }
        pieces.push(best)
        onProgress?.((i + 1) / canvases.length)
      }
      return pieces.join('\n').trim()
    }

    // Primeiro tenta a foto original — preserva letras finas, hologramas e microtexto da CNH.
    const first = await worker.recognize(file, { rotateAuto: true })
    let best = first.data.text || ''

    // Se a primeira passada for fraca, tenta imagem ampliada/cinza e segmentação esparsa.
    if (textStrength(best) < 260 || !textLooksUseful(best)) {
      const enhanced = await fileToEnhancedCanvas(file)
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        preserve_interword_spaces: '1',
        user_defined_dpi: '300',
      })
      const second = await worker.recognize(enhanced, { rotateAuto: true })
      const secondText = second.data.text || ''
      if (textStrength(secondText) > textStrength(best)) best = secondText
    }

    return best.trim()
  } finally {
    await worker.terminate()
  }
}
