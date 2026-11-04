'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/lib/supabase';
import './body-metrics.css';

type Key = 'height'|'weight'|'waist'|'chest'|'hips'|'biceps'|'thigh'|'neck'|'body_fat';
type Reading = { id: number; metric_key: Key; value: number; measured_on: string; created_at: string };
type Sex = { sex: string|null; sex_visible: boolean };
const items: {key:Key; label:string; unit:string; min:number; max:number}[] = [
  {key:'height',label:'Рост',unit:'см',min:40,max:260},
  {key:'weight',label:'Вес',unit:'кг',min:10,max:500},
  {key:'waist',label:'Талия',unit:'см',min:20,max:250},
  {key:'chest',label:'Грудь',unit:'см',min:20,max:300},
  {key:'hips',label:'Бёдра',unit:'см',min:20,max:300},
  {key:'biceps',label:'Бицепс',unit:'см',min:10,max:100},
  {key:'thigh',label:'Бедро',unit:'см',min:10,max:150},
  {key:'neck',label:'Шея',unit:'см',min:10,max:100},
  {key:'body_fat',label:'Жир',unit:'%',min:1,max:80},
];
const options = [{v:'',t:'Не указано'},{v:'male',t:'Мужской'},{v:'female',t:'Женский'},{v:'other',t:'Другой'},{v:'unspecified',t:'Не хочу указывать'}];
const empty = ():Record<Key,boolean> => Object.fromEntries(items.map(m=>[m.key,false])) as Record<Key,boolean>;
const today = () => {const n=new Date();return new Date(n.getTime()-n.getTimezoneOffset()*60000).toISOString().slice(0,10);};
const dateText = (s:string) => new Date(s+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric'});
const errText = (e:unknown) => e instanceof Error?e.message:String(e);

function Trend({entries,unit}:{entries:Reading[];unit:string}) {
  const points=[...entries].reverse().slice(-60);
  if(!points.length)return <p className="bm-muted">Замеров пока нет</p>;
  const v=points.map(p=>Number(p.value)),lowest=Math.min(...v),highest=Math.max(...v);
  const delta=Math.max(highest-lowest,Math.max(highest*.04,1)),min=lowest-delta*.18,max=highest+delta*.18;
  const xy=points.map((p,i)=>({x:18+(points.length===1?150:i*300/(points.length-1)),y:145-(Number(p.value)-min)*115/(max-min),p}));
  return <div className="bm-trend">
    <svg viewBox="0 0 340 165" role="img" aria-label="История измерений">
      {[30,70,110,145].map(y=><line key={y} x1="18" x2="322" y1={y} y2={y} stroke="#e3e7df" strokeDasharray="3 5"/>)}
      {xy.length>1&&<polyline points={xy.map(a=>a.x+','+a.y).join(' ')} fill="none" stroke="#244f40" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>}
      {xy.map(a=><circle key={a.p.id} cx={a.x} cy={a.y} r="3.4" fill="#244f40"><title>{dateText(a.p.measured_on)}: {a.p.value} {unit}</title></circle>)}
    </svg>
    <div className="bm-between bm-muted"><span>{dateText(points[0].measured_on)}</span><span>{dateText(points[points.length-1].measured_on)}</span></div>
    <p className="bm-muted">Мин. {lowest} {unit} · Макс. {highest} {unit}</p>
  </div>;
}

export default function BodyMetrics({profileId,viewerId}:{profileId:string;viewerId:string|null}) {
  const own=!!viewerId && viewerId===profileId;
  const [open,setOpen]=useState(false),[detail,setDetail]=useState<Key|null>(null);
  const [readings,setReadings]=useState<Reading[]>([]);
  const [sex,setSex]=useState<Sex>({sex:null,sex_visible:false});
  const [visibility,setVisibility]=useState<Record<Key,boolean>>(empty);
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [metric,setMetric]=useState<Key>('weight'),[value,setValue]=useState(''),[measuredOn,setMeasuredOn]=useState(today);
  const close=()=>{setDetail(null);setOpen(false);};
  const refresh=useCallback(async()=>{
    if(!supabase||!viewerId)return;
    setLoading(true);setError('');
    try {
      const [r,p,v]=await Promise.all([
        supabase.from('tempo_body_measurements').select('id,metric_key,value,measured_on,created_at').eq('user_id',profileId).order('measured_on',{ascending:false}).order('created_at',{ascending:false}).limit(2500),
        supabase.from('tempo_body_profile').select('sex,sex_visible').eq('user_id',profileId).maybeSingle(),
        own?supabase.from('tempo_body_metric_visibility').select('metric_key,visible').eq('user_id',profileId):Promise.resolve(null)
      ]);
      if(r.error)throw r.error;if(p.error)throw p.error;if(v?.error)throw v.error;
      setReadings((r.data||[]) as Reading[]);setSex(p.data||{sex:null,sex_visible:false});
      if(own){const next=empty();for(const row of v?.data||[]){if(row.metric_key in next)next[row.metric_key as Key]=!!row.visible;}setVisibility(next);}
    } catch(e){setError(errText(e));} finally{setLoading(false);}
  },[profileId,viewerId,own]);
  useEffect(()=>{if(open)void refresh();},[open,refresh]);
  useEffect(()=>{close();},[profileId]);
  useEffect(()=>{
    if(!open)return;
    const scroll=()=>close();
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape')close();};
    window.addEventListener('scroll',scroll,{capture:true,passive:true});
    window.addEventListener('keydown',key);
    return()=>{window.removeEventListener('scroll',scroll,true);window.removeEventListener('keydown',key);};
  },[open]);
  const latest=useMemo(()=>{const found={} as Partial<Record<Key,Reading>>;for(const r of readings)if(!found[r.metric_key])found[r.metric_key]=r;return found;},[readings]);
  const current=items.find(x=>x.key===metric)!;
  const selected=items.find(x=>x.key===detail);
  const selectedRows=detail?readings.filter(x=>x.metric_key===detail):[];
  async function add(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(!supabase||!own||busy)return;
    const n=Number(value.replace(',','.'));
    if(!Number.isFinite(n)||n<current.min||n>current.max||!measuredOn||measuredOn>today()){setError('Проверь значение и дату измерения');return;}
    setBusy(true);setError('');setNotice('');
    const {error:failure}=await supabase.from('tempo_body_measurements').insert({user_id:profileId,metric_key:metric,value:n,measured_on:measuredOn});
    if(failure)setError(failure.message);else{setValue('');setNotice('Замер добавлен');await refresh();}
    setBusy(false);
  }
  async function saveVisibility(next:Record<Key,boolean>){
    if(!supabase||!own||busy)return;setBusy(true);setError('');
    const {error:failure}=await supabase.from('tempo_body_metric_visibility').upsert(items.map(x=>({user_id:profileId,metric_key:x.key,visible:next[x.key]})),{onConflict:'user_id,metric_key'});
    if(failure)setError(failure.message);else{setVisibility(next);setNotice('Видимость сохранена');}setBusy(false);
  }
  async function saveSex(next:Sex){
    if(!supabase||!own||busy)return;setBusy(true);setError('');
    const {error:failure}=await supabase.from('tempo_body_profile').upsert({user_id:profileId,...next},{onConflict:'user_id'});
    if(failure)setError(failure.message);else setSex(next);setBusy(false);
  }
  async function remove(id:number){
    if(!supabase||!own||busy||!window.confirm('Удалить замер?'))return;
    setBusy(true);const {error:failure}=await supabase.from('tempo_body_measurements').delete().eq('id',id).eq('user_id',profileId);
    if(failure)setError(failure.message);else await refresh();setBusy(false);
  }
  return <>
    <button type="button" className="bm-trigger" aria-label="Моя форма" title="Моя форма" aria-expanded={open} onClick={()=>{setOpen(!open);setNotice('');}}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14M17 5v14M5 8h4M5 16h4M15 8h4M15 16h4M9 12h6"/></svg>
    </button>
    {open&&typeof document!=='undefined'&&createPortal(<>
      <div className="bm-mask" onClick={close}/>
      <section className="bm-dialog" role="dialog" aria-modal="true" aria-label={own?'Моя форма':'Физические показатели'}>
        <div className="bm-top"><div><small>TEMPO / ПРОФИЛЬ</small><h2>{own?'Моя форма':'Показатели'}</h2></div><button className="bm-x" aria-label="Закрыть" onClick={close}>×</button></div>
        <p className="bm-muted">{own?'Личная история измерений':'Открытые измерения пользователя'}</p>
        {!viewerId&&<p className="bm-muted">Войдите для просмотра данных</p>}
        {loading&&<p className="bm-muted">Загрузка…</p>}
        {error&&<p className="bm-error" role="alert">{error}</p>}
        {notice&&<p className="bm-notice" role="status">{notice}</p>}
        {!!viewerId&&<>
          {own&&<div className="bm-sex"><label>Пол <select disabled={busy} value={sex.sex||''} onChange={e=>void saveSex({...sex,sex:e.target.value||null})}>{options.map(o=><option key={o.v} value={o.v}>{o.t}</option>)}</select></label><label className="bm-check"><input type="checkbox" disabled={busy} checked={sex.sex_visible} onChange={e=>void saveSex({...sex,sex_visible:e.target.checked})}/> Видно другим</label></div>}
          {!own&&sex.sex_visible&&sex.sex&&<p>Пол: <strong>{options.find(o=>o.v===sex.sex)?.t}</strong></p>}
          <div className="bm-grid">
            {items.map(x=>{
              const entry=latest[x.key];if(!own&&!entry)return null;
              return <div className="bm-tile" key={x.key}>
                <button className="bm-tile-btn" disabled={!entry} onClick={()=>setDetail(x.key)}>
                  <span>{x.label}</span><strong>{entry?Number(entry.value).toLocaleString('ru-RU'):'—'} <small>{x.unit}</small></strong><small>{entry?dateText(entry.measured_on)+' ↗':'Нет замеров'}</small>
                </button>
                {own&&<label className="bm-check"><input type="checkbox" disabled={busy} checked={visibility[x.key]} onChange={e=>void saveVisibility({...visibility,[x.key]:e.target.checked})}/> Видно другим</label>}
              </div>;
            })}
          </div>
          {!own&&!loading&&!readings.length&&!sex.sex_visible&&<p className="bm-muted">Пользователь не открыл свои показатели.</p>}
          {own&&<>
            <div className="bm-privacy"><span>Показать другим:</span><button disabled={busy} onClick={()=>void saveVisibility(Object.fromEntries(items.map(x=>[x.key,true])) as Record<Key,boolean>)}>Все</button><button disabled={busy} onClick={()=>void saveVisibility(empty())}>Никто</button></div>
            <p className="bm-muted">По умолчанию все показатели скрыты. Если открыть показатель, другие зарегистрированные пользователи увидят всю его историю.</p>
            <form className="bm-add" onSubmit={e=>void add(e)}>
              <h3>Новый замер</h3>
              <div className="bm-fields">
                <label>Показатель<select value={metric} onChange={e=>{setMetric(e.target.value as Key);setValue('');}}>{items.map(x=><option key={x.key} value={x.key}>{x.label}</option>)}</select></label>
                <label>Значение, {current.unit}<input type="number" inputMode="decimal" required step="0.1" min={current.min} max={current.max} value={value} onChange={e=>setValue(e.target.value)}/></label>
                <label>Дата<input type="date" max={today()} required value={measuredOn} onChange={e=>setMeasuredOn(e.target.value)}/></label>
              </div>
              <button className="bm-submit" disabled={busy} type="submit">{busy?'Сохраняем…':'＋ Сохранить замер'}</button>
            </form>
          </>}
        </>}
      </section>
      {detail&&selected&&<div className="bm-chart-mask" onMouseDown={()=>setDetail(null)}>
        <section className="bm-chart-dialog" role="dialog" aria-modal="true" aria-label={'История: '+selected.label} onMouseDown={e=>e.stopPropagation()}>
          <div className="bm-top"><div><small>ИСТОРИЯ ИЗМЕНЕНИЙ</small><h2>{selected.label}</h2></div><button className="bm-x" aria-label="Закрыть график" onClick={()=>setDetail(null)}>×</button></div>
          <Trend entries={selectedRows} unit={selected.unit}/>
          <div className="bm-history">{selectedRows.slice(0,30).map(r=><div key={r.id}><span>{dateText(r.measured_on)}</span><strong>{Number(r.value).toLocaleString('ru-RU')} {selected.unit}</strong>{own&&<button disabled={busy} onClick={()=>void remove(r.id)} aria-label="Удалить замер">×</button>}</div>)}</div>
        </section>
      </div>}
    </>,document.body)}
  </>;
}
