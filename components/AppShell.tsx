'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Files, FilePlus2, LogOut, Scale, Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const items = [
  { href: '/app', label: 'Início', icon: Scale },
  { href: '/app/novo', label: 'Novo documento', icon: FilePlus2 },
  { href: '/app/clientes', label: 'Clientes', icon: Users },
  { href: '/app/documentos', label: 'Documentos', icon: Files },
]

export function AppShell({ children, email }: { children: React.ReactNode; email?: string }) {
  const pathname = usePathname()
  const router = useRouter()

  async function logout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.replace('/login')
    router.refresh()
  }

  return (
    <div className="appFrame">
      <aside className="sidebar">
        <div className="brand"><span className="brandIcon"><Scale size={18} /></span><span>Documentos<br/><strong>Jurídicos</strong></span></div>
        <nav className="sideNav" aria-label="Navegação principal">
          {items.map(({ href, label, icon: Icon }) => {
            const active = href === '/app' ? pathname === href : pathname.startsWith(href)
            return <Link key={href} href={href} className={active ? 'navItem active' : 'navItem'}><Icon size={18} /><span>{label}</span></Link>
          })}
        </nav>
        <div className="sideFooter">
          {email && <div className="userEmail" title={email}>{email}</div>}
          <button className="logoutButton" onClick={logout}><LogOut size={17} /> Sair</button>
        </div>
      </aside>
      <div className="workspace">
        <header className="mobileBar">
          <div className="brand compact"><Scale size={18} /><strong>Documentos Jurídicos</strong></div>
        </header>
        <div className="mobileNav" aria-label="Navegação móvel">
          {items.map(({ href, label, icon: Icon }) => {
            const active = href === '/app' ? pathname === href : pathname.startsWith(href)
            return <Link key={href} href={href} className={active ? 'mobileNavItem active' : 'mobileNavItem'}><Icon size={19}/><span>{label === 'Novo documento' ? 'Novo' : label}</span></Link>
          })}
        </div>
        <main className="content">{children}</main>
      </div>
    </div>
  )
}
