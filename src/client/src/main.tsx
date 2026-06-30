import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { Bot, Building2, FileText, LogIn, Power, QrCode, RefreshCw, Upload } from 'lucide-react';
import type { BotCompany } from '../../shared/types';
import './styles.css';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

type ApiCompaniesResponse = {
  ok: boolean;
  companies?: BotCompany[];
  error?: string;
};

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Inicia sesion primero.');
  return { Authorization: `Bearer ${token}` };
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = await authHeaders();
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      ...headers,
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload;
}

function App() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [companies, setCompanies] = useState<BotCompany[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [message, setMessage] = useState('Listo.');
  const [busy, setBusy] = useState(false);
  const [qrImage, setQrImage] = useState<string | null>(null);

  const selectedCompany = useMemo(
    () => companies.find((company) => company.id === selectedCompanyId) ?? companies[0],
    [companies, selectedCompanyId],
  );

  async function refreshCompanies() {
    const result = await api<ApiCompaniesResponse>('/api/panel/companies');
    const nextCompanies = result.companies ?? [];
    setCompanies(nextCompanies);
    setSelectedCompanyId((current) => current || nextCompanies[0]?.id || '');
  }

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setLoggedIn(Boolean(data.session));
      if (data.session) void refreshCompanies().catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Error cargando empresas.'));
    });
  }, []);

  async function signIn() {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      setLoggedIn(true);
      await refreshCompanies();
      setMessage('Sesion iniciada.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo iniciar sesion.');
    } finally {
      setBusy(false);
    }
  }

  async function createCompany() {
    if (!companyName.trim()) return;
    setBusy(true);
    try {
      await api('/api/panel/companies', {
        method: 'POST',
        body: JSON.stringify({ name: companyName.trim() }),
      });
      setCompanyName('');
      await refreshCompanies();
      setMessage('Empresa creada.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo crear empresa.');
    } finally {
      setBusy(false);
    }
  }

  async function connectWhatsApp() {
    if (!selectedCompany) return;
    setBusy(true);
    try {
      await api(`/api/panel/companies/${selectedCompany.id}/connect-whatsapp`, { method: 'POST' });
      await refreshCompanies();
      const status = await api<{ ok: boolean; qrImage: string | null }>(`/api/panel/companies/${selectedCompany.id}/whatsapp-status`);
      setQrImage(status.qrImage);
      setMessage('Conexion iniciada. Escanea el QR cuando aparezca.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo iniciar WhatsApp.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(active: boolean) {
    if (!selectedCompany) return;
    setBusy(true);
    try {
      await api(`/api/panel/companies/${selectedCompany.id}/activation`, {
        method: 'POST',
        body: JSON.stringify({ active }),
      });
      await refreshCompanies();
      setMessage(active ? 'Chatbot activado.' : 'Chatbot desactivado.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo cambiar estado.');
    } finally {
      setBusy(false);
    }
  }

  async function uploadDocument(file: File | null) {
    if (!file || !selectedCompany) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set('file', file);
      await api(`/api/panel/companies/${selectedCompany.id}/documents`, {
        method: 'POST',
        body: form,
      });
      setMessage('Documento procesado y listo para respuestas.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo subir documento.');
    } finally {
      setBusy(false);
    }
  }

  if (!loggedIn) {
    return (
      <main className="login-shell">
        <section className="login-panel">
          <Bot size={34} />
          <h1>Nexus WhatsApp Bot</h1>
          <p>Panel privado para conectar empresas, documentos y respuestas automáticas.</p>
          <input placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
          <input placeholder="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          <button type="button" onClick={() => void signIn()} disabled={busy}>
            <LogIn size={18} /> Entrar
          </button>
          <span>{message}</span>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside>
        <div className="brand"><Bot size={28} /><strong>Nexus Bot</strong></div>
        <div className="company-create">
          <input placeholder="Nueva empresa" value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
          <button type="button" onClick={() => void createCompany()} disabled={busy}><Building2 size={17} />Crear</button>
        </div>
        <nav>
          {companies.map((company) => (
            <button
              type="button"
              key={company.id}
              className={company.id === selectedCompany?.id ? 'active' : ''}
              onClick={() => setSelectedCompanyId(company.id)}
            >
              <span>{company.name}</span>
              <small>{company.whatsappStatus}</small>
            </button>
          ))}
        </nav>
      </aside>
      <section className="workspace">
        <header>
          <div>
            <h1>{selectedCompany?.name ?? 'Empresa'}</h1>
            <p>{selectedCompany?.botActive ? 'Chatbot activo' : 'Chatbot inactivo'} · WhatsApp {selectedCompany?.whatsappStatus ?? 'desconectado'}</p>
          </div>
          <button type="button" className="icon-button" onClick={() => void refreshCompanies()}><RefreshCw size={18} /></button>
        </header>

        <div className="grid">
          <section className="panel">
            <div className="panel-title"><QrCode size={22} /><h2>Conectar WhatsApp</h2></div>
            <p className="notice">Conectaremos este bot usando WhatsApp Web mediante QR. Para empezar recomendamos usar un numero secundario de WhatsApp Business, no el numero principal del negocio, porque este metodo no es el canal oficial de Meta y puede tener limitaciones.</p>
            <button type="button" onClick={() => void connectWhatsApp()} disabled={busy || !selectedCompany}>
              <QrCode size={18} /> Mostrar QR
            </button>
            {qrImage ? (
              <div className="qr-box">
                <img src={qrImage} alt="QR para conectar WhatsApp" />
              </div>
            ) : null}
          </section>

          <section className="panel">
            <div className="panel-title"><Upload size={22} /><h2>Documentos</h2></div>
            <label className="upload">
              <FileText size={18} />
              Subir PDF, Word, Excel o texto
              <input type="file" accept=".pdf,.docx,.xlsx,.csv,.txt,text/plain,application/pdf" onChange={(event) => void uploadDocument(event.target.files?.[0] ?? null)} />
            </label>
          </section>

          <section className="panel">
            <div className="panel-title"><Power size={22} /><h2>Estado</h2></div>
            <button type="button" onClick={() => void toggleActive(!selectedCompany?.botActive)} disabled={busy || !selectedCompany}>
              <Power size={18} /> {selectedCompany?.botActive ? 'Desactivar' : 'Activar'}
            </button>
            <p>{message}</p>
          </section>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
