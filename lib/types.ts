export type PersonData = {
  nome: string
  nacionalidade: string
  estadoCivil: string
  profissao: string
  cpf: string
  rg: string
  logradouro: string
  numero: string
  bairro: string
  cidade: string
  uf: string
  cep: string
}

export type CompanyData = {
  empresaNome: string
  cnpj: string
  empresaLogradouro: string
  empresaNumero: string
  empresaBairro: string
  empresaCidade: string
  empresaUf: string
}

export type DocumentKind = 'procuracao' | 'hipossuficiencia'

export type ExtractionResult = Partial<PersonData> & {
  rawText?: string
}
