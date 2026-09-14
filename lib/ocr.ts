'use client'

import type { ExtractionResult } from '@/lib/types'
import { mergeExtractionCandidates, parseBrazilianDocumentText } from '@/lib/ocr-parser'

type DocumentSourceKind = 'identity' | 'residence'

type OcrApiResponse = {
  ok?: boolean
  text?: string
  parsed?: ExtractionResult
  error?: string
}

const MAX_IMAGE_SIDE = 3200
const MAX_UPLOAD_BYTES = 930_000
const JPEG_QUALITY = 0.94

function canvasToJpeg(canvas: HTMLCanvasElement, quality = JPEG_QUALITY): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Não foi possível preparar a imagem para leitura.')), 'image/jpeg', quality)
  })
}

async function canvasToBoundedJpeg(source: HTMLCanvasElement): Promise<Blob> {
  let canvas = source
  for (let round = 0; round < 4; round++) {
    for (const quality of [0.94, 0.89, 0.84, 0.78]) {
      const blob = await canvasToJpeg(canvas, quality)
      if (blob.size <= MAX_UPLOAD_BYTES) return blob
    }
    const reduced = document.createElement('canvas')
    reduced.width = Math.max(1, Math.round(canvas.width * 0.86))
    reduced.height = Math.max(1, Math.round(canvas.height * 0.86))
    const ctx = reduced.getContext('2d')
    if (!ctx) throw new Error('Não foi possível reduzir a imagem para leitura.')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, reduced.width, reduced.height)
    ctx.drawImage(canvas, 0, 0, reduced.width, reduced.height)
    canvas = reduced
  }
  const finalBlob = await canvasToJpeg(canvas, 0.74)
  if (finalBlob.size > MAX_UPLOAD_BYTES) throw new Error('A foto é grande demais para o leitor de teste. Tente uma imagem com resolução menor.')
  return finalBlob
}

function cropCanvas(source: HTMLCanvasElement, xRatio: number, yRatio: number, widthRatio: number, heightRatio: number) {
  const x = Math.max(0, Math.round(source.width * xRatio))
  const y = Math.max(0, Math.round(source.height * yRatio))
  const width = Math.min(source.width - x, Math.round(source.width * widthRatio))
  const height = Math.min(source.height - y, Math.round(source.height * heightRatio))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, width)
  canvas.height = Math.max(1, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Não foi possível recortar o documento para leitura.')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(source, x, y, width, height, 0, 0, width, height)
  return canvas
}

async function imageFileToJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Não foi possível preparar a imagem.')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvasToBoundedJpeg(canvas)
  } finally {
    bitmap.close()
  }
}

type PdfPrepared = { images: Blob[]; text: string }

async function pdfToPrepared(file: File, kind: DocumentSourceKind): Promise<PdfPrepared> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const textParts: string[] = []

  // PDFs digitais (faturas, contas etc.) costumam ter uma camada de texto muito mais exata que OCR.
  // Lemos até 12 páginas para encontrar CPF/nome que às vezes aparecem só na DANFE/final da fatura.
  const textPages = Math.min(pdf.numPages, 12)
  for (let index = 1; index <= textPages; index++) {
    const page = await pdf.getPage(index)
    const content = await page.getTextContent()
    let pageText = ''
    for (const item of content.items) {
      if (!('str' in item)) continue
      pageText += `${item.str}${'hasEOL' in item && item.hasEOL ? '\n' : ' '}`
    }
    if (pageText.trim()) textParts.push(pageText.trim())
  }

  const firstPage = await pdf.getPage(1)
  const base = firstPage.getViewport({ scale: 1 })
  const scale = Math.min(3.4, MAX_IMAGE_SIDE / Math.max(base.width, base.height))
  const viewport = firstPage.getViewport({ scale: Math.max(1.8, scale) })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Não foi possível preparar o PDF para leitura.')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await firstPage.render({ canvas, canvasContext: ctx, viewport }).promise

  if (kind === 'identity') {
    // CNH digital SENATRAN: o cartão fica à esquerda e o QR/rodapé pode confundir o OCR.
    // A primeira tentativa é um recorte focado no cartão + MRZ; a página inteira fica como fallback.
    const focused = cropCanvas(canvas, 0.025, 0.045, 0.46, 0.72)
    return { images: [await canvasToBoundedJpeg(focused), await canvasToBoundedJpeg(canvas)], text: textParts.join('\n') }
  }

  return { images: [await canvasToBoundedJpeg(canvas)], text: textParts.join('\n') }
}

async function callServerOcr(blob: Blob, filename: string, kind: DocumentSourceKind): Promise<OcrApiResponse> {
  const form = new FormData()
  form.append('file', blob, filename)
  form.append('kind', kind)
  const response = await fetch('/api/ocr', { method: 'POST', body: form })
  const data = await response.json() as OcrApiResponse
  if (!response.ok) throw new Error(data.error || 'O serviço de leitura não conseguiu processar o documento.')
  return data
}

function hasResidenceCore(data: ExtractionResult) {
  return Boolean(data.logradouro && data.numero && data.cep && data.cidade && data.uf)
}

async function enrichAddressByCep(data: ExtractionResult): Promise<ExtractionResult> {
  const cep = String(data.cep || '').replace(/\D/g, '')
  if (cep.length !== 8) return data
  try {
    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { cache: 'no-store' })
    if (!response.ok) return data
    const value = await response.json() as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string }
    if (value.erro) return data
    return {
      ...data,
      logradouro: value.logradouro?.trim() || data.logradouro || '',
      bairro: value.bairro?.trim() || data.bairro || '',
      cidade: value.localidade?.trim() || data.cidade || '',
      uf: value.uf?.trim().toUpperCase() || data.uf || '',
    }
  } catch { return data }
}

export async function extractDataFromFile(
  file: File,
  kind: DocumentSourceKind,
  onProgress?: (value: number) => void,
): Promise<ExtractionResult> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  let direct: ExtractionResult = {}
  let images: Blob[] = []

  if (isPdf) {
    const prepared = await pdfToPrepared(file, kind)
    images = prepared.images
    if (prepared.text.trim()) {
      const parsedText = parseBrazilianDocumentText(prepared.text)
      direct = kind === 'identity'
        ? { nome: parsedText.nome || '', nacionalidade: parsedText.nacionalidade || '', cpf: parsedText.cpf || '', rg: parsedText.rg || '', rawText: prepared.text }
        : parsedText
    }
  } else {
    images = [await imageFileToJpeg(file)]
  }

  // Em comprovante PDF digital, a camada de texto é preferida; ela evita trocar letras do nome.
  // Se já temos o núcleo do endereço, só confirmamos o CEP e não submetemos a página inteira ao OCR.
  if (kind === 'residence' && isPdf && hasResidenceCore(direct) && direct.nome) {
    onProgress?.(1)
    return enrichAddressByCep(direct)
  }

  let merged = direct
  let anyText = Boolean(direct.rawText || Object.values(direct).some(Boolean))
  for (let i = 0; i < images.length; i++) {
    onProgress?.(Math.max(0.05, i / Math.max(1, images.length)))
    try {
      const result = await callServerOcr(images[i], `${kind}_${i + 1}.jpg`, kind)
      if ((result.text || '').replace(/\s/g, '').length > 10) anyText = true
      merged = mergeExtractionCandidates(merged, { ...(result.parsed || {}), rawText: result.text || result.parsed?.rawText || '' })
    } catch (error) {
      // Se uma variante (ex.: página inteira da CNH) falhar, mantém o recorte/dados já obtidos.
      if (!Object.values(merged).some(Boolean) && i === images.length - 1) throw error
    }
    onProgress?.((i + 1) / images.length)
  }

  if (kind === 'residence') merged = await enrichAddressByCep(merged)
  if (!anyText) throw new Error('O OCR não conseguiu reconhecer texto nessa imagem. Tente uma foto mais nítida, sem reflexo e com o documento inteiro visível.')
  return merged
}
