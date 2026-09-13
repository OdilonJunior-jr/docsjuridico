'use client'

import { useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, FileCheck2, FileText, LoaderCircle, LockKeyhole, SearchCheck, Upload, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { extractTextFromFile, parseBrazilianDocumentText } from '@/lib/ocr'
import type { CompanyData, DocumentKind, PersonData } from '@/lib/types'

const emptyPerson: PersonData = {
  nome: '', nacionalidade: '', estadoCivil: '', profissao: '', cpf: '', rg: '', logradouro: '', numero: '', bairro: '', cidade: '', uf: '', cep: '',
}
const emptyCompany: CompanyData = {
  empresaNome: '', cnpj: '', empresaLogradouro: '', empresaNumero: '', empresaBairro: '', empresaCidade: '', empresaUf: '',
}

type SourcePath = { kind: 'identity' | 'residence'; path: string; mimeType: string; originalName: string }
const allowedTypes = ['image/jpeg','image/png','image/webp','application/pdf']

function mergePerson(identity: Partial<PersonData>, residence: Partial<PersonData>): PersonData {
  return {
    nome: identity.nome || residence.nome || '',
    nacionalidade: identity.nacionalidade || '',
    estadoCivil: identity.estadoCivil || '',
    profissao: identity.profissao || '',
    cpf: identity.cpf || residence.cpf || '',
    rg: identity.rg || '',
    logradouro: residence.logradouro || identity.logradouro || '',
    numero: residence.numero || identity.numero || '',
    bairro: residence.bairro || identity.bairro || '',
    cidade: residence.cidade || identity.cidade || '',
    uf: residence.uf || identity.uf || '',
    cep: residence.cep || identity.cep || '',
  }
}

function requiredPerson(kind: DocumentKind, p: PersonData) {
  const common: Array<[keyof PersonData,string]> = [['nome','Nome'],['nacionalidade','Nacionalidade'],['estadoCivil','Estado civil'],['profissao','Profissão'],['cpf','CPF'],['rg','RG'],['logradouro','Logradouro'],['numero','Número'],['bairro','Bairro'],['cidade','Cidade'],['uf','UF']]
  if (kind === 'procuracao') common.push(['cep','CEP'])
  return common.filter(([key]) => !p[key].trim()).map(([,label]) => label)
}
function requiredCompany(c: CompanyData) {
  const fields: Array<[keyof CompanyData,string]> = [['empresaNome','Razão social'],['cnpj','CNPJ'],['empresaLogradouro','Logradouro da empresa'],['empresaNumero','Número da empresa'],['empresaBairro','Bairro da empresa'],['empresaCidade','Cidade da empresa'],['empresaUf','UF da empresa']]
  return fields.filter(([key]) => !c[key].trim()).map(([,label]) => label)
}
function safeName(name: string) { return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 100) }

export function NewDocumentFlow() {
  const [step, setStep] = useState<1|2|3>(1)
  const [identityFile, setIdentityFile] = useState<File | null>(null)
  const [residenceFile, setResidenceFile] = useState<File | null>(null)
  const [person, setPerson] = useState<PersonData>(emptyPerson)
  const [company, setCompany] = useState<CompanyData>(emptyCompany)
  const [kind, setKind] = useState<DocumentKind>('procuracao')
  const [sourcePaths, setSourcePaths] = useState<SourcePath[]>([])
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [generating, setGenerating] = useState<'docx'|'pdf'|null>(null)
  const [error, setError] = useState('')
  const [download, setDownload] = useState<{url:string; filename:string} | null>(null)
  const [extracted, setExtracted] = useState<Set<keyof PersonData>>(new Set())
  const identityRef = useRef<HTMLInputElement>(null)
  const residenceRef = useRef<HTMLInputElement>(null)

  const missing = useMemo(() => {
    const values = requiredPerson(kind, person)
    if (kind === 'hipossuficiencia') values.push(...requiredCompany(company))
    return values
  }, [kind, person, company])

  function validateFile(file: File) {
    if (!allowedTypes.includes(file.type)) return 'Use JPG, PNG, WEBP ou PDF.'
    if (file.size > 10 * 1024 * 1024) return 'O arquivo deve ter no máximo 10 MB.'
    return ''
  }

  async function processDocuments() {
    if (!identityFile || !residenceFile) { setError('Envie o RG ou CNH e o comprovante de residência.'); return }
    const e1 = validateFile(identityFile), e2 = validateFile(residenceFile)
    if (e1 || e2) { setError(e1 || e2); return }
    setError(''); setProcessing(true); setProgress(0); setDownload(null)
    try {
      const identityText = await extractTextFromFile(identityFile, (p) => setProgress(Math.max(5, Math.round(p * 45))))
      setProgress(50)
      const residenceText = await extractTextFromFile(residenceFile, (p) => setProgress(Math.max(50, 50 + Math.round(p * 45))))
      const identity = parseBrazilianDocumentText(identityText)
      const residence = parseBrazilianDocumentText(residenceText)
      const merged = mergePerson(identity, residence)
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
      const stored: SourcePath[] = []
      for (const item of uploads) {
        const path = `${auth.user.id}/drafts/${draftId}/${item.kind}_${safeName(item.file.name)}`
        const { error: uploadError } = await supabase.storage.from('source-documents').upload(path, item.file, { contentType: item.file.type, upsert: false })
        if (uploadError) throw new Error(`Não foi possível armazenar ${item.file.name} com segurança.`)
        stored.push({ kind: item.kind, path, mimeType: item.file.type, originalName: item.file.name })
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
  }
  function updateCompany<K extends keyof CompanyData>(key: K, value: CompanyData[K]) {
    setCompany((old) => ({ ...old, [key]: value }))
  }

  async function generate(output: 'docx'|'pdf') {
    setError(''); setDownload(null)
    if (missing.length) { setError(`Preencha antes de gerar: ${missing.join(', ')}.`); return }
    setGenerating(output)
    try {
      const response = await fetch('/api/documents/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, person, company: kind === 'hipossuficiencia' ? company : undefined, output, sourcePaths }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Falha na geração.')
      setDownload({ url: data.url, filename: data.filename })
      setStep(3)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível gerar o documento.')
    } finally { setGenerating(null) }
  }

  return (
    <div className="flowShell">
      <div className="flowSteps" aria-label="Etapas">
        <span className={step >= 1 ? 'step active' : 'step'}><b>1</b> Envio</span>
        <span className={step >= 2 ? 'step active' : 'step'}><b>2</b> Conferência</span>
        <span className={step >= 3 ? 'step active' : 'step'}><b>3</b> Documento</span>
      </div>

      {step === 1 && <section className="paperSection flowPaper">
        <div className="sectionLead"><div className="sectionIcon"><Upload size={19}/></div><div><h2>Enviar documentos do cliente</h2><p>RG ou CNH e comprovante de residência. A leitura ocorre no navegador e os arquivos são armazenados em área privada.</p></div></div>
        <div className="uploadGrid">
          <FileDrop title="RG ou CNH" description="Imagem ou PDF, até 10 MB" file={identityFile} inputRef={identityRef} onFile={(f) => { setIdentityFile(f); setError('') }} onClear={() => setIdentityFile(null)} />
          <FileDrop title="Comprovante de residência" description="Imagem ou PDF, até 10 MB" file={residenceFile} inputRef={residenceRef} onFile={(f) => { setResidenceFile(f); setError('') }} onClear={() => setResidenceFile(null)} />
        </div>
        {processing && <div className="processingBox"><LoaderCircle className="spin" size={18}/><div><strong>Lendo documentos...</strong><span>Os campos só serão preenchidos quando houver texto identificado.</span></div><div className="progressTrack"><i style={{width:`${progress}%`}}/></div></div>}
        {error && <div className="formError" role="alert">{error}</div>}
        <div className="formActions end"><button className="primaryButton" onClick={processDocuments} disabled={processing || !identityFile || !residenceFile}><SearchCheck size={17}/>{processing ? 'Processando...' : 'Extrair e conferir dados'}</button></div>
      </section>}

      {step === 2 && <section className="paperSection flowPaper">
        <div className="sectionLead"><div className="sectionIcon"><FileCheck2 size={19}/></div><div><h2>Conferência dos dados</h2><p>Revise tudo. Campos que não foram identificados permanecem vazios e precisam ser preenchidos manualmente.</p></div></div>
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

        <div className="subsectionTitle documentChoiceTitle"><span>Documento a gerar</span></div>
        <div className="documentChoice">
          <button className={kind === 'procuracao' ? 'choice active' : 'choice'} onClick={()=>setKind('procuracao')}><FileText size={20}/><span><strong>Procuração</strong><small>Usa o modelo original do escritório.</small></span>{kind === 'procuracao' && <Check size={18}/>}</button>
          <button className={kind === 'hipossuficiencia' ? 'choice active' : 'choice'} onClick={()=>setKind('hipossuficiencia')}><FileText size={20}/><span><strong>Declaração de hipossuficiência</strong><small>Modelo original de pessoa jurídica.</small></span>{kind === 'hipossuficiencia' && <Check size={18}/>}</button>
        </div>

        {kind === 'hipossuficiencia' && <>
          <div className="subsectionTitle"><span>Dados da pessoa jurídica</span><em>Preencha somente o que constar nos documentos do cliente</em></div>
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

        <div className="securityNote"><LockKeyhole size={16}/><span>Os modelos jurídicos são usados como base fixa. Somente os campos variáveis acima e a data atual são substituídos.</span></div>
        {missing.length > 0 && <div className="missingNotice">Campos pendentes: {missing.join(', ')}.</div>}
        {error && <div className="formError" role="alert">{error}</div>}
        <div className="formActions between">
          <button className="secondaryButton" onClick={()=>setStep(1)}><ChevronLeft size={17}/> Voltar</button>
          <div className="buttonGroup">
            <button className="secondaryButton strong" disabled={Boolean(generating)} onClick={()=>generate('docx')}>{generating === 'docx' ? <LoaderCircle className="spin" size={17}/> : <FileText size={17}/>} Gerar DOCX</button>
            <button className="primaryButton" disabled={Boolean(generating)} onClick={()=>generate('pdf')}>{generating === 'pdf' ? <LoaderCircle className="spin" size={17}/> : <FileText size={17}/>} Gerar PDF</button>
          </div>
        </div>
      </section>}

      {step === 3 && <section className="paperSection flowPaper resultPaper">
        <div className="resultIcon"><Check size={26}/></div>
        <h2>Documento gerado</h2>
        <p>O arquivo foi criado a partir do modelo original e salvo no armazenamento privado do escritório.</p>
        {download && <a className="primaryButton" href={download.url} target="_blank" rel="noreferrer"><FileText size={17}/> Abrir {download.filename.endsWith('.pdf') ? 'PDF' : 'DOCX'}</a>}
        <button className="textButton" onClick={()=>{setStep(1);setIdentityFile(null);setResidenceFile(null);setPerson(emptyPerson);setCompany(emptyCompany);setSourcePaths([]);setDownload(null);setExtracted(new Set())}}>Criar outro documento</button>
      </section>}
    </div>
  )
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
