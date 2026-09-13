import fs from 'node:fs/promises'
import path from 'node:path'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
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

export async function convertDocxToPdf(docx: Buffer, filename: string) {
  const baseUrl = process.env.GOTENBERG_URL
  if (!baseUrl) throw new Error('Conversão para PDF não configurada.')
  const form = new FormData()
  form.append('files', new Blob([new Uint8Array(docx)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), filename)
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/forms/libreoffice/convert`, { method: 'POST', body: form, cache: 'no-store' })
  if (!response.ok) throw new Error('Falha na conversão para PDF.')
  return Buffer.from(await response.arrayBuffer())
}
