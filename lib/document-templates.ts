import fs from 'node:fs/promises'
import path from 'node:path'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib'
import type { CompanyData, DocumentKind, PersonData } from '@/lib/types'

export function formatDateLong(date = new Date()) {
  return new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(date)
}

function required(value: unknown, label: string) {
  const string = String(value ?? '').trim()
  if (!string) throw new Error(`Campo obrigatório ausente: ${label}`)
  return string
}

function normalizeCityUf(city: string, uf: string) {
  return `${required(city, 'cidade')}/${required(uf, 'UF').toUpperCase()}`
}

function procuracaoText(person: PersonData) {
  return `${required(person.nome, 'nome')}, ${required(person.nacionalidade, 'nacionalidade')}, ${required(person.estadoCivil, 'estado civil')}, ${required(person.profissao, 'profissão')}, inscrito (a) no CPF nº ${required(person.cpf, 'CPF')} e RG nº ${required(person.rg, 'RG')}, residente e domiciliado na ${required(person.logradouro, 'logradouro')}, n° ${required(person.numero, 'número')}, Bairro ${required(person.bairro, 'bairro')}, na cidade de ${normalizeCityUf(person.cidade, person.uf)}, CEP: ${required(person.cep, 'CEP')}, nomeia e constitui como patronos os seguintes advogados:`
}

function declaracaoText(person: PersonData, company: CompanyData) {
  return `${required(company.empresaNome, 'razão social')}, pessoa jurídica, inscrita no CNPJ sob o nº ${required(company.cnpj, 'CNPJ')}, com sede na ${required(company.empresaLogradouro, 'logradouro da empresa')}, nº ${required(company.empresaNumero, 'número da empresa')}, Bairro ${required(company.empresaBairro, 'bairro da empresa')}, na cidade de ${normalizeCityUf(company.empresaCidade, company.empresaUf)}, neste ato representada por seu representante legal ${required(person.nome, 'nome do representante')}, ${required(person.nacionalidade, 'nacionalidade')}, ${required(person.estadoCivil, 'estado civil')}, ${required(person.profissao, 'profissão')}, portadora da carteira de identidade ${required(person.rg, 'RG')}, inscrita no CPF sob o nº ${required(person.cpf, 'CPF')}, residente e domiciliado na ${required(person.logradouro, 'logradouro residencial')}, nº ${required(person.numero, 'número residencial')}, Bairro ${required(person.bairro, 'bairro residencial')}, na cidade de ${normalizeCityUf(person.cidade, person.uf)}, declara:`
}

export async function generateDocx(kind: DocumentKind, person: PersonData, company?: CompanyData) {
  const templateName = kind === 'procuracao' ? 'PROCURACAO_TEMPLATE.docx' : 'DECLARACAO_HIPOSSUFICIENCIA_TEMPLATE.docx'
  const templatePath = path.join(process.cwd(), 'templates', templateName)
  const content = await fs.readFile(templatePath, 'binary')
  const zip = new PizZip(content)
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => '' })
  const date = formatDateLong()

  if (kind === 'procuracao') {
    doc.render({
      nome: required(person.nome, 'nome'),
      nacionalidade: required(person.nacionalidade, 'nacionalidade'),
      estado_civil: required(person.estadoCivil, 'estado civil'),
      profissao: required(person.profissao, 'profissão'),
      cpf: required(person.cpf, 'CPF'),
      rg: required(person.rg, 'RG'),
      logradouro: required(person.logradouro, 'logradouro'),
      numero: required(person.numero, 'número'),
      bairro: required(person.bairro, 'bairro'),
      cidade_uf: normalizeCityUf(person.cidade, person.uf),
      cep: required(person.cep, 'CEP'),
      data_extenso: date,
    })
  } else {
    if (!company) throw new Error('Dados da pessoa jurídica são obrigatórios.')
    doc.render({
      empresa_nome: required(company.empresaNome, 'razão social'),
      cnpj: required(company.cnpj, 'CNPJ'),
      empresa_logradouro: required(company.empresaLogradouro, 'logradouro da empresa'),
      empresa_numero: required(company.empresaNumero, 'número da empresa'),
      empresa_bairro: required(company.empresaBairro, 'bairro da empresa'),
      empresa_cidade_uf: normalizeCityUf(company.empresaCidade, company.empresaUf),
      rep_nome: required(person.nome, 'nome do representante'),
      rep_nacionalidade: required(person.nacionalidade, 'nacionalidade'),
      rep_estado_civil: required(person.estadoCivil, 'estado civil'),
      rep_profissao: required(person.profissao, 'profissão'),
      rep_rg: required(person.rg, 'RG'),
      rep_cpf: required(person.cpf, 'CPF'),
      rep_logradouro: required(person.logradouro, 'logradouro residencial'),
      rep_numero: required(person.numero, 'número residencial'),
      rep_bairro: required(person.bairro, 'bairro residencial'),
      rep_cidade_uf: normalizeCityUf(person.cidade, person.uf),
      data_extenso: date,
    })
  }
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' })
}

type DrawBlockOptions = {
  x: number
  topY: number
  maxWidth: number
  maxHeight: number
  startSize: number
  minSize: number
}

function wrapWords(font: PDFFont, text: string, size: number, maxWidth: number) {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[][] = []
  let line: string[] = []
  for (const word of words) {
    const next = [...line, word]
    const width = font.widthOfTextAtSize(next.join(' '), size)
    if (line.length && width > maxWidth) { lines.push(line); line = [word] }
    else line = next
  }
  if (line.length) lines.push(line)
  return lines
}

function drawJustifiedBlock(page: PDFPage, font: PDFFont, text: string, options: DrawBlockOptions) {
  let size = options.startSize
  let lineHeight = size * 1.17
  let lines = wrapWords(font, text, size, options.maxWidth)
  while (lines.length * lineHeight > options.maxHeight && size > options.minSize) {
    size = Math.max(options.minSize, size - 0.2)
    lineHeight = size * 1.16
    lines = wrapWords(font, text, size, options.maxWidth)
  }

  const color = rgb(66 / 255, 73 / 255, 83 / 255)
  let y = options.topY
  lines.forEach((words, index) => {
    const isLast = index === lines.length - 1
    const widths = words.map(word => font.widthOfTextAtSize(word, size))
    const wordsWidth = widths.reduce((sum, width) => sum + width, 0)
    const normalSpace = font.widthOfTextAtSize(' ', size)
    const availableSpace = Math.max(0, options.maxWidth - wordsWidth)
    const gap = !isLast && words.length > 1 ? availableSpace / (words.length - 1) : normalSpace
    let x = options.x
    words.forEach((word, wordIndex) => {
      page.drawText(word, { x, y, size, font, color })
      x += widths[wordIndex] + (wordIndex < words.length - 1 ? gap : 0)
    })
    y -= lineHeight
  })
}

function drawCentered(page: PDFPage, font: PDFFont, text: string, y: number, size: number) {
  const width = font.widthOfTextAtSize(text, size)
  page.drawText(text, { x: (page.getWidth() - width) / 2, y, size, font, color: rgb(66 / 255, 73 / 255, 83 / 255) })
}

export async function generatePdf(kind: DocumentKind, person: PersonData, company?: CompanyData) {
  const baseName = kind === 'procuracao' ? 'PROCURACAO_PDF_BASE.pdf' : 'DECLARACAO_PDF_BASE.pdf'
  const base = await fs.readFile(path.join(process.cwd(), 'templates', baseName))
  const pdf = await PDFDocument.load(base)
  const page = pdf.getPage(0)
  const font = await pdf.embedFont(StandardFonts.TimesRoman)
  const color = rgb(66 / 255, 73 / 255, 83 / 255)
  const date = formatDateLong()

  if (kind === 'procuracao') {
    drawJustifiedBlock(page, font, procuracaoText(person), { x: 170, topY: 650, maxWidth: 305, maxHeight: 92, startSize: 8.7, minSize: 7.5 })
    drawCentered(page, font, `Uberaba, ${date}.`, 183, 10)
    page.drawLine({ start: { x: 164, y: 47 }, end: { x: 258, y: 47 }, thickness: 0.55, color })
    page.drawLine({ start: { x: 374, y: 47 }, end: { x: 408, y: 47 }, thickness: 0.55, color })
  } else {
    if (!company) throw new Error('Dados da pessoa jurídica são obrigatórios.')
    drawJustifiedBlock(page, font, declaracaoText(person, company), { x: 168, topY: 652, maxWidth: 307, maxHeight: 108, startSize: 8.5, minSize: 7.2 })
    drawCentered(page, font, `Uberaba/MG, ${date}.`, 130, 10)
    page.drawLine({ start: { x: 164, y: 35 }, end: { x: 407, y: 35 }, thickness: 0.55, color })
  }

  return Buffer.from(await pdf.save())
}
