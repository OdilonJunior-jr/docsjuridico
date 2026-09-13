'use client'

import { useEffect, useMemo, useState } from 'react'
import { Download, FileText, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type DocRow = { id:string; kind:'procuracao'|'hipossuficiencia'; created_at:string; docx_path:string; pdf_path:string|null; clients:{full_name:string;cpf:string}|null }

export function DocumentsList() {
  const [query,setQuery]=useState('')
  const [rows,setRows]=useState<DocRow[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')

  useEffect(()=>{ load() },[])
  async function load() {
    const supabase=createClient()
    const {data,error}=await supabase.from('generated_documents').select('id,kind,created_at,docx_path,pdf_path,clients(full_name,cpf)').order('created_at',{ascending:false}).limit(100)
    if(error) setError('Não foi possível carregar os documentos.')
    setRows((data || []) as unknown as DocRow[]); setLoading(false)
  }
  const filtered=useMemo(()=>{
    const q=query.toLowerCase().trim(); const digits=q.replace(/\D/g,'')
    if(!q) return rows
    return rows.filter(r=>r.clients?.full_name?.toLowerCase().includes(q) || (digits && r.clients?.cpf?.replace(/\D/g,'').includes(digits)))
  },[query,rows])
  async function download(path:string) {
    setError('')
    const supabase=createClient()
    const {data,error}=await supabase.storage.from('generated-documents').createSignedUrl(path,120)
    if(error || !data?.signedUrl) { setError('Não foi possível abrir o arquivo.'); return }
    window.open(data.signedUrl,'_blank','noopener,noreferrer')
  }
  return <section className="paperSection">
    <div className="listToolbar"><div className="searchBox"><Search size={17}/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Buscar por nome ou CPF" /></div></div>
    {error && <div className="formError">{error}</div>}
    {loading ? <div className="emptyState">Carregando...</div> : !filtered.length ? <div className="emptyState">Nenhum documento encontrado.</div> : <div className="dataList">
      {filtered.map(row=><div className="dataRow documentDataRow" key={row.id}><div className="rowIcon"><FileText size={18}/></div><div className="rowMain"><strong>{row.kind==='procuracao'?'Procuração':'Declaração de hipossuficiência'}</strong><span>{row.clients?.full_name || 'Cliente'} • {new Intl.DateTimeFormat('pt-BR').format(new Date(row.created_at))}</span></div><div className="downloadActions"><button onClick={()=>download(row.docx_path)} title="Baixar DOCX"><Download size={15}/> DOCX</button>{row.pdf_path && <button onClick={()=>download(row.pdf_path!)} title="Baixar PDF"><Download size={15}/> PDF</button>}</div></div>)}
    </div>}
  </section>
}
