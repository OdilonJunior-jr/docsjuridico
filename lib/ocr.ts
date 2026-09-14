'use client'

import type { ExtractionResult } from '@/lib/types'

type DocumentSourceKind = 'identity' | 'residence'

type OcrApiResponse = {
  ok?: boolean
  text?: string
  parsed?: ExtractionResult
  error?: string
}

const MAX_IMAGE_SIDE = 2600
const MAX_UPLOAD_BYTES = 850_000
const JPEG_QUALITY = 0.9

function mergeExtraction(base: ExtractionResult, next: ExtractionResult): ExtractionResult {
  return {
    nome: base.nome || next.nome || '',
    nacionalidade: base.nacionalidade || next.nacionalidade || '',
    estadoCivil: base.estadoCivil || next.estadoCivil || '',
    profissao: base.profissao || next.profissao || '',
    cpf: base.cpf || next.cpf || '',
    rg: base.rg || next.rg || '',
    logradouro: base.logradouro || next.logradouro || '',
    numero: base.numero || next.numero || '',
    bairro: base.bairro || next.bairro || '',
    cidade: base.cidade || next.cidade || '',
    uf: base.uf || next.uf || '',
    cep: base.cep || next.cep || '',
    rawText: [base.rawText, next.rawText].filter(Boolean).join('\n\n'),
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality = JPEG_QUALITY): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Não foi possível preparar a imagem para leitura.')), 'image/jpeg', quality)
  })
}

async function canvasToBoundedJpeg(source: HTMLCanvasElement): Promise<Blob> {
  let canvas = source
  for (let round = 0; round < 4; round++) {
    for (const quality of [0.9, 0.82, 0.74]) {
      const blob = await canvasToJpeg(canvas, quality)
      if (blob.size <= MAX_UPLOAD_BYTES) return blob
    }
    const reduced = document.createElement('canvas')
    reduced.width = Math.max(1, Math.round(canvas.width * 0.8))
    reduced.height = Math.max(1, Math.round(canvas.height * 0.8))
    const ctx = reduced.getContext('2d')
    if (!ctx) throw new Error('Não foi possível reduzir a imagem para leitura.')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, reduced.width, reduced.height)
    ctx.drawImage(canvas, 0, 0, reduced.width, reduced.height)
    canvas = reduced
  }
  const finalBlob = await canvasToJpeg(canvas, 0.68)
  if (finalBlob.size > MAX_UPLOAD_BYTES) throw new Error('A foto é grande demais para o leitor de teste. Tente uma imagem com resolução menor.')
  return finalBlob
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

async function pdfToJpegs(file: File): Promise<Blob[]> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const pages = Math.min(pdf.numPages, 3)
  const output: Blob[] = []

  for (let index = 1; index <= pages; index++) {
    const page = await pdf.getPage(index)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(3, MAX_IMAGE_SIDE / Math.max(base.width, base.height))
    const viewport = page.getViewport({ scale: Math.max(1.5, scale) })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Não foi possível preparar o PDF para leitura.')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    output.push(await canvasToBoundedJpeg(canvas))
  }
  return output
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

export async function extractDataFromFile(
  file: File,
  kind: DocumentSourceKind,
  onProgress?: (value: number) => void,
): Promise<ExtractionResult> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  const pages = isPdf ? await pdfToJpegs(file) : [await imageFileToJpeg(file)]
  if (!pages.length) throw new Error('O arquivo não possui páginas legíveis.')

  let merged: ExtractionResult = {}
  let anyText = false
  for (let i = 0; i < pages.length; i++) {
    onProgress?.(Math.max(0.05, i / pages.length))
    const result = await callServerOcr(pages[i], `${kind}_${i + 1}.jpg`, kind)
    if ((result.text || '').replace(/\s/g, '').length > 10) anyText = true
    merged = mergeExtraction(merged, { ...(result.parsed || {}), rawText: result.text || result.parsed?.rawText || '' })
    onProgress?.((i + 1) / pages.length)
  }

  if (!anyText) {
    throw new Error('O OCR não conseguiu reconhecer texto nessa imagem. Tente uma foto mais nítida, sem reflexo e com o documento inteiro visível.')
  }
  return merged
}
