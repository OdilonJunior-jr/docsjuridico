'use client'

import type { ExtractionResult } from '@/lib/types'

function clean(s: string) { return s.replace(/[ \t]+/g, ' ').trim() }
function firstMatch(text: string, regexes: RegExp[]) {
  for (const r of regexes) {
    const m = text.match(r)
    if (m?.[1]) return clean(m[1])
  }
  return ''
}

export function parseBrazilianDocumentText(rawText: string): ExtractionResult {
  const text = rawText.replace(/\r/g, '\n').replace(/\n{2,}/g, '\n')
  const cpf = firstMatch(text, [/(?:CPF|REGISTRO\s+CPF)\s*[:\-]?\s*(\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2})/i, /\b(\d{3}\.\d{3}\.\d{3}-\d{2})\b/])
  const rg = firstMatch(text, [/(?:RG|IDENTIDADE|CARTEIRA\s+DE\s+IDENTIDADE)\s*[:\-]?\s*([A-Z0-9.\-\/ ]{5,25})/i])
  const cep = firstMatch(text, [/(?:CEP)\s*[:\-]?\s*(\d{5}[-.\s]?\d{3})/i, /\b(\d{5}-\d{3})\b/])
  const nome = firstMatch(text, [/(?:NOME(?:\s+E\s+SOBRENOME)?|NOME\s+DO\s+TITULAR)\s*[:\-]?\s*\n?([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÇ ]{5,80})/i])
  const logradouro = firstMatch(text, [/(?:ENDEREÇO|ENDERECO|LOGRADOURO)\s*[:\-]?\s*\n?([^\n,]{4,100})/i])
  const numero = firstMatch(text, [/(?:NÚMERO|NUMERO|Nº|N°)\s*[:\-]?\s*(\d+[A-Z]?)/i])
  const bairro = firstMatch(text, [/(?:BAIRRO)\s*[:\-]?\s*([^\n,]{2,60})/i])
  const cityUf = text.match(/(?:CIDADE|MUNICÍPIO|MUNICIPIO)\s*[:\-]?\s*([^\n,\/]{2,60})\s*[\/\-]\s*([A-Z]{2})/i)
  const cidade = cityUf?.[1] ? clean(cityUf[1]) : ''
  const uf = cityUf?.[2]?.toUpperCase() || firstMatch(text, [/(?:UF)\s*[:\-]?\s*([A-Z]{2})\b/i])
  return { nome, cpf, rg, cep, logradouro, numero, bairro, cidade, uf, rawText }
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
    const viewport = page.getViewport({ scale: 1.8 })
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    canvases.push(canvas)
  }
  return canvases
}

export async function extractTextFromFile(file: File, onProgress?: (value: number) => void) {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('por', 1, {
    logger: (message) => {
      if (message.status === 'recognizing text' && typeof message.progress === 'number') onProgress?.(message.progress)
    },
  })
  try {
    if (file.type === 'application/pdf') {
      const canvases = await renderPdfPages(file)
      let text = ''
      for (let i = 0; i < canvases.length; i++) {
        const result = await worker.recognize(canvases[i])
        text += `\n${result.data.text}`
        onProgress?.((i + 1) / canvases.length)
      }
      return text
    }
    const result = await worker.recognize(file)
    return result.data.text
  } finally {
    await worker.terminate()
  }
}
