import type { ExtractionResult } from '@/lib/types'

export type DocumentSourceKind = 'identity' | 'residence' | 'generic'

const STREET_WORDS = /\b(RUA|R\.?|AV(?:ENIDA)?\.?|ALAMEDA|AL\.?|TRAVESSA|TV\.?|RODOVIA|ROD\.?|ESTRADA|EST\.?|PRA[CÇ]A|PCA\.?|LARGO|VIELA|VIA|FAZENDA|S[IÍ]TIO|CH[AÁ]CARA)\b/i
const BAD_NAME = /REP[ÚU]BLICA|FEDERATIVA|BRASIL|CARTEIRA|NACIONAL|HABILITA[CÇ][AÃ]O|DRIVER|LICENSE|VALIDADE|EMISS[AÃ]O|IDENTIDADE|DOCUMENTO|ASSINATURA|FILIA[CÇ][AÃ]O|DETRAN|SECRETARIA|MINIST[EÉ]RIO|TRANSPORTES|CPF|NASCIMENTO|REGISTRO|CATEGORIA|PERMISS[AÃ]O|ENDERE[CÇ]O|UNIDADE|CONSUMIDORA|FATURA|ENERGIA|[ÁA]GUA|TELEFONE|CLIENTE|VENCIMENTO|INSTALA[CÇ][AÃ]O|IDENTIFICA[CÇ][AÃ]O|D[ÉE]BITO|CERTIFICADO|DIGITAL|CONFORMIDADE|CONFIRMAD[AO]|PROGRAMA|ASSINADOR|SERPRO|ORIENTA[CÇ][OÕ]ES|VALIDA[CÇ][AÃ]O|DISPON[IÍ]VEIS|ACESS[EO]|SITE|HTTPS?/i
const LABEL_ONLY = /^(?:\d+[A-Z]?\s*)?(?:NOME(?:\s+E\s+SOBRENOME)?|NAME(?:\s+AND\s+SURNAME)?|CPF(?:\s*\/\s*DATA\s+NASCIMENTO)?|DATA\s+(?:DE\s+)?NASCIMENTO|NASCIMENTO|DOC\.?\s*IDENTIDADE(?:\s*\/.*)?|DOCUMENTO\s+DE\s+IDENTIDADE|IDENTIDADE|RG|ENDERE[CÇ]O(?:\s+DA\s+UNIDADE\s+CONSUMIDORA)?|LOGRADOURO|BAIRRO|MUNIC[IÍ]PIO|CIDADE|CEP|UF|FILIA[CÇ][AÃ]O|ASSINATURA|VALIDADE|DATA\s+EMISS[AÃ]O|N[º°O]?\s*REGISTRO|REGISTRO|HABILITA[CÇ][AÃ]O|CATEGORIA|LOCAL\s+E\s+UF\s+DE\s+NASCIMENTO)\s*[:\-\/]?\s*$/i
const ADDRESS_NOISE = /CPF|CNPJ|CLIENTE|CONTA|INSTALA[CÇ][AÃ]O|REFER[EÊ]NCIA|VENCIMENTO|TOTAL|ENERGIA|[ÁA]GUA|TELEFONE|FATURA|ENDERE[CÇ]O|UNIDADE|CONSUMIDORA|MEDIDOR|LEITURA|EMISS[AÃ]O|PAGAMENTO|DOCUMENTO|PROTOCOLO/i
const PERSON_NAME_NOISE = /\b(?:CONJUNTO|RESIDENCIAL|JARDIM|PARQUE|LOTEAMENTO|BAIRRO|CENTRO|QUADRA|LOTE|EDIF[IÍ]CIO|CONDOM[IÍ]NIO|S(?:\/|\s)?A|LTDA|EIRELI|MEI|CNPJ|N[ÚU]MERO|CONTA|CORRENTE|BANCO|AG[EÊ]NCIA|ASSINATURA|AUTORIZA[CÇ][AÃ]O|D[ÉE]BITO|VALOR|VENCIMENTO|DATA|M[ÊE]S|REFER[EÊ]NCIA|C[ÓO]DIGO|TELEFONE|COMPET[EÊ]NCIA|PAGAMENTO|PLANO|SERVI[CÇ]O|DESCRI[CÇ][AÃ]O|QUANTIDADE|TARIFA|SUBTOTAL|TOTAL|CLIENTE)\b|CLARO|CEMIG|COPASA|ENERGISA|VIVO|TIM|OI\b/i

function clean(value: string) {
  return String(value || '')
    .replace(/[|]/g, 'I')
    .replace(/[ \t]+/g, ' ')
    .replace(/^[-–—:;,\.\s]+|[-–—:;,\.\s]+$/g, '')
    .trim()
}

function normalize(value: string) {
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
}

function onlyDigits(value: string) { return String(value || '').replace(/\D/g, '') }
function digitsFromOcr(value: string) {
  return String(value || '').toUpperCase().replace(/[OQ]/g, '0').replace(/[IL]/g, '1').replace(/[^0-9]/g, '')
}

function formatCpf(value: string) {
  const d = onlyDigits(value).slice(0, 11)
  return d.length === 11 ? `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}` : ''
}
function formatCep(value: string) {
  const d = onlyDigits(value).slice(0, 8)
  return d.length === 8 ? `${d.slice(0,5)}-${d.slice(5)}` : ''
}

function validCpfDigits(d: string) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false
  const digit = (base: string, factor: number) => {
    let sum = 0
    for (const n of base) sum += Number(n) * factor--
    const result = (sum * 10) % 11
    return result === 10 ? 0 : result
  }
  return digit(d.slice(0, 9), 10) === Number(d[9]) && digit(d.slice(0, 10), 11) === Number(d[10])
}

function linesFrom(rawText: string) {
  return rawText.replace(/\r/g, '\n').split(/\n+/).map(clean).filter(Boolean)
}

function cleanPersonName(value: string) {
  let v=clean(value)
  // Colunas de faturas podem chegar coladas ao nome. Corta assim que começa um rótulo
  // administrativo; isso evita "JOAO ... Período de uso" e equivalentes.
  const administrative = /\b(?:CPF|CNPJ|PER[IÍ]ODO(?:\s+DE\s+USO)?|VENCIMENTO|TELEFONE|REFER[EÊ]NCIA|COMPET[EÊ]NCIA|C[ÓO]DIGO|VALOR|DATA|BANCO|AG[EÊ]NCIA|ASSINATURA|N[ÚU]MERO(?:\s+DA)?\s+CONTA|CONTA\s+CORRENTE|D[ÉE]BITO|CLIENTE|PAGAMENTO|FATURA|PLANO|SERVI[CÇ]O)\b/i
  const marker=v.search(administrative)
  if (marker === 0) return ''
  if (marker > 0) v=v.slice(0,marker)
  // Interrompe em QR/mojibake ou símbolos que não pertencem a nomes civis.
  const leading=v.match(/^[A-Za-zÀ-ÿ'’´` -]+/)
  return clean(leading?.[0] || '')
}

function looksLikeName(value: string) {
  const v = cleanPersonName(value)
  if (v.length < 5 || v.length > 100 || /\d/.test(v) || STREET_WORDS.test(v) || BAD_NAME.test(v) || LABEL_ONLY.test(v) || /^(?:NOME|TITULAR)(?:\s+(?:DO|DA|DE))?$/i.test(v)) return false
  const words = v.split(/\s+/).filter(Boolean)
  if (words.length < 2 || words.length > 9) return false
  return v.replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 5
}

function nameScore(value: string) {
  if (!looksLikeName(value)) return -1000
  const v = cleanPersonName(value)
  const words = v.split(/\s+/).filter(Boolean)
  let score = v.replace(/[^A-Za-zÀ-ÿ]/g, '').length + words.length * 6
  if (words.length >= 3) score += 14
  if (words.some(w => w.length <= 1)) score -= 10
  return score
}

function valueAfterLabel(line: string, labels: RegExp[]) {
  const n = normalize(line)
  for (const label of labels) {
    const match = n.match(label)
    if (!match || typeof match.index !== 'number') continue
    const tail = clean(line.slice(match.index + match[0].length).replace(/^\s*[:\-\/]\s*/, ''))
    if (tail && !LABEL_ONLY.test(tail)) return tail
  }
  return ''
}

function nextUseful(lines: string[], index: number, predicate?: (v: string) => boolean, maxLookahead = 5) {
  for (let i = index + 1; i < Math.min(lines.length, index + maxLookahead + 1); i++) {
    const candidate = clean(lines[i])
    if (!candidate || LABEL_ONLY.test(candidate)) continue
    if (!predicate || predicate(candidate)) return candidate
  }
  return ''
}

function firstCpf(text: string, lines: string[]) {
  const compact = text.replace(/\s+/g, ' ')
  for (const match of compact.match(/\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[-.\s]?\d{2}/g) || []) {
    const d = onlyDigits(match)
    if (validCpfDigits(d)) return formatCpf(d)
  }
  for (let i = 0; i < lines.length; i++) {
    if (!/\bCPF\b/i.test(lines[i])) continue
    const context = [lines[i], lines[i + 1] || '', lines[i + 2] || ''].join(' ')
    const beforeBirth = context.split(/DATA\s*(?:DE\s*)?NASCIMENTO|NASCIMENTO/i)[0]
    const d = digitsFromOcr(beforeBirth.replace(/^.*?CPF/i, ''))
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

function mrzName(lines: string[]) {
  for (const line of lines) {
    const compact = line.toUpperCase().replace(/\s+/g, '')
    if (!compact.includes('<<') || !/[A-Z]{2,}<+[A-Z]{2,}/.test(compact)) continue
    const namePayload = /^P<[A-Z]{3}/.test(compact) ? compact.slice(5) : compact
    const candidate = namePayload.replace(/<+/g, ' ').replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim()
    if (looksLikeName(candidate)) return candidate
  }
  return ''
}

const NATIONALITY_LABEL_WORDS = /NACIONALIDADE|NATIONALITY|NACIONALIDAD/i
const IDENTITY_ISSUER = /SSP|SESP|SDS|SSPDS|POL[IÍ]CIA\s*CIVIL|\bPC(?:\s*[-/]?\s*[A-Z]{2})?\b|DETRAN|IFP|DGPC/i

function looksLikeMrz(value: string) {
  const compact = String(value || '').toUpperCase().replace(/\s+/g, '')
  return /<{2,}/.test(compact) || /^[IPACV]?<[A-Z]{3}/.test(compact) || /BRA[0-9A-Z<]{6,}/.test(compact)
}

function sanitizeNationality(value: string) {
  const v = clean(value)
  if (!v || v.length > 35 || /[<>]/.test(v) || /\d/.test(v) || NATIONALITY_LABEL_WORDS.test(v)) return ''
  const normalized = normalize(v)
  const brazilian = normalized.match(/BRASILEIR[OA](?:\(A\))?/)
  if (brazilian) return brazilian[0].toLowerCase()
  // Só aceita um valor textual limpo. Rótulos multilíngues separados por barra ficam de fora.
  if (/[/\\|]/.test(v) || !/^[A-Za-zÀ-ÿ'’(). -]{4,30}$/.test(v)) return ''
  return v.toLowerCase()
}

function findNationality(lines: string[]) {
  // A CNH brasileira costuma imprimir BRASILEIRO(A). Procura primeiro pelo valor real,
  // nunca pelo rótulo multilíngue "nationality / nacionalidad".
  for (const line of lines) {
    const direct = sanitizeNationality(line)
    if (/BRASILEIR/i.test(direct)) return direct
  }
  for (let i = 0; i < lines.length; i++) {
    if (!NATIONALITY_LABEL_WORDS.test(normalize(lines[i]))) continue
    const same = clean(lines[i].replace(/^.*?(?:NACIONALIDADE|NATIONALITY|NACIONALIDAD)\s*[:\-]?\s*/i, ''))
    const sameValue = sanitizeNationality(same)
    if (sameValue) return sameValue
    for (let distance = 1; distance <= 3; distance++) {
      const candidate = sanitizeNationality(lines[i + distance] || '')
      if (candidate) return candidate
    }
  }
  return ''
}

function findGenericName(lines: string[]) {
  const mrz = mrzName(lines)
  if (mrz) return mrz
  const labels = [/NOME\s+E\s+SOBRENOME/i, /NOME\s+DO\s+TITULAR/i, /NOME\s+DO\s+CLIENTE/i, /^CLIENTE$/i, /\bNOME\b/i, /NAME\s+AND\s+SURNAME/i]
  const candidates: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const same = valueAfterLabel(lines[i], labels)
    if (looksLikeName(same)) candidates.push(same)
    if (labels.some(label => label.test(normalize(lines[i])))) {
      const first = nextUseful(lines, i, looksLikeName, 3)
      if (first) {
        candidates.push(first)
        const idx = lines.indexOf(first, i + 1)
        if (idx >= 0 && idx + 1 < lines.length && looksLikeName(lines[idx + 1]) && !LABEL_ONLY.test(lines[idx + 1])) {
          const joined = clean(`${first} ${lines[idx + 1]}`)
          if (joined.split(/\s+/).length <= 8) candidates.push(joined)
        }
      }
    }
  }

  // CNH: nome costuma estar perto de CPF / nascimento. Use apenas linhas plausíveis e pontue a mais completa.
  const anchors = lines.map((line, idx) => (/CPF|NASCIMENTO|HABILITA[CÇ][AÃ]O|DRIVER\s+LICENSE/i.test(line) ? idx : -1)).filter(v => v >= 0)
  for (const anchor of anchors) {
    for (let i = Math.max(0, anchor - 7); i <= Math.min(lines.length - 1, anchor + 5); i++) {
      if (looksLikeName(lines[i])) candidates.push(lines[i])
    }
  }

  if (!candidates.length) {
    const limit = Math.max(1, Math.ceil(lines.length / 3))
    for (let i = 0; i < limit; i++) if (looksLikeName(lines[i])) candidates.push(lines[i])
  }

  return candidates.map(clean).sort((a, b) => nameScore(b) - nameScore(a))[0] || ''
}


function looksLikePersonName(value: string) {
  return looksLikeName(value) && !PERSON_NAME_NOISE.test(normalize(value))
}

function findResidenceName(lines: string[]) {
  const scored: Array<{value:string; score:number; index:number}> = []
  const add = (value:string, score:number, index:number) => {
    const cleanValue=cleanPersonName(value)
    if (!looksLikePersonName(cleanValue)) return
    // Rótulos administrativos nunca podem ser promovidos a nome de pessoa.
    if (/^(?:N[ÚU]MERO|CONTA|BANCO|AG[EÊ]NCIA|ASSINATURA|AUTORIZA[CÇ][AÃ]O|D[ÉE]BITO|VALOR|VENCIMENTO|DATA|M[ÊE]S|REFER[EÊ]NCIA|C[ÓO]DIGO|TELEFONE|COMPET[EÊ]NCIA|PAGAMENTO|CLIENTE)\b/i.test(normalize(cleanValue))) return
    scored.push({value:cleanValue, score:score + nameScore(cleanValue), index})
  }

  const text = lines.join('\n')
  const cpf = firstCpf(text, lines)
  const cpfDigits = onlyDigits(cpf)

  // 1) Maior confiança: o CPF real reconhecido no documento. Procura o titular somente
  //    ao redor da ocorrência desse CPF, não ao redor de qualquer rótulo "CPF/CNPJ".
  if (cpfDigits) {
    for (let i=0;i<lines.length;i++) {
      const digits = onlyDigits(lines[i])
      if (!digits.includes(cpfDigits)) continue

      // Às vezes nome e CPF vêm na mesma linha.
      const withoutCpf = clean(lines[i]
        .replace(/CPF\s*[:\-]?\s*/i,' ')
        .replace(/\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[-.\s]?\d{2}/g,' '))
      add(withoutCpf, 180, i)

      for (let distance=1;distance<=4;distance++) {
        if (i-distance>=0) add(lines[i-distance], 170-distance*10, i-distance)
        if (i+distance<lines.length) add(lines[i+distance], 115-distance*10, i+distance)
      }
    }
  }

  // 2) Rótulos explícitos. "NOME DO CLIENTE" sozinho é rótulo; só o valor ao lado/abaixo conta.
  for (let i=0;i<lines.length;i++) {
    const normalized = normalize(lines[i])
    if (!/^(?:CLIENTE|NOME\s+DO\s+CLIENTE|NOME\s+DO\s+TITULAR|TITULAR)\b/.test(normalized)) continue
    const same=clean(lines[i].replace(/^(?:CLIENTE|NOME\s+DO\s+CLIENTE|NOME\s+DO\s+TITULAR|TITULAR)\s*[:\-]?\s*/i,''))
    add(same,160,i)
    const next=nextUseful(lines,i,looksLikePersonName,3)
    if(next) add(next,150,lines.indexOf(next,i+1))
  }

  // 3) Cabeçalho de comprovante: o titular costuma ficar imediatamente antes do primeiro
  //    logradouro. Limitamos a busca ao início do documento para não cair em formulários anexos.
  const topLimit=Math.min(lines.length,80)
  for (let i=0;i<topLimit;i++) {
    if (!STREET_WORDS.test(lines[i])) continue
    for (let distance=1;distance<=5;distance++) if (i-distance>=0) add(lines[i-distance],145-distance*9,i-distance)
    break
  }

  // 4) Último fallback conservador: somente no cabeçalho. Se nada confiável existir,
  //    deixa vazio em vez de inventar uma frase qualquer de páginas posteriores.
  if (!scored.length) {
    for (let i=0;i<Math.min(lines.length,60);i++) add(lines[i],40,i)
  }

  if (!scored.length) return ''
  // Em empate, favorece a ocorrência mais cedo no documento.
  return scored.sort((a,b)=> (b.score-a.score) || (a.index-b.index))[0].value
}

function findIdentityName(lines: string[]) {
  const mrz=mrzName(lines)
  if (mrz) return mrz
  const labels=[/NOME\s+E\s+SOBRENOME/i,/NAME\s+AND\s+SURNAME/i,/^NOME$/i]
  for(let i=0;i<lines.length;i++) {
    const same=valueAfterLabel(lines[i],labels)
    if(looksLikePersonName(same)) return same
    if(labels.some(label=>label.test(normalize(lines[i])))) {
      const next=nextUseful(lines,i,looksLikePersonName,4)
      if(next) return next
    }
  }
  return findGenericName(lines)
}

function sanitizeIdentityCandidate(value: string, cpf = '') {
  const v = clean(value)
  if (!v || v.length > 48 || looksLikeMrz(v) || /[<>]/.test(v)) return ''
  if (/CPF|NASCIMENTO|VALIDADE|EMISS[AÃ]O|REGISTRO|CATEGORIA|HABILITA[CÇ][AÃ]O|NACIONALIDADE|NATIONALITY|NACIONALIDAD/i.test(v)) return ''
  if (/^\d{2}[./-]\d{2}[./-]\d{2,4}$/.test(v)) return ''
  const digits = onlyDigits(v)
  if (digits.length < 5 || digits.length > 14) return ''
  const cpfDigits = onlyDigits(cpf)
  if (cpfDigits && digits === cpfDigits) return ''
  if (digits.length === 11 && validCpfDigits(digits) && !IDENTITY_ISSUER.test(v)) return ''
  return v
}

function identityCandidateScore(value: string, labeled = false) {
  const v = sanitizeIdentityCandidate(value)
  if (!v) return -1000
  const digits = onlyDigits(v)
  let score = labeled ? 70 : 0
  if (IDENTITY_ISSUER.test(v)) score += 90
  if (/^(?:MG|SP|RJ|ES|PR|SC|RS|BA|PE|CE|GO|DF|PA|AM|MA|PB|RN|AL|SE|PI|MT|MS|RO|RR|AP|AC|TO)\s*[-.]?\s*\d/i.test(v)) score += 55
  if (digits.length >= 7 && digits.length <= 10) score += 35
  if (/\b[A-Z]{2}\s*$/.test(v)) score += 12
  return score
}

function findIdentity(lines: string[], text: string) {
  // Não usa MRZ como RG. A MRZ serve para nome/documento internacional, mas não é o campo
  // "Doc. Identidade / Órg. Emissor / UF" da CNH brasileira.
  const label = /DOC\.?\s*IDENTIDADE(?:\s*\/\s*[ÓO]RG\.?\s*EMISSOR)?(?:\s*\/\s*UF)?|DOCUMENTO\s+DE\s+IDENTIDADE|\bRG\b/i
  const candidates: Array<{ value: string; score: number }> = []
  const add = (value: string, labeled = false) => {
    const cleanValue = sanitizeIdentityCandidate(value)
    if (!cleanValue) return
    candidates.push({ value: cleanValue, score: identityCandidateScore(cleanValue, labeled) })
  }

  for (let i = 0; i < lines.length; i++) {
    if (!label.test(normalize(lines[i]))) continue
    const same = clean(lines[i].replace(/^.*?(?:DOC\.?\s*IDENTIDADE(?:\s*\/\s*[ÓO]RG\.?\s*EMISSOR)?(?:\s*\/\s*UF)?|DOCUMENTO\s+DE\s+IDENTIDADE|RG)\s*[:\-]?\s*/i, ''))
    add(same, true)
    for (let distance = 1; distance <= 4; distance++) add(lines[i + distance] || '', true)
  }

  // Fallback de alta confiança: padrão de RG brasileiro com UF/órgão emissor.
  const globalPatterns = [
    /\b(?:MG|SP|RJ|ES|PR|SC|RS|BA|PE|CE|GO|DF|PA|AM|MA|PB|RN|AL|SE|PI|MT|MS|RO|RR|AP|AC|TO)\s*[.-]?\s*\d[\d. -]{5,15}\s*(?:SSP|SESP|SDS|SSPDS|PC|DETRAN|IFP|DGPC)?\s*(?:[/ -]?\s*[A-Z]{2})?\b/gi,
    /\b\d[\d. -]{5,15}\s+(?:SSP|SESP|SDS|SSPDS|PC|DETRAN|IFP|DGPC)\s*(?:[/ -]?\s*[A-Z]{2})?\b/gi,
  ]
  for (const pattern of globalPatterns) for (const match of text.match(pattern) || []) add(match, false)

  const best = candidates.sort((a, b) => b.score - a.score)[0]
  return best && best.score > 0 ? best.value : ''
}

function cityUfFromLine(line: string) {
  const n = clean(line).toUpperCase()
  const cepPrefixed = n.match(/^(?:\d{5}[-. ]?\d{3})\s*[-–—]?\s*([A-ZÀ-Ÿ][A-ZÀ-Ÿ .'\-]{2,55})\s+([A-Z]{2})\b/)
  if (cepPrefixed) return { cidade: clean(cepPrefixed[1]), uf: cepPrefixed[2] }
  const match = n.match(/^([A-ZÀ-Ÿ][A-ZÀ-Ÿ .'\-]{2,55})\s*(?:\/|\s+-\s+|-)\s*([A-Z]{2})\b/)
  if (!match) return null
  const city = clean(match[1])
  if (/BRASIL|VALIDADE|EMISS|IDENTIDADE|NACIONAL|HABILITA|CATEGORIA/.test(normalize(city))) return null
  return { cidade: city, uf: match[2] }
}

function stripAddressLabel(line: string) {
  return clean(line.replace(/^(?:ENDERE[CÇ]O(?:\s+DA\s+UNIDADE\s+CONSUMIDORA)?|LOGRADOURO)\s*[:\-]?\s*/i, ''))
}

function parseAddress(lines: string[], text: string) {
  const cep = firstCep(text, lines)
  let logradouro = ''
  let numero = ''
  let bairro = ''
  let cidade = ''
  let uf = ''

  let streetIndex = -1
  for (let i = 0; i < lines.length; i++) {
    const same = stripAddressLabel(lines[i])
    if (STREET_WORDS.test(same)) { streetIndex = i; logradouro = same; break }
    if (/ENDERE[CÇ]O|LOGRADOURO/i.test(lines[i])) {
      const next = nextUseful(lines, i, v => STREET_WORDS.test(v), 4)
      if (next) { streetIndex = lines.indexOf(next, i + 1); logradouro = next; break }
    }
  }

  let cepIndex = cep ? lines.findIndex(line => onlyDigits(line).includes(onlyDigits(cep))) : -1
  let cityIndex = -1
  const searchStart = streetIndex >= 0 ? streetIndex : 0
  const searchEnd = cepIndex >= 0 ? Math.min(lines.length, cepIndex + 3) : lines.length
  for (let i = searchStart; i < searchEnd; i++) {
    const found = cityUfFromLine(lines[i])
    if (found) { cidade = found.cidade; uf = found.uf; cityIndex = i; break }
  }
  if (!cidade) {
    for (let i = 0; i < lines.length; i++) {
      const found = cityUfFromLine(lines[i])
      if (found) { cidade = found.cidade; uf = found.uf; cityIndex = i; break }
    }
  }

  // Bairro explicitamente rotulado tem prioridade absoluta.
  for (let i = 0; i < lines.length; i++) {
    if (!/^BAIRRO\b/i.test(normalize(lines[i]))) continue
    const same = clean(lines[i].replace(/^BAIRRO\s*[:\-]?\s*/i, ''))
    if (same && !LABEL_ONLY.test(same)) { bairro = same; break }
    const next = nextUseful(lines, i, v => !/\d{5}[-. ]?\d{3}/.test(v) && !cityUfFromLine(v), 2)
    if (next) { bairro = next; break }
  }

  if (logradouro) {
    logradouro = clean(logradouro.replace(/\bCEP\b.*$/i, '').replace(/\bBAIRRO\b.*$/i, ''))
    // Rua X, 123 - Bairro Y  |  Rua X nº 123
    const m = logradouro.match(/^(.*?)(?:,|\s)\s*(?:N[º°O]?\.?\s*)?(\d{1,6}[A-Z]?)(?:\s*[-–—,]\s*(.*))?$/i)
    if (m && clean(m[1]).length >= 4) {
      logradouro = clean(m[1]); numero = clean(m[2])
      const tail = clean(m[3] || '')
      if (tail) {
        const complementMatch = tail.match(/^((?:CASA|AP(?:ARTAMENTO|TO)?|BLOCO|BL|SALA|LOTE|LT|QUADRA|QD|FUNDOS)\s+[A-Z0-9.-]+)\s+(.*)$/i)
        if (complementMatch) {
          numero = `${numero}, ${clean(complementMatch[1])}`
          const rest = clean(complementMatch[2])
          if (!bairro && rest && !ADDRESS_NOISE.test(rest) && !cityUfFromLine(rest)) bairro = rest
        } else if (!bairro && !ADDRESS_NOISE.test(tail) && !cityUfFromLine(tail) && !/\bCEP\b/i.test(tail)) bairro = tail
      }
    }
  }

  const blockEnd = [cepIndex, cityIndex].filter(i => i > streetIndex).sort((a,b) => a-b)[0] ?? Math.min(lines.length, streetIndex + 6)
  if (streetIndex >= 0) {
    const block = lines.slice(streetIndex + 1, Math.min(lines.length, blockEnd + 1))
    const complement = block.find(v => /^(?:CASA|AP(?:ARTAMENTO|TO)?|BLOCO|BL|SALA|LOTE|LT|QUADRA|QD|FUNDOS)\b/i.test(v)) || ''
    if (!numero) {
      for (const line of block) {
        const n = normalize(line)
        const explicit = line.match(/^(?:N[º°O]?\.?|N[ÚU]MERO)\s*[:\-]?\s*(\d{1,6}[A-Z]?)\b/i)
        if (explicit) { numero = explicit[1]; break }
        if (/^\d{1,6}[A-Z]?$/.test(n)) { numero = clean(line); break }
      }
    }
    if (!bairro) {
      // Escolhe apenas dentro do bloco real de endereço (entre logradouro e cidade/CEP), evitando nome/conta/fatura.
      const candidates = block
        .map(v => clean(v.replace(/^BAIRRO\s*[:\-]?\s*/i, '')))
        .filter(v => v && !/^\d{1,6}[A-Z]?$/.test(normalize(v)) && !/\d{5}[-. ]?\d{3}/.test(v) && !cityUfFromLine(v) && !STREET_WORDS.test(v) && !ADDRESS_NOISE.test(v) && !/^N[º°O]?\.?\s*\d/i.test(v))
      if (candidates.length === 1) bairro = candidates[0]
      else if (candidates.length > 1) bairro = candidates[candidates.length - 1]
    }
    if (numero && complement && !normalize(numero).includes(normalize(complement))) numero = `${numero}, ${clean(complement)}`
  }

  return { cep, logradouro, numero, bairro, cidade, uf }
}

function chooseName(a?: string, b?: string) {
  const av = looksLikeName(a || '') ? cleanPersonName(a || '') : ''
  const bv = looksLikeName(b || '') ? cleanPersonName(b || '') : ''
  if (!av) return bv
  if (!bv) return av
  const an = normalize(av), bn = normalize(bv)
  if (an.includes(bn) && av.length >= bv.length) return av
  if (bn.includes(an) && bv.length >= av.length) return bv
  return nameScore(bv) > nameScore(av) ? bv : av
}

function chooseRg(a?: string, b?: string) {
  const av = sanitizeIdentityCandidate(a || ''), bv = sanitizeIdentityCandidate(b || '')
  if (!av) return bv
  if (!bv) return av
  return identityCandidateScore(bv) > identityCandidateScore(av) ? bv : av
}

function chooseNationality(a?: string, b?: string) {
  const av = sanitizeNationality(a || ''), bv = sanitizeNationality(b || '')
  if (!av) return bv
  if (!bv) return av
  if (/BRASILEIR/i.test(av)) return av
  if (/BRASILEIR/i.test(bv)) return bv
  return av
}

function chooseText(a?: string, b?: string) {
  const av = clean(a || ''), bv = clean(b || '')
  if (!av) return bv
  if (!bv) return av
  const an = normalize(av), bn = normalize(bv)
  if (an === bn) return av.length >= bv.length ? av : bv
  if (an.includes(bn)) return av
  if (bn.includes(an)) return bv
  // Quando os dois OCRs discordam, Engine 3 (primary) continua sendo a fonte principal.
  // Só troca se a alternativa for claramente mais completa e não parecer ruído.
  if (!ADDRESS_NOISE.test(bv) && bv.length >= av.length + 4) return bv
  return av
}

export function mergeExtractionCandidates(primary: ExtractionResult, secondary: ExtractionResult): ExtractionResult {
  return {
    nome: chooseName(primary.nome, secondary.nome),
    nacionalidade: chooseNationality(primary.nacionalidade, secondary.nacionalidade),
    cpf: primary.cpf || secondary.cpf || '',
    rg: chooseRg(primary.rg, secondary.rg),
    logradouro: chooseText(primary.logradouro, secondary.logradouro),
    numero: primary.numero || secondary.numero || '',
    bairro: chooseText(primary.bairro, secondary.bairro),
    cidade: chooseText(primary.cidade, secondary.cidade),
    uf: primary.uf || secondary.uf || '',
    cep: primary.cep || secondary.cep || '',
    rawText: [primary.rawText, secondary.rawText].filter(Boolean).join('\n\n--- OCR ALTERNATIVO ---\n\n'),
  }
}

export function parseBrazilianDocumentText(rawText: string, kind: DocumentSourceKind = 'generic'): ExtractionResult {
  const text = String(rawText || '').replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  const lines = linesFrom(text)
  const nome = kind === 'residence' ? findResidenceName(lines) : kind === 'identity' ? findIdentityName(lines) : findGenericName(lines)
  return {
    nome,
    nacionalidade: kind === 'residence' ? '' : findNationality(lines),
    cpf: firstCpf(text, lines),
    rg: kind === 'residence' ? '' : findIdentity(lines, text),
    ...parseAddress(lines, text),
    rawText: text,
  }
}
