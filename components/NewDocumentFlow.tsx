'use client'

import { useMemo, useRef, useState } from 'react'
import { Building2, Check, ChevronLeft, FileCheck2, FileText, LoaderCircle, LockKeyhole, SearchCheck, Upload, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { extractDataFromFile } from '@/lib/ocr'
import type { CompanyData, DocumentKind, PersonData } from '@/lib/types'

const emptyPerson: PersonData = {
  nome: '', nacionalidade: '', estadoCivil: '', profissao: '', cpf: '', rg: '', logradouro: '', numero: '', bairro: '', cidade: '', uf: '', cep: '',
}
const emptyCompany: CompanyData = {
  empresaNome: '', cnpj: '', empresaLogradouro: '', empresaNumero: '', empresaBairro: '', empresaCidade: '', empresaUf: '',
}

type SourcePath = { kind: 'identity' | 'residence'; path: string; mimeType: string; originalName: string }
type GeneratedFile = { kind: DocumentKind; format: 'docx' | 'pdf'; url: string; filename: string }
const allowedTypes = ['image/jpeg','image/png','image/webp','application/pdf']

const SUSPICIOUS_NAME = /ASSINADOR|SERPRO|CERTIFICAD|VALIDADE|CONFIRMAD|PROGRAMA|ORIENTA[CÇ][AÃ]O|DOCUMENTO\s+ASSINADO|MEDIDA\s+PROVIS[ÓO]RIA|HTTPS?|WWW\.|REP[ÚU]BLICA|MINIST[ÉE]RIO|SECRETARIA|QR[- ]?CODE|CONJUNTO|RESIDENCIAL|JARDIM|PARQUE|LOTEAMENTO|BAIRRO|CNPJ|CLARO|\bLTDA\b|\bS\/?A\b/i

function trustedName(value?: string) {
  const v = String(value || '').replace(/\s+/g, ' ').trim()
  if (!v || v.length < 5 || v.length > 100 || /\d/.test(v) || SUSPICIOUS_NAME.test(v)) return ''
  const words = v.split(/\s+/).filter(Boolean)
  return words.length >= 2 && words.length <= 9 ? v : ''
}

function trustedNationality(value?: string) {
  const v = String(value || '').replace(/\s+/g, ' ').trim()
  if (!v || /NACIONALIDADE|NATIONALITY|NACIONALIDAD/i.test(v) || /[<>/\\|]/.test(v) || /\d/.test(v)) return ''
  if (!/^[A-Za-zÀ-ÿ'’(). -]{4,30}$/.test(v)) return ''
  return v
}

function trustedRg(value?: string, cpf?: string) {
  const v = String(value || '').replace(/\s+/g, ' ').trim()
  if (!v || /[<>]/.test(v) || /BRA[0-9A-Z<]{5,}/i.test(v) || /NACIONALIDADE|NATIONALITY|NACIONALIDAD|NASCIMENTO|VALIDADE|REGISTRO|CATEGORIA|CPF/i.test(v)) return ''
  const digits = v.replace(/\D/g, '')
  if (digits.length < 5 || digits.length > 14) return ''
  if (cpf && digits === String(cpf).replace(/\D/g, '')) return ''
  return v
}

function mergePerson(identity: Partial<PersonData>, residence: Partial<PersonData>): PersonData {
  const identityCpf = String(identity.cpf || '').replace(/\D/g, '')
  const residenceCpf = String(residence.cpf || '').replace(/\D/g, '')
  const sameCpf = Boolean(identityCpf && residenceCpf && identityCpf === residenceCpf)
  const identityName = trustedName(identity.nome)
  const residenceName = trustedName(residence.nome)

  // Regra final de segurança: texto de certificado/Serpro nunca pode virar nome.
  // Se o comprovante traz CPF + nome, ele é uma confirmação forte do titular e pode corrigir
  // uma CNH cujo OCR só tenha lido o rodapé/QR. Quando ambos os CPFs existem, exige coincidência.
  let confirmedName = identityName || residenceName
  if (residenceName && residenceCpf && (!identityCpf || sameCpf || !identityName)) confirmedName = residenceName

  return {
    nome: confirmedName,
    nacionalidade: trustedNationality(identity.nacionalidade) || '',
    estadoCivil: identity.estadoCivil || '',
    profissao: identity.profissao || '',
    // Quando o comprovante traz CPF validado, ele confirma o titular e evita manter um CPF mal lido na CNH.
    cpf: residence.cpf || identity.cpf || '',
    rg: trustedRg(identity.rg, residence.cpf || identity.cpf) || '',
    logradouro: residence.logradouro || identity.logradouro || '',
    numero: residence.numero || identity.numero || '',
    bairro: residence.bairro || identity.bairro || '',
    cidade: residence.cidade || identity.cidade || '',
    uf: residence.uf || identity.uf || '',
    cep: residence.cep || identity.cep || '',
  }
}

function requiredPerson(p: PersonData) {
  const fields: Array<[keyof PersonData,string]> = [
    ['nome','Nome'],['nacionalidade','Nacionalidade'],['estadoCivil','Estado civil'],['profissao','Profissão'],['cpf','CPF'],['rg','RG'],
    ['logradouro','Logradouro'],['numero','Número'],['bairro','Bairro'],['cidade','Cidade'],['uf','UF'],['cep','CEP'],
  ]
  return fields.filter(([key]) => !p[key].trim()).map(([,label]) => label)
}
function requiredCompany(c: CompanyData) {
  const fields: Array<[keyof CompanyData,string]> = [
    ['empresaNome','Razão social'],['cnpj','CNPJ'],['empresaLogradouro','Logradouro da empresa'],['empresaNumero','Número da empresa'],
    ['empresaBairro','Bairro da empresa'],['empresaCidade','Cidade da empresa'],['empresaUf','UF da empresa'],
  ]
  return fields.filter(([key]) => !c[key].trim()).map(([,label]) => label)
}
function safeName(name: string) { return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 100) }

export function NewDocumentFlow() {
  const [step, setStep] = useState<1|2|3>(1)
  const [identityFile, setIdentityFile] = useState<File | null>(null)
  const [residenceFile, setResidenceFile] = useState<File | null>(null)
  const [person, setPerson] = useState<PersonData>(emptyPerson)
  const [company, setCompany] = useState<CompanyData>(emptyCompany)
  const [includeCompany, setIncludeCompany] = useState(false)
  const [sourcePaths, setSourcePaths] = useState<SourcePath[]>([])
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [downloads, setDownloads] = useState<GeneratedFile[]>([])
  const [extracted, setExtracted] = useState<Set<keyof PersonData>>(new Set())
  const identityRef = useRef<HTMLInputElement>(null)
  const residenceRef = useRef<HTMLInputElement>(null)

  const missing = useMemo(() => [...requiredPerson(person), ...(includeCompany ? requiredCompany(company) : [])], [person, company, includeCompany])

  function validateFile(file: File) {
    if (!allowedTypes.includes(file.type)) return 'Use JPG, PNG, WEBP ou PDF.'
    if (file.size > 10 * 1024 * 1024) return 'O arquivo deve ter no máximo 10 MB.'
    return ''
  }

  async function processDocuments() {
    if (!identityFile || !residenceFile) { setError('Envie o RG ou CNH e o comprovante de residência.'); return }
    const e1 = validateFile(identityFile), e2 = validateFile(residenceFile)
    if (e1 || e2) { setError(e1 || e2); return }
    setError(''); setProcessing(true); setProgress(0); setDownloads([])
    try {
      const identity = await extractDataFromFile(identityFile, 'identity', (p) => setProgress(Math.max(5, Math.round(p * 45))))
      setProgress(50)
      const residence = await extractDataFromFile(residenceFile, 'residence', (p) => setProgress(Math.max(50, 50 + Math.round(p * 45))))
      const merged = mergePerson(identity, residence)

      const recognizedCount = [merged.nome, merged.cpf, merged.rg, merged.logradouro, merged.numero, merged.bairro, merged.cidade, merged.uf, merged.cep].filter(Boolean).length
      if (recognizedCount === 0) throw new Error('O leitor não identificou nenhum campo confiável. Tente fotos mais nítidas e enquadradas.')

      const extractedKeys = new Set<keyof PersonData>()
      ;(Object.keys(merged) as Array<keyof PersonData>).forEach((key) => { if (merged[key]) extractedKeys.add(key) })
      setPerson(merged)
      setExtracted(extractedKeys)

      const supabase = createClient()
      const { data: auth } = await supabase.auth.getUser()
      if (!auth.user) throw new Error('Sessão expirada. Entre novamente.')
      const draftId = crypto.randomUUID()
      const uploads = [
        { file: identityFile, kind: 'identity' as const },
        { file: residenceFile, kind: 'residence' as const },
      ]
      // Se o usuário voltou e processou novos arquivos, remove o rascunho anterior antes de criar outro.
      if (sourcePaths.length) {
        await supabase.storage.from('source-documents').remove(sourcePaths.map(item=>item.path))
        setSourcePaths([])
      }
      const stored: SourcePath[] = []
      try {
        for (const item of uploads) {
          const path = `${auth.user.id}/drafts/${draftId}/${item.kind}_${safeName(item.file.name)}`
          const { error: uploadError } = await supabase.storage.from('source-documents').upload(path, item.file, { contentType: item.file.type, upsert: false })
          if (uploadError) throw new Error(`Não foi possível armazenar ${item.file.name} com segurança.`)
          stored.push({ kind: item.kind, path, mimeType: item.file.type, originalName: item.file.name })
        }
      } catch (uploadFailure) {
        if (stored.length) await supabase.storage.from('source-documents').remove(stored.map(item=>item.path))
        throw uploadFailure
      }
      setSourcePaths(stored)
      setProgress(100)
      setStep(2)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível ler os documentos.')
    } finally { setProcessing(false) }
  }

  function updatePerson<K extends keyof PersonData>(key: K, value: PersonData[K]) {
    setPerson((old) => ({ ...old, [key]: value }))
    // Depois de uma correção manual, o campo deixa de ser marcado como "extraído".
    setExtracted((old) => { const next=new Set(old); next.delete(key); return next })
  }
  function updateCompany<K extends keyof CompanyData>(key: K, value: CompanyData[K]) {
    setCompany((old) => ({ ...old, [key]: value }))
  }

  async function generateAll() {
    setError(''); setDownloads([])
    if (missing.length) { setError(`Preencha antes de gerar: ${missing.join(', ')}.`); return }
    setGenerating(true)
    try {
      const response = await fetch('/api/documents/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ person, company, includeCompany, sourcePaths }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Falha na geração.')
      const files = Array.isArray(data.files) ? data.files.filter((f: GeneratedFile) => f?.url && f?.filename) : []
      const expectedFiles = includeCompany ? 4 : 2
      if (files.length !== expectedFiles) throw new Error(`Os documentos foram processados, mas ${expectedFiles === 4 ? 'nem todos os quatro arquivos' : 'os dois arquivos da procuração'} ficaram disponíveis para download.`)
      setDownloads(files)
      setStep(3)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível gerar os documentos.')
    } finally { setGenerating(false) }
  }

  function reset() {
    setStep(1); setIdentityFile(null); setResidenceFile(null); setPerson(emptyPerson); setCompany(emptyCompany); setIncludeCompany(false)
    setSourcePaths([]); setDownloads([]); setExtracted(new Set()); setError(''); setProgress(0)
    if (identityRef.current) identityRef.current.value = ''
    if (residenceRef.current) residenceRef.current.value = ''
  }

  const procFiles = downloads.filter(file => file.kind === 'procuracao')
  const declFiles = downloads.filter(file => file.kind === 'hipossuficiencia')

  return (
    <div className="flowShell">
      <div className="flowSteps" aria-label="Etapas">
        <span className={step >= 1 ? 'step active' : 'step'}><b>1</b> Envio</span>
        <span className={step >= 2 ? 'step active' : 'step'}><b>2</b> Conferência</span>
        <span className={step >= 3 ? 'step active' : 'step'}><b>3</b> Documentos</span>
      </div>

      {step === 1 && <section className="paperSection flowPaper">
        <div className="sectionLead"><div className="sectionIcon"><Upload size={19}/></div><div><h2>Enviar documentos do cliente</h2><p>RG ou CNH e comprovante de residência. O sistema faz duas leituras quando necessário e usa o CEP reconhecido para conferir a grafia do endereço.</p></div></div>
        <div className="uploadGrid">
          <FileDrop title="RG ou CNH" description="Imagem ou PDF, até 10 MB" file={identityFile} inputRef={identityRef} onFile={(f) => { setIdentityFile(f); setError('') }} onClear={() => setIdentityFile(null)} />
          <FileDrop title="Comprovante de residência" description="Imagem ou PDF, até 10 MB" file={residenceFile} inputRef={residenceRef} onFile={(f) => { setResidenceFile(f); setError('') }} onClear={() => setResidenceFile(null)} />
        </div>
        {processing && <div className="processingBox"><LoaderCircle className="spin" size={18}/><div><strong>Lendo documentos...</strong><span>Nome, CPF, RG e endereço são extraídos somente quando houver leitura confiável. Nenhum dado ausente é inventado.</span></div><div className="progressTrack"><i style={{width:`${progress}%`}}/></div></div>}
        {error && <div className="formError" role="alert">{error}</div>}
        <div className="formActions end"><button className="primaryButton" onClick={processDocuments} disabled={processing || !identityFile || !residenceFile}><SearchCheck size={17}/>{processing ? 'Processando...' : 'Extrair e conferir dados'}</button></div>
      </section>}

      {step === 2 && <section className="paperSection flowPaper">
        <div className="sectionLead"><div className="sectionIcon"><FileCheck2 size={19}/></div><div><h2>Conferência dos dados</h2><p>Revise a leitura antes de gerar. CNH/RG e comprovante não informam necessariamente estado civil, profissão ou dados da empresa; esses campos ficam vazios até você preencher.</p></div></div>
        <div className="subsectionTitle"><span>Dados do cliente / representante</span><em>Obrigatório revisar</em></div>
        <div className="fieldsGrid">
          <Field label="Nome completo" value={person.nome} onChange={(v)=>updatePerson('nome',v)} extracted={extracted.has('nome')} wide />
          <Field label="Nacionalidade" value={person.nacionalidade} onChange={(v)=>updatePerson('nacionalidade',v)} extracted={extracted.has('nacionalidade')} />
          <Field label="Estado civil" value={person.estadoCivil} onChange={(v)=>updatePerson('estadoCivil',v)} extracted={extracted.has('estadoCivil')} />
          <Field label="Profissão" value={person.profissao} onChange={(v)=>updatePerson('profissao',v)} extracted={extracted.has('profissao')} />
          <Field label="CPF" value={person.cpf} onChange={(v)=>updatePerson('cpf',v)} extracted={extracted.has('cpf')} />
          <Field label="RG" value={person.rg} onChange={(v)=>updatePerson('rg',v)} extracted={extracted.has('rg')} />
          <Field label="Logradouro" value={person.logradouro} onChange={(v)=>updatePerson('logradouro',v)} extracted={extracted.has('logradouro')} wide />
          <Field label="Número" value={person.numero} onChange={(v)=>updatePerson('numero',v)} extracted={extracted.has('numero')} />
          <Field label="Bairro" value={person.bairro} onChange={(v)=>updatePerson('bairro',v)} extracted={extracted.has('bairro')} />
          <Field label="Cidade" value={person.cidade} onChange={(v)=>updatePerson('cidade',v)} extracted={extracted.has('cidade')} />
          <Field label="UF" value={person.uf} onChange={(v)=>updatePerson('uf',v.toUpperCase().slice(0,2))} extracted={extracted.has('uf')} />
          <Field label="CEP" value={person.cep} onChange={(v)=>updatePerson('cep',v)} extracted={extracted.has('cep')} />
        </div>

        <div className="companyToggleBox">
          <label className="switchRow">
            <input type="checkbox" checked={includeCompany} onChange={(e)=>{ setIncludeCompany(e.target.checked); setError('') }} />
            <span className="switchVisual" aria-hidden="true"><i /></span>
            <span><strong>Cliente possui pessoa jurídica</strong><small>Marque somente se for gerar também a declaração de hipossuficiência do modelo empresarial.</small></span>
          </label>
        </div>

        {includeCompany && <>
          <div className="subsectionTitle"><span><Building2 size={15}/> Dados da pessoa jurídica</span><em>Somente para a declaração empresarial</em></div>
          <div className="fieldsGrid">
            <Field label="Razão social / nome empresarial" value={company.empresaNome} onChange={(v)=>updateCompany('empresaNome',v)} wide />
            <Field label="CNPJ" value={company.cnpj} onChange={(v)=>updateCompany('cnpj',v)} />
            <Field label="Logradouro da empresa" value={company.empresaLogradouro} onChange={(v)=>updateCompany('empresaLogradouro',v)} wide />
            <Field label="Número" value={company.empresaNumero} onChange={(v)=>updateCompany('empresaNumero',v)} />
            <Field label="Bairro" value={company.empresaBairro} onChange={(v)=>updateCompany('empresaBairro',v)} />
            <Field label="Cidade" value={company.empresaCidade} onChange={(v)=>updateCompany('empresaCidade',v)} />
            <Field label="UF" value={company.empresaUf} onChange={(v)=>updateCompany('empresaUf',v.toUpperCase().slice(0,2))} />
          </div>
        </>}

        <div className="outputSummary">
          <FileText size={18}/><div><strong>{includeCompany ? 'Serão gerados 4 arquivos' : 'Serão gerados 2 arquivos'}</strong><span>{includeCompany ? 'Procuração em Word e PDF + Declaração de hipossuficiência empresarial em Word e PDF.' : 'Procuração em Word e PDF. A declaração empresarial só é gerada quando a opção de pessoa jurídica estiver marcada.'}</span></div>
        </div>
        <div className="securityNote"><LockKeyhole size={16}/><span>Os textos jurídicos e os dados fixos da advogada permanecem nos modelos originais. Só os campos variáveis e a data atual são substituídos.</span></div>
        {missing.length > 0 && <div className="missingNotice">Campos pendentes: {missing.join(', ')}.</div>}
        {error && <div className="formError" role="alert">{error}</div>}
        <div className="formActions between">
          <button className="secondaryButton" onClick={()=>setStep(1)}><ChevronLeft size={17}/> Voltar</button>
          <button className="primaryButton" disabled={generating} onClick={generateAll}>{generating ? <LoaderCircle className="spin" size={17}/> : <FileText size={17}/>} {generating ? `Gerando ${includeCompany ? '4' : '2'} arquivos...` : includeCompany ? 'Gerar os 2 documentos — Word + PDF' : 'Gerar procuração — Word + PDF'}</button>
        </div>
      </section>}

      {step === 3 && <section className="paperSection flowPaper resultPaper">
        <div className="resultIcon"><Check size={26}/></div>
        <h2>Documentos gerados</h2>
        <p>{includeCompany ? 'Procuração e declaração foram criadas nos dois formatos e salvas no armazenamento privado do escritório.' : 'A procuração foi criada em Word e PDF e salva no armazenamento privado do escritório.'}</p>
        <div className={includeCompany ? "resultFiles" : "resultFiles singleResult"}>
          <ResultGroup title="Procuração" files={procFiles} />
          {includeCompany && <ResultGroup title="Declaração de hipossuficiência" files={declFiles} />}
        </div>
        <button className="textButton" onClick={reset}>Criar outro documento</button>
      </section>}
    </div>
  )
}

function ResultGroup({ title, files }: { title: string; files: GeneratedFile[] }) {
  return <div className="resultFileGroup"><strong>{title}</strong><div>
    {(['docx','pdf'] as const).map(format => {
      const file = files.find(item => item.format === format)
      return file ? <a key={format} className={format === 'pdf' ? 'primaryButton' : 'secondaryButton strong'} href={file.url} target="_blank" rel="noreferrer"><FileText size={16}/> {format === 'pdf' ? 'PDF' : 'Word (.docx)'}</a> : null
    })}
  </div></div>
}

function FileDrop({ title, description, file, inputRef, onFile, onClear }: { title:string; description:string; file:File|null; inputRef:React.RefObject<HTMLInputElement | null>; onFile:(f:File)=>void; onClear:()=>void }) {
  return <div className={file ? 'fileDrop hasFile' : 'fileDrop'} onClick={()=>inputRef.current?.click()} onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{e.preventDefault(); const f=e.dataTransfer.files?.[0]; if(f) onFile(f)}}>
    <input ref={inputRef} hidden type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e)=>{const f=e.target.files?.[0]; if(f) onFile(f)}}/>
    {file ? <><div className="dropIcon ok"><FileCheck2 size={20}/></div><div><strong>{file.name}</strong><span>{Math.max(0.1,file.size/1024/1024).toFixed(1)} MB</span></div><button type="button" className="clearFile" onClick={(e)=>{e.stopPropagation(); if(inputRef.current) inputRef.current.value=''; onClear();}} aria-label="Remover arquivo"><X size={16}/></button></> : <><div className="dropIcon"><Upload size={20}/></div><div><strong>{title}</strong><span>{description}</span></div></>}
  </div>
}

function Field({ label, value, onChange, extracted, wide }: { label:string; value:string; onChange:(value:string)=>void; extracted?:boolean; wide?:boolean }) {
  return <label className={wide ? 'field wide' : 'field'}><span>{label}{extracted && <em title="Extraído do documento"><Check size={12}/> extraído</em>}</span><input value={value} onChange={(e)=>onChange(e.target.value)} placeholder={value ? '' : 'Preencher'} /></label>
}
