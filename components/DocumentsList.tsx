'use client'

import { useEffect, useMemo, useState } from 'react'
import { Download, FileText, LoaderCircle, Search, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type DocKind = 'procuracao'|'hipossuficiencia'
type DocRow = { id:string; kind:DocKind; created_at:string; docx_path:string; pdf_path:string|null; clients:{full_name:string;cpf:string}|null }

export function DocumentsList() {
  const [query,setQuery]=useState('')
  const [kind,setKind]=useState<'all'|DocKind>('all')
  const [rows,setRows]=useState<DocRow[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [deletingId,setDeletingId]=useState('')

  useEffect(()=>{ load() },[])
  async function load() {
    setLoading(true); setError('')
    const supabase=createClient()
    const {data,error}=await supabase.from('generated_documents').select('id,kind,created_at,docx_path,pdf_path,clients(full_name,cpf)').order('created_at',{ascending:false}).limit(150)
    if(error) setError('Não foi possível carregar os documentos.')
    setRows((data || []) as unknown as DocRow[]); setLoading(false)
  }
  const filtered=useMemo(()=>{
    const q=query.toLowerCase().trim(); const digits=q.replace(/\D/g,'')
    return rows.filter(r=>{
      if(kind!=='all' && r.kind!==kind) return false
      if(!q) return true
      return r.clients?.full_name?.toLowerCase().includes(q) || Boolean(digits && r.clients?.cpf?.replace(/\D/g,'').includes(digits))
    })
  },[query,rows,kind])

  async function download(path:string) {
    setError('')
    const supabase=createClient()
    const {data,error}=await supabase.storage.from('generated-documents').createSignedUrl(path,120)
    if(error || !data?.signedUrl) { setError('Não foi possível abrir o arquivo.'); return }
    window.open(data.signedUrl,'_blank','noopener,noreferrer')
  }

  async function deleteDocument(row:DocRow) {
    const title=row.kind==='procuracao'?'Procuração':'Declaração de hipossuficiência'
    if(!window.confirm(`Excluir ${title.toLowerCase()} de ${row.clients?.full_name || 'este cliente'}? Os arquivos Word e PDF também serão removidos.`)) return
    setDeletingId(row.id); setError('')
    try {
      const response=await fetch(`/api/documents/${row.id}`,{method:'DELETE'})
      const data=await response.json()
      if(!response.ok) throw new Error(data.error || 'Não foi possível excluir o documento.')
      setRows(old=>old.filter(item=>item.id!==row.id))
    } catch(e) { setError(e instanceof Error ? e.message : 'Não foi possível excluir o documento.') }
    finally { setDeletingId('') }
  }

  return <section className="paperSection">
    <div className="listToolbar documentToolbar">
      <div className="searchBox"><Search size={17}/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Buscar por nome ou CPF" /></div>
      <div className="filterTabs" aria-label="Filtrar documentos">
        <button className={kind==='all'?'active':''} onClick={()=>setKind('all')}>Todos</button>
        <button className={kind==='procuracao'?'active':''} onClick={()=>setKind('procuracao')}>Procurações</button>
        <button className={kind==='hipossuficiencia'?'active':''} onClick={()=>setKind('hipossuficiencia')}>Declarações</button>
      </div>
    </div>
    {error && <div className="formError listError">{error}</div>}
    {loading ? <div className="emptyState">Carregando...</div> : !filtered.length ? <div className="emptyState">Nenhum documento encontrado.</div> : <div className="dataList">
      {filtered.map(row=><div className="dataRow documentDataRow" key={row.id}>
        <div className="rowIcon"><FileText size={18}/></div>
        <div className="rowMain"><strong>{row.kind==='procuracao'?'Procuração':'Declaração de hipossuficiência'}</strong><span>{row.clients?.full_name || 'Cliente'}{row.clients?.cpf ? ` • CPF ${row.clients.cpf}` : ''} • {new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(row.created_at))}</span></div>
        <div className="downloadActions">
          <button onClick={()=>download(row.docx_path)} title="Baixar DOCX"><Download size={15}/> DOCX</button>
          {row.pdf_path && <button onClick={()=>download(row.pdf_path!)} title="Baixar PDF"><Download size={15}/> PDF</button>}
          <button className="dangerAction" onClick={()=>deleteDocument(row)} disabled={deletingId===row.id} title="Excluir documento">{deletingId===row.id?<LoaderCircle className="spin" size={15}/>:<Trash2 size={15}/>} Excluir</button>
        </div>
      </div>)}
    </div>}
  </section>
}
