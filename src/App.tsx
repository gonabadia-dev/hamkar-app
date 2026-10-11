import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { configured, errorText, signUpWithRole, supabase, today } from './lib';
import type { Profile, Role } from './lib';
import { faDate, faDateTime, isoToJalaliInput, jalaliInputToISO, toFaDigits, gregorianToJalali, FA_MONTHS } from './jalali';
import JalaliDatePicker from './JalaliDatePicker';

type Mode = 'login' | 'manager' | 'employee';
type Report = {
  id: string;
  user_id: string;
  report_date: string;
  created_at?: string;
  title: string;
  description: string;
  activity_type: string;
  activity_weight: number;
  completion: number;
  quality: number;
  impact: number;
  timeliness: number;
  score: number | null;
  manager_score: number | null;
  manager_feedback: string | null;
  employee_name?: string;
  audio_path?: string | null;
  audio_analysis?: { summary?: string; action_items?: string[]; mood?: string; sentiment?: string; provider?: string; analysis_method?: string; suggested_score?: number | null } | null;
  audio_transcript?: string | null;
};
type Action = (task: () => Promise<void>) => void;

function todayGregorianIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [page, setPage] = useState<'home' | 'report' | 'join-code'>('home');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!supabase) { setProfileLoading(false); return; }
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (alive) setSession(data.session);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setProfile(null);
      setProfileLoading(Boolean(nextSession));
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    let alive = true;
    if (!supabase || !session?.user?.id) {
      setProfile(null);
      setProfileLoading(false);
      return () => { alive = false; };
    }
    setProfileLoading(true);
    supabase.from('profiles').select('id,full_name,role,organization_id,manager_id')
      .eq('id', session.user.id).maybeSingle()
      .then(({ data, error: fetchError }) => {
        if (!alive) return;
        if (fetchError) {
          setProfile(null);
          setError(fetchError.message);
        } else if (!data) {
          setProfile(null);
          setError('برای این حساب، نمایه‌ای پیدا نشد. از حساب خارج شوید و دوباره وارد شوید؛ اگر مشکل ادامه داشت با مدیر سامانه تماس بگیرید.');
        } else {
          setProfile(data as Profile);
          setError('');
        }
      })
      .catch((cause) => {
        if (!alive) return;
        setProfile(null);
        setError(errorText(cause));
      })
      .finally(() => {
        if (alive) setProfileLoading(false);
      });
    return () => { alive = false; };
  }, [session?.user?.id]);

  const run: Action = async (task) => {
    setError(''); setNotice(''); setBusy(true);
    try { await task(); } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };

  if (!configured) return <main className="narrow"><div className="brand large">هم‌کار</div><p className="alert">برای اتصال، مقادیر VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY را در فایل .env تنظیم کنید.</p></main>;
  if (!session) return <Auth busy={busy} run={run} error={error} notice={notice} setError={setError} setNotice={setNotice} />;
  if (profileLoading) return <main className="narrow"><p>در حال دریافت حساب کاربری…</p></main>;
  if (!profile) return <main className="narrow" dir="rtl">
    <div className="brand large">هم‌کار</div>
    <p className="alert">{error || 'نمایه این حساب در دسترس نیست.'}</p>
    <button disabled={busy} onClick={() => run(async () => {
      const { error: signOutError } = await supabase!.auth.signOut();
      if (signOutError) throw signOutError;
    })}>خروج و ورود دوباره</button>
  </main>;

  return <div className="shell" dir="rtl">
    <header><div className="brand">هم‌کار<small>گزارش روزانه شفاف و منصفانه</small></div>
      <div>{profile.full_name}<button className="ghost" disabled={busy} onClick={() => run(async () => { const { error: signOutError } = await supabase!.auth.signOut(); if (signOutError) throw signOutError; })}>خروج</button></div>
    </header>
    <nav><button onClick={() => setPage('home')}>داشبورد</button>
      {profile.role === 'employee' ? <button onClick={() => setPage('report')}>ثبت گزارش</button> : <button onClick={() => setPage('join-code')}>کد دعوت</button>}
    </nav>
    {error && <p className="alert">{error}</p>}{notice && <p className="success">{notice}</p>}{busy && <p className="muted">در حال انجام…</p>}
    {profile.role === 'employee'
      ? (page === 'report'
        ? <ReportForm profile={profile} run={run} onSaved={(text) => { setNotice(text); setPage('home'); }} />
        : <EmployeeHome profile={profile} setPage={setPage} />)
      : (page === 'join-code' ? <JoinCode run={run} /> : <ManagerHome run={run} setError={setError} profile={profile} />)}
  </div>;
}

function Auth({ busy, run, error, notice, setError, setNotice }: {
  busy: boolean; run: Action; error: string; notice: string;
  setError: (value: string) => void; setNotice: (value: string) => void;
}) {
  const [mode, setMode] = useState<Mode>('login');
  async function register(event: FormEvent<HTMLFormElement>, role: Role) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const result = await signUpWithRole({
      role,
      full_name: String(values.get('full_name') ?? '').trim(),
      email: String(values.get('email') ?? '').trim(),
      password: String(values.get('password') ?? ''),
      ...(role === 'manager' ? { organization_name: String(values.get('organization_name') ?? '').trim() } : { join_code: String(values.get('join_code') ?? '').trim().toUpperCase() }),
    });
    setNotice(result.session ? 'حساب ساخته شد و وارد شدید.' : 'ثبت‌نام انجام شد؛ در صورت فعال بودن تأیید ایمیل، ابتدا ایمیل خود را تأیید کنید.');
    setError('');
    setMode('login');
  }
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await run(async () => {
      const { error: loginError } = await supabase!.auth.signInWithPassword({
        email: String(values.get('email') ?? '').trim(), password: String(values.get('password') ?? ''),
      });
      if (loginError) throw loginError;
    });
  }
  const registration = mode !== 'login';
  return <main className="narrow" dir="rtl">
    <div className="brand large">هم‌کار<small>سامانه گزارش فعالیت روزانه</small></div>
    {error && <p className="alert">{error}</p>}{notice && <p className="success">{notice}</p>}
    {mode === 'login' ? <form className="card" onSubmit={login}>
      <h2>ورود</h2><label>ایمیل<input name="email" type="email" autoComplete="email" required /></label>
      <label>گذرواژه<input name="password" type="password" autoComplete="current-password" required /></label>
      <button disabled={busy}>ورود امن</button>
      <button type="button" className="textbtn" onClick={() => { setError(''); setNotice(''); setMode('manager'); }}>ثبت‌نام مدیر سازمان</button>
      <button type="button" className="textbtn" onClick={() => { setError(''); setNotice(''); setMode('employee'); }}>ثبت‌نام همکار با کد دعوت</button>
    </form> : <form className="card" onSubmit={(event) => run(() => register(event, mode === 'manager' ? 'manager' : 'employee'))}>
      <h2>{mode === 'manager' ? 'ساخت حساب مدیر' : 'ثبت‌نام همکار'}</h2>
      <label>نام و نام خانوادگی<input name="full_name" maxLength={120} required /></label>
      {mode === 'manager' ? <label>نام سازمان<input name="organization_name" maxLength={160} required /></label> : <label>کد دعوت سازمان<input name="join_code" maxLength={12} required /></label>}
      <label>ایمیل<input name="email" type="email" autoComplete="email" required /></label>
      <label>گذرواژه (حداقل ۱۰ نویسه)<input name="password" type="password" minLength={10} autoComplete="new-password" required /></label>
      <p className="muted">{mode === 'manager' ? 'سازمان و پروفایل مدیر به‌صورت خودکار توسط تریگر پایگاه‌داده ساخته می‌شوند.' : 'کد دعوت را از مدیر خود بگیرید؛ اتصال به سازمان به‌صورت خودکار انجام می‌شود.'}</p>
      <button disabled={busy}>{registration && mode === 'manager' ? 'ایجاد سازمان و حساب' : 'ثبت‌نام همکار'}</button>
      <button type="button" className="textbtn" onClick={() => setMode('login')}>بازگشت به ورود</button>
    </form>}
  </main>;
}

function EmployeeHome({ profile, setPage, setError }: { profile: Profile; setPage: (page: 'home' | 'report' | 'join-code') => void; setError: (message: string) => void }) {
 const [report,setReport]=useState<Report|null>(null); const [loading,setLoading]=useState(true);
 const [team,setTeam]=useState<{full_name:string;report_count:number;average_score:number|null}[]>([]);
 const [tasks,setTasks]=useState<{id:string;title:string;description:string;due_date:string|null;task_date:string|null}[]>([]);
 const [monthly,setMonthly]=useState<{key:string;label:string;average:number;count:number}[]>([]);
 useEffect(()=>{let alive=true;const todayIso=today();const [year,month]=todayIso.split('-').map(Number);const first=new Date(Date.UTC(year,month-1-5,1));const from=`${first.getUTCFullYear()}-${String(first.getUTCMonth()+1).padStart(2,'0')}-01`;
 const buckets=new Map<string,{key:string;label:string;sum:number;count:number}>();
 for(let offset=5;offset>=0;offset--){const d=new Date(Date.UTC(year,month-1-offset,1));const [jy,jm]=gregorianToJalali(d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate());const key=`${jy}-${jm}`;buckets.set(key,{key,label:`${FA_MONTHS[jm-1]} ${toFaDigits(jy)}`,sum:0,count:0});}
 const timeout=<T,>(promise:PromiseLike<T>,label:string)=>Promise.race([Promise.resolve(promise),new Promise<never>((_,reject)=>window.setTimeout(()=>reject(new Error(`Timed out loading ${label}; check connection and refresh.`)),15000))]);
 async function load(){setLoading(true);const tasks=[
 timeout(supabase!.from('daily_reports').select('*').eq('user_id',profile.id).eq('report_date',todayIso).maybeSingle(),'today report').then((r:any)=>{if(!alive)return;if(r.error)setError(errorText(r.error));else setReport(r.data as Report|null)}).catch(e=>{if(alive)setError(errorText(e))}),
 timeout(supabase!.rpc('team_activity_overview'),'team summary').then((r:any)=>{if(!alive)return;if(r.error)setError(errorText(r.error));else setTeam((r.data??[]) as any)}).catch(e=>{if(alive)setError(errorText(e))}),
 timeout(supabase!.from('manager_tasks').select('id,title,description,due_date,task_date,status').eq('user_id',profile.id).or(`due_date.gte.${todayIso},task_date.gte.${todayIso}`).in('status',['pending','active']).order('due_date',{ascending:true}),'future tasks').then((r:any)=>{if(!alive)return;if(r.error)setError(errorText(r.error));else setTasks((r.data??[]) as any)}).catch(e=>{if(alive)setError(errorText(e))}),
 timeout(supabase!.from('daily_reports').select('report_date,impact,manager_score,score').eq('user_id',profile.id).gte('report_date',from).lte('report_date',todayIso),'monthly chart').then((r:any)=>{if(!alive)return;if(r.error){setError(errorText(r.error));return}for(const row of (r.data??[])){const x=String(row.report_date).split('-').map(Number);const [jy,jm]=gregorianToJalali(x[0],x[1],x[2]);const bucket=buckets.get(`${jy}-${jm}`);if(bucket){bucket.sum+=Number(row.impact??row.manager_score??row.score??0);bucket.count++}}setMonthly([...buckets.values()].map(x=>({key:x.key,label:x.label,average:x.count?Math.round(x.sum/x.count*10)/10:0,count:x.count}))) }).catch(e=>{if(alive)setError(errorText(e))})
 ];try{await Promise.all(tasks)}finally{if(alive)setLoading(false)}}
 void load();return()=>{alive=false}},[profile.id,setError]);
 const max=Math.max(1,...team.map(x=>Number(x.average_score??0)));const monthlyMax=Math.max(1,...monthly.map(x=>x.average));
 return <main><h1>سلام {profile.full_name}</h1><p className="muted">خلاصه فعالیت امروز شما · {faDate(today())}</p>
 <div className="grid"><section className="card"><span>امتیاز فعالیت امروز</span><strong className="score">{report?.manager_score??report?.score??'—'}</strong><small>امتیاز نهایی سیستم؛ ارزیابی مدیر جداگانه نمایش داده می‌شود.</small></section><section className="card"><span>گزارش امروز</span><strong>{loading?'در حال بارگذاری…':report?'ثبت شده':'هنوز ثبت نشده'}</strong>{report&&<><p>{report.title}</p><small>تاریخ و ساعت ثبت: {faDateTime(report.created_at)}</small></>}</section></div>
 {report?.manager_feedback&&<section className="card"><h3>بازخورد مدیر</h3><p>{report.manager_feedback}</p></section>}{!report&&!loading&&<button onClick={()=>setPage('report')}>ثبت گزارش امروز</button>}
 <section className="card task-list"><div className="card-heading"><div><h2>فعالیت‌های آینده من</h2><p className="muted">تکالیفی که مدیر برای روزهای آینده تخصیص داده است.</p></div><span className="task-count">{toFaDigits(tasks.length)} مورد</span></div>{loading?<p className="muted">در حال بارگذاری تکالیف…</p>:tasks.length?<div className="task-grid">{tasks.map(t=><article className="task-card" key={t.id}><div className="task-date">{faDate(t.due_date||t.task_date)}</div><h3>{t.title}</h3><p>{t.description||'توضیحی برای این فعالیت ثبت نشده است.'}</p></article>)}</div>:<p className="empty-state">در حال حاضر فعالیت آینده‌ای به شما تخصیص داده نشده است.</p>}</section>
 <section className="card"><h2>نمودار مقایسه عملکرد ماه‌ها</h2><p className="muted">میانگین امتیاز اثرگذاری گزارش‌های شما در شش ماه اخیر</p>{loading?<p className="muted">در حال بارگذاری نمودار…</p>:<div className="monthly-chart" role="img" aria-label="Monthly impact score comparison">{monthly.map(m=><div className="monthly-column" key={m.key}><strong>{m.count?toFaDigits(m.average):'—'}</strong><div className="monthly-bar-track"><div className="monthly-bar" style={{height:`${m.count?Math.max(4,m.average/monthlyMax*100):0}%`}} title={`${m.count} reports`}/></div><span>{m.label}</span><small>{toFaDigits(m.count)} گزارش</small></div>)}</div>}</section>
 <section className="card"><h2>فعالیت همکاران</h2><p className="muted">مقایسه امتیاز میانگین و تعداد گزارش‌ها (داده‌های تیم به‌شکل خلاصه)</p>{team.length?<div className="team-chart">{team.map((person,i)=><div className="team-row" key={i}><span>{person.full_name}</span><div className="bar-track"><div className="bar-fill" style={{width:`${Math.max(2,Number(person.average_score??0)/max*100)}%`}}/></div><b>{person.average_score??'—'} · {person.report_count} گزارش</b></div>)}</div>:<p className="muted">هنوز داده‌ای برای نمودار تیم وجود ندارد.</p>}</section></main>;
}

function ReportForm({ profile, run, onSaved }: { profile: Profile; run: Action; onSaved: (message: string) => void }) {
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const [isListening, setIsListening] = useState(false);
  const speechBaseRef = useRef('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [reportDate, setReportDate] = useState(today());
  useEffect(() => { if (!audioBlob) { setAudioUrl(''); return; } const url=URL.createObjectURL(audioBlob);setAudioUrl(url);return()=>URL.revokeObjectURL(url); }, [audioBlob]);
  function startSpeechRecognition(){const SR=(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition;if(!SR)return false;const r=new SR();recognitionRef.current=r;r.lang='fa-IR';r.interimResults=true;r.continuous=true;speechBaseRef.current=descriptionRef.current?.value.trim()||'';r.onresult=(e:any)=>{const txt=Array.from(e.results as Iterable<any>).map((x:any)=>x[0].transcript).join(' ').trim();const ta=descriptionRef.current;if(txt&&ta){ta.value=(speechBaseRef.current?speechBaseRef.current+' ':'')+txt;ta.dispatchEvent(new Event('input',{bubbles:true}))}};r.onend=()=>setIsListening(false);r.onerror=()=>setIsListening(false);try{r.start();setIsListening(true);return true}catch{setIsListening(false);return false}}
  async function toggleRecording(){if(recording){try{recognitionRef.current?.stop()}catch{}setIsListening(false);if(recorderRef.current?.state==='recording')recorderRef.current.stop();setRecording(false);return}if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){window.alert('Audio recording requires microphone permission and HTTPS.');return}try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});const mime=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(x=>MediaRecorder.isTypeSupported(x));const rec=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);chunksRef.current=[];rec.ondataavailable=e=>{if(e.data.size)chunksRef.current.push(e.data)};rec.onstop=()=>{setAudioBlob(new Blob(chunksRef.current,{type:rec.mimeType||'audio/webm'}));stream.getTracks().forEach(t=>t.stop())};recorderRef.current=rec;rec.start();setRecording(true);if(!startSpeechRecognition())window.alert('Recording started; this browser does not support live speech transcription. Try Chrome.')}catch{window.alert('Microphone unavailable; check browser permission and HTTPS.')}}
  useEffect(()=>()=>{try{recognitionRef.current?.stop()}catch{}if(recorderRef.current?.state==='recording')recorderRef.current.stop()},[]);
  const [vals, setVals] = useState({ completion: 100, quality: 80, impact: 70, timeliness: 100 });
  const presets: Record<string, { activity_type: string; weight: number; quality: number }> = {
    'تکمیل وظیفه': { activity_type: 'پروژه', weight: 3, quality: 80 }, 'جلسه': { activity_type: 'جلسه', weight: 2, quality: 80 }, 'پشتیبانی': { activity_type: 'پشتیبانی', weight: 3, quality: 85 }, 'آموزش': { activity_type: 'آموزش', weight: 2, quality: 90 }, 'تحویل مهم': { activity_type: 'پروژه', weight: 5, quality: 95 }
  };
  const score = Math.round((vals.completion*.20 + vals.quality*.35 + vals.impact*.30 + vals.timeliness*.15)*10)/10;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const values=new FormData(event.currentTarget);
    await run(async()=>{const {data:report,error}=await supabase!.from('daily_reports').upsert({organization_id:profile.organization_id,user_id:profile.id,report_date:reportDate,title:String(values.get('title')??'').trim(),description:String(values.get('description')??'').trim(),activity_type:String(values.get('activity_type')??'سایر'),activity_weight:Number(values.get('activity_weight')),completion:Number(values.get('completion')),quality:Number(values.get('quality')),impact:Number(values.get('impact')),timeliness:Number(values.get('timeliness'))},{onConflict:'user_id,report_date'}).select('id').single();if(error)throw error;let audioNote='';if(audioBlob){const ext=audioBlob.type.includes('mp4')?'m4a':'webm';const path=`${profile.organization_id}/${profile.id}/${report.id}/${crypto.randomUUID()}.${ext}`;const {error:uploadError}=await supabase!.storage.from('reports-audio').upload(path,audioBlob,{contentType:audioBlob.type||'audio/webm',upsert:false});if(uploadError)throw new Error(`گزارش ثبت شد اما بارگذاری صوت ناموفق بود: ${uploadError.message}`);const {error:pathError}=await supabase!.from('daily_reports').update({audio_path:path}).eq('id',report.id);if(pathError)throw new Error(`فایل بارگذاری شد اما ثبت مسیر انجام نشد: ${pathError.message}`);const {error:metaError}=await supabase!.from('voice_reports').upsert({report_id:report.id,user_id:profile.id,storage_path:path},{onConflict:'storage_path'});if(metaError)throw new Error(`فایل بارگذاری شد اما ثبت فراداده انجام نشد: ${metaError.message}`);const {error:processError}=await supabase!.functions.invoke('process-audio',{body:{report_id:report.id,storage_path:path}});audioNote=processError?' صوت ذخیره شد؛ تحلیل خودکار در دسترس نیست.':' صوت ذخیره و برای پردازش ارسال شد.';}onSaved('گزارش روزانه با موفقیت ثبت شد.'+audioNote);});
  }
  return <main><h1>ثبت گزارش روزانه</h1><p className="muted">امروز: {faDate(today())} · امتیاز کل به‌طور خودکار محاسبه می‌شود.</p>
    <form className="card formgrid" onSubmit={submit}>
      <JalaliDatePicker label="تاریخ گزارش شمسی" value={reportDate} onChange={setReportDate} required/>
      <div className="wide"><b>قالب‌های آماده</b><div className="template-chips">{Object.entries(presets).map(([name,p])=><button type="button" className="chip-button" key={name} onClick={(e)=>{const f=(e.currentTarget.form as HTMLFormElement);(f.elements.namedItem('activity_type') as HTMLSelectElement).value=p.activity_type;(f.elements.namedItem('activity_weight') as HTMLInputElement).value=String(p.weight);(f.elements.namedItem('quality') as HTMLInputElement).value=String(p.quality);setVals(v=>({...v,quality:p.quality}));if(!(f.elements.namedItem('title') as HTMLInputElement).value)(f.elements.namedItem('title') as HTMLInputElement).value=name;}}>{name}</button>)}</div></div>
      <label className="wide">عنوان فعالیت<input name="title" maxLength={180} required /></label>
      <label className="wide">شرح فعالیت<div className="voice-row"><textarea ref={descriptionRef} name="description" rows={4}/><button type="button" className={recording?'unified-voice-button is-recording':'unified-voice-button'} onClick={toggleRecording} aria-pressed={recording}><span className="record-indicator" aria-hidden="true"/>{recording?'در حال ضبط و تبدیل صدا... (کلیک برای توقف)':'🎙 ضبط صدا و تبدیل گفتار به متن'}</button></div>{recording&&<small className="recording-hint">{isListening?'گفتار فارسی شما هم‌زمان در شرح فعالیت تایپ می‌شود.':'ضبط فعال است؛ رونویسی زنده در مرورگرهای پشتیبانی‌شده فعال می‌شود.'}</small>}{audioUrl&&<div className="audio-preview"><small>پیش‌نمایش صدای ضبط‌شده (فقط در این مرورگر):</small><audio controls src={audioUrl}/><button type="button" className="textbtn" onClick={()=>setAudioBlob(null)}>حذف ضبط</button></div>}</label>
      <label>نوع فعالیت<select name="activity_type"><option>سایر</option><option>پروژه</option><option>جلسه</option><option>پشتیبانی</option><option>آموزش</option><option>عملیات</option></select></label>
      <label>وزن فعالیت (۱ تا ۵)<input name="activity_weight" type="number" min="1" max="5" step="0.1" defaultValue="3" required /></label>
      {(['completion','quality','impact','timeliness'] as const).map((key,i)=>{const labels=['میزان تکمیل','کیفیت','اثرگذاری','به‌موقع بودن'];return <label key={key}>{labels[i]} (%)<input name={key} type="number" min="0" max="100" value={vals[key]} onChange={e=>setVals(v=>({...v,[key]:Number(e.target.value)}))} required/><div className="template-chips">{[0,25,50,75,100].map(n=><button type="button" className="percent-chip" key={n} onClick={()=>setVals(v=>({...v,[key]:n}))}>{toFaDigits(n)}٪</button>)}</div></label>})}
      <div className="score-preview">پیش‌نمایش امتیاز: <strong>{toFaDigits(score)}</strong> از ۱۰۰</div>
      <button className="wide">ثبت گزارش امروز</button>
    </form>
  </main>;
}

function ManagerHome({ run, setError, profile }: { run: Action; setError: (message: string) => void; profile: Profile }) {
  const [reports,setReports]=useState<Report[]>([]); const [people,setPeople]=useState<{id:string;full_name:string}[]>([]); const [tasks,setTasks]=useState<any[]>([]);
  const [loading,setLoading]=useState(true); const [reloadKey,setReloadKey]=useState(0); const [tab,setTab]=useState<'overview'|'reports'|'assign'>('overview');
  const [from,setFrom]=useState('');const [to,setTo]=useState('');const [employee,setEmployee]=useState('');const [taskDate,setTaskDate]=useState('');
  useEffect(()=>{let alive=true;async function load(){setLoading(true);
    const [rr,pp,tt]=await Promise.all([supabase!.from('daily_reports').select('*').order('report_date',{ascending:false}).limit(500),supabase!.from('profiles').select('id,full_name').eq('organization_id',profile.organization_id).eq('role','employee'),supabase!.from('manager_tasks').select('*').order('due_date',{ascending:false}).limit(100)]);
    if(!alive)return;if(rr.error)setError(errorText(rr.error));if(pp.error)setError(errorText(pp.error));if(tt.error&&!String(tt.error.message).includes('manager_tasks'))setError(errorText(tt.error));
    const ps=(pp.data??[]) as {id:string;full_name:string}[];setPeople(ps);setTasks(tt.data??[]);
    const nm=new Map(ps.map(x=>[x.id,x.full_name]));setReports(((rr.data??[]) as Report[]).map(x=>({...x,employee_name:nm.get(x.user_id)??'همکار'})));setLoading(false);
  }void load();return()=>{alive=false}},[reloadKey,profile.organization_id,setError]);
  const filtered=reports.filter(r=>(!employee||r.user_id===employee)&&(!from||r.report_date>=from)&&(!to||r.report_date<=to));
  const avg=filtered.length?Math.round(filtered.reduce((sum,r)=>sum+Number(r.manager_score??r.score??0),0)/filtered.length*10)/10:0;
  const dates=new Set(filtered.map(r=>r.report_date));let missing=0;
  if(from&&to&&from<=to){const cur=new Date(`${from}T12:00:00Z`),end=new Date(`${to}T12:00:00Z`);for(;cur<=end;cur.setUTCDate(cur.getUTCDate()+1)){if(cur.getUTCDay()!==5){for(const person of (employee?people.filter(p=>p.id===employee):people)){if(!reports.some(r=>r.user_id===person.id&&r.report_date===cur.toISOString().slice(0,10)))missing++;}}}}
  function dateVal(form:FormData,key:string){const raw=String(form.get(key)??'');return jalaliInputToISO(raw)||raw;}
   async function createTask(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=e.currentTarget;const v=new FormData(f);await run(async()=>{const emp=String(v.get('user_id'));const resolvedTaskDate=(taskDate&&String(taskDate).trim())?String(taskDate).trim():todayGregorianIso();const {error}=await supabase!.from('manager_tasks').insert({organization_id:profile.organization_id,assigned_by:profile.id,manager_id:profile.id,user_id:emp,title:String(v.get('title')??'').trim(),description:String(v.get('description')??'').trim(),due_date:resolvedTaskDate,task_date:resolvedTaskDate,status:'pending'});if(error)throw error;(f as HTMLFormElement).reset();setTaskDate('');setReloadKey(x=>x+1);});}
  function exportCsv(){const rows=[['کارمند','تاریخ شمسی','زمان ثبت','عنوان','نوع','امتیاز سیستم','امتیاز مدیر'],...filtered.map(r=>[r.employee_name??'',faDate(r.report_date),r.created_at?faDateTime(r.created_at).split(' - ')[1]:'',r.title,r.activity_type,String(r.score??''),String(r.manager_score??'')])];const csv='\ufeff'+rows.map(row=>row.map(cell=>'"'+String(cell).replace(/"/g,'""')+'"').join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='hamkar-reports.csv';a.click();URL.revokeObjectURL(url);}
  const team=people.map(p=>{const rs=reports.filter(r=>r.user_id===p.id);return {name:p.full_name,count:rs.length,score:rs.length?rs.reduce((a,r)=>a+Number(r.manager_score??r.score??0),0)/rs.length:0}});const max=Math.max(1,...team.map(x=>x.score));
  return <main><h1>مدیریت و گزارش‌های تیم</h1><nav className="section-tabs"><button onClick={()=>setTab('overview')}>نمای کلی تیم</button><button onClick={()=>setTab('reports')}>گزارش‌گیری</button><button onClick={()=>setTab('assign')}>ثبت فعالیت آینده</button></nav>
    {tab==='overview'&&<><section className="card"><h2>مقایسه همکاران</h2><p className="muted">میانگین امتیاز و تعداد گزارش‌های بارگذاری‌شده</p>{team.map((x,i)=><div className="team-row" key={i}><span>{x.name}</span><div className="bar-track"><div className="bar-fill" style={{width:`${Math.max(2,x.score/max*100)}%`}}/></div><b>{toFaDigits(x.score.toFixed(1))} · {toFaDigits(x.count)} گزارش</b></div>)}</section><div className="grid"><section className="card"><span>کل گزارش‌ها</span><strong>{toFaDigits(reports.length)}</strong></section><section className="card"><span>اعضای تیم</span><strong>{toFaDigits(people.length)}</strong></section></div><h2>آخرین گزارش‌ها</h2>{reports.slice(0,8).map(r=><ManagerReport key={r.id} row={r} run={run} onSaved={()=>setReloadKey(x=>x+1)}/>)}</>}
    {tab==='reports'&&<><section className="card formgrid report-filters"><JalaliDatePicker label="از تاریخ شمسی" value={from} onChange={setFrom}/><JalaliDatePicker label="تا تاریخ شمسی" value={to} onChange={setTo}/><label>همکار<select value={employee} onChange={e=>setEmployee(e.target.value)}><option value="">همه همکاران</option>{people.map(p=><option value={p.id} key={p.id}>{p.full_name}</option>)}</select></label><div className="wide stats-strip"><div>میانگین امتیاز<strong>{toFaDigits(avg)}</strong></div><div>تعداد گزارش<strong>{toFaDigits(filtered.length)}</strong></div><div>روزهای گزارش‌نشده*<strong>{toFaDigits(missing)}</strong></div></div><button type="button" onClick={exportCsv}>دریافت خروجی CSV</button><small className="wide muted">* محاسبه روزهای غایب وقتی بازه هر دو تاریخ تعیین شده باشد انجام می‌شود؛ جمعه‌ها حذف شده‌اند.</small></section>
    {loading?<p>در حال بارگذاری…</p>:filtered.map(r=><ManagerReport key={r.id} row={r} run={run} onSaved={()=>setReloadKey(x=>x+1)}/>)}</>}
    {tab==='assign'&&<><section className="card"><h2>تخصیص فعالیت برای تاریخ آینده</h2><p className="muted">این مورد به‌صورت تکلیف در پنل همکار نمایش داده می‌شود و گزارش انجام آن جداگانه ثبت خواهد شد.</p><form className="formgrid" onSubmit={createTask}><label>همکار<select name="user_id" required>{people.map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label><JalaliDatePicker label="تاریخ سررسید شمسی" name="due_date" value={taskDate} onChange={setTaskDate} required/><label className="wide">عنوان فعالیت<input name="title" maxLength={180} required/></label><label className="wide">توضیحات<textarea name="description" rows={3}/></label><button className="wide">تخصیص فعالیت</button></form></section><h2>فعالیت‌های تخصیص‌یافته</h2>{tasks.map(t=><article className="card" key={t.id}><b>{people.find(p=>p.id===t.user_id)?.full_name??'همکار'} — {faDate(t.due_date||t.task_date)}</b><p>{t.title}</p><small>{t.description}</small></article>)}</>}
    <button className="ghost" onClick={()=>setReloadKey(x=>x+1)}>به‌روزرسانی</button>
  </main>;
}

function ManagerReport({ row, run, onSaved }: { row: Report; run: Action; onSaved: () => void }) {
  const [voice,setVoice]=useState<any>(null);const [audioUrl,setAudioUrl]=useState('');const [audioLoading,setAudioLoading]=useState(false);const [audioError,setAudioError]=useState('');
  useEffect(()=>{let alive=true;setVoice(null);setAudioUrl('');setAudioError('');setAudioLoading(Boolean(row.audio_path));(async()=>{
    try {
      const {data:voiceData,error:voiceError}=await supabase!.from('voice_reports').select('transcript,summary,suggested_score,storage_path').eq('report_id',row.id).maybeSingle();
      if(!alive)return;
      if(voiceData)setVoice(voiceData);
      const storagePath=row.audio_path||voiceData?.storage_path;
      if(!storagePath){if(voiceError)setAudioError(voiceError.message);setAudioLoading(false);return;}
      setAudioLoading(true);
      const {data:signed,error:signedError}=await supabase!.storage.from('reports-audio').createSignedUrl(storagePath,3600);
      if(!alive)return;
      if(signedError)throw signedError;
      if(!signed?.signedUrl)throw new Error('پیوند امن پخش صوت دریافت نشد.');
      setAudioUrl(signed.signedUrl);
    } catch(cause) {if(alive)setAudioError(errorText(cause));}
    finally {if(alive)setAudioLoading(false);}
  })();return()=>{alive=false}},[row.id,row.audio_path]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await run(async () => {
      const scoreValue = String(values.get('manager_score') ?? '').trim();
      const { error } = await supabase!.from('daily_reports').update({
        manager_score: scoreValue === '' ? null : Number(scoreValue),
        manager_feedback: String(values.get('manager_feedback') ?? '').trim() || null,
      }).eq('id', row.id);
      if (error) throw error;
      onSaved();
    });
  }
  return <article className="card report"><h3>{row.employee_name} — {faDate(row.report_date)} <small>{faDateTime(row.created_at)}</small></h3><b>{row.title}</b><p>{row.description || 'بدون توضیحات'}</p>
    <div className="chips">نوع: {row.activity_type} · وزن: {row.activity_weight} · تکمیل {row.completion}% · کیفیت {row.quality}% · اثر {row.impact}% · به‌موقع {row.timeliness}%</div>
    <p>امتیاز سیستمی: <strong>{row.score ?? '—'}</strong></p>{(row.audio_path||audioUrl)&&<section className="voice-analysis"><div className="audio-card-heading"><b>صدای ضبط‌شده کارمند</b><span className="analysis-badge">{(row.audio_analysis?.provider==='openai_whisper_gpt4o_mini'||voice?.analysis_method==='openai_whisper_gpt4o_mini')?'AI (Whisper/GPT)':'تحلیل اولیه متن (بدون کلید AI)'}</span></div>{audioUrl?<div className="audio-player"><audio controls preload="none" src={audioUrl}/></div>:audioLoading?<p className="muted">در حال آماده‌سازی پخش صوت…</p>:audioError?<p className="audio-error">دریافت صوت ناموفق بود: {audioError}</p>:null}{(row.audio_analysis?.summary||voice?.summary)&&<p><b>خلاصه:</b> {row.audio_analysis?.summary||voice?.summary}</p>}{(row.audio_analysis?.action_items?.length||voice?.action_items?.length)&&<div><b>اقدام‌های پیشنهادی</b><ul>{(row.audio_analysis?.action_items||voice?.action_items||[]).map((item:string,i:number)=><li key={i}>{item}</li>)}</ul></div>}{(row.audio_analysis?.mood||row.audio_analysis?.sentiment)&&<p><b>حال‌وهوا / احساس:</b> {row.audio_analysis.mood||row.audio_analysis.sentiment}</p>}{(row.audio_analysis?.suggested_score??voice?.suggested_score)!=null&&<small>امتیاز پیشنهادی: {row.audio_analysis?.suggested_score??voice?.suggested_score} (برای بررسی مدیر)</small>}{(row.audio_transcript||voice?.transcript)&&<details><summary>رونویسی صوت</summary><p>{row.audio_transcript||voice?.transcript}</p></details>}</section>}
    <form className="inline" onSubmit={save}>
      <label>امتیاز مدیر (۰ تا ۱۰۰)<input name="manager_score" type="number" min="0" max="100" step="0.1" defaultValue={row.manager_score ?? ''} /></label>
      <label>بازخورد<textarea name="manager_feedback" rows={2} defaultValue={row.manager_feedback ?? ''} /></label>
      <button>ذخیره ارزیابی</button>
    </form>
  </article>;
}

function JoinCode({ run }: { run: Action }) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    supabase!.rpc('my_join_code').then(({ data, error }) => {
      if (!alive) return;
      if (error) setCode('خطا در دریافت کد دعوت');
      else setCode(String(data ?? ''));
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);
  return <main><h1>کد دعوت سازمان</h1><section className="card"><p>این کد را به همکاران بدهید تا هنگام ثبت‌نام به سازمان شما متصل شوند.</p><h2 style={{ letterSpacing: 3 }}>{loading ? '…' : code || 'کدی موجود نیست'}</h2>
    <button className="ghost" disabled={loading} onClick={() => run(async () => {
      const { data, error } = await supabase!.rpc('rotate_my_join_code');
      if (error) throw error;
      setCode(String(data ?? ''));
    })}>ساخت کد دعوت جدید</button></section></main>;
}
