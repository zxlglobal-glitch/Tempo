'use client';

import Link from 'next/link';
import { useCallback,useEffect,useMemo,useState } from 'react';
import { supabase } from '@/lib/supabase';
import { exerciseEntries,formatExerciseSummary,type ExerciseDraft,type SavedSet,type SetDraft } from '@/lib/exercise-entries';
import './workout-exercises.css';

type CatalogItem={id:string;name:string;category:string;owner_id:string|null};
type ExerciseLog={id:string;exercise_id:string;exercise_name:string;sets:SavedSet[];performed_on:string;workout_id:string;created_at:string};
const emptySets=():SetDraft[]=>Array.from({length:4},()=>({weight:'',reps:''}));
const errorText=(value:unknown)=>value instanceof Error?value.message:String(value);
const prettify=(date:string)=>new Date(date+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric'});
const describe=(sets:readonly SavedSet[])=>sets.length+' подх. · '+sets.map(s=>s.weight_kg.toLocaleString('ru-RU')+' кг × '+s.reps).join(' / ');
const parseLogs=(rows:unknown):ExerciseLog[]=>(Array.isArray(rows)?rows:[]).map(row=>{
 const record=row as ExerciseLog;
 return {...record,sets:Array.isArray(record.sets)?record.sets:[]};
});

function SmallChart({logs,metric}:{logs:ExerciseLog[];metric:'weight'|'reps'}){
 const points=[...logs].reverse().slice(-18).map(log=>({
   date:log.performed_on,
   value:metric==='weight'
     ?Math.max(...log.sets.map(set=>Number(set.weight_kg)))
     :log.sets.reduce((sum,set)=>sum+Number(set.reps),0)/log.sets.length
 })).filter(p=>Number.isFinite(p.value));
 if(!points.length)return <p className="tempo-ex-muted">Пока нет данных для графика.</p>;
 const values=points.map(p=>p.value);
 const low=Math.min(...values),high=Math.max(...values),range=Math.max(1,high-low);
 const positions=points.map((p,i)=>({x:points.length===1?160:22+276*i/(points.length-1),y:135-100*(p.value-low+range*.2)/(range*1.4),...p}));
 const line=positions.map(p=>p.x+','+p.y).join(' ');
 const first=points[0].date,last=points[points.length-1].date;
 return <div className="tempo-ex-chart">
   <svg viewBox="0 0 320 150" role="img" aria-label={metric==='weight'?'График рабочего веса':'График среднего количества повторений'}>
     {[26,59,92,125].map(y=><line key={y} x1="18" x2="302" y1={y} y2={y} stroke="#e6ebe3" strokeDasharray="3 5"/>)}
     {positions.length>1&&<polyline fill="none" points={line} stroke="#244f40" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round"/>}
     {positions.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r="3" fill="#244f40"><title>{prettify(p.date)}: {Number(p.value.toFixed(1))}</title></circle>)}
   </svg>
   <div className="tempo-ex-chart-labels"><span>{prettify(first)}</span><span>{prettify(last)}</span></div>
 </div>;
}

function ExerciseHistory({rows}:{rows:ExerciseLog[]}){
 const [metric,setMetric]=useState<'weight'|'reps'>('weight');
 if(!rows.length)return <p className="tempo-ex-muted">Пока нет тренировок с этим упражнением. История появится после первой публикации.</p>;
 const sorted=[...rows].sort((a,b)=>b.performed_on.localeCompare(a.performed_on)||b.created_at.localeCompare(a.created_at));
 const latest=sorted[0],oldest=sorted[sorted.length-1];
 const max=(log:ExerciseLog)=>Math.max(...log.sets.map(set=>Number(set.weight_kg)));
 const diff=max(latest)-max(oldest);
 return <section className="tempo-ex-history">
   <div className="tempo-ex-highlight">
     <small>Последняя тренировка · {prettify(latest.performed_on)}</small>
     <strong>{describe(latest.sets)}</strong>
     {rows.length>1&&<span>{diff>0?'+':''}{Number(diff.toFixed(2)).toLocaleString('ru-RU')} кг к первой записи</span>}
   </div>
   <div className="tempo-ex-tabs" role="group" aria-label="Показатель графика">
     <button type="button" className={metric==='weight'?'selected':''} onClick={()=>setMetric('weight')}>Вес, кг</button>
     <button type="button" className={metric==='reps'?'selected':''} onClick={()=>setMetric('reps')}>Повторения</button>
   </div>
   <SmallChart logs={sorted} metric={metric}/>
   <h4>История занятий</h4>
   <div className="tempo-ex-history-list">
     {sorted.slice(0,35).map(log=><Link key={log.id} href={'/workouts/'+log.workout_id}>
       <time>{prettify(log.performed_on)}</time><span>{describe(log.sets)}</span><b aria-hidden="true">›</b>
     </Link>)}
   </div>
 </section>;
}

/** Reusable optional exercise selector on the workout create and edit forms. */
export default function WorkoutExercisePicker({userId,value,onChange,disabled=false}:{
 userId:string|null;value:ExerciseDraft[];onChange:(next:ExerciseDraft[])=>void;disabled?:boolean;
}){
 const [opened,setOpened]=useState(false);
 const [stage,setStage]=useState<'catalog'|'sets'|'history'|'create'>('catalog');
 const [tab,setTab]=useState<'all'|'personal'>('all');
 const [catalog,setCatalog]=useState<CatalogItem[]>([]);
 const [search,setSearch]=useState('');
 const [editor,setEditor]=useState<ExerciseDraft|null>(null);
 const [history,setHistory]=useState<ExerciseLog[]>([]);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [customName,setCustomName]=useState('');
 const [copyWeight,setCopyWeight]=useState(false);
 const [copyReps,setCopyReps]=useState(false);

 const loadCatalog=useCallback(async()=>{
   if(!supabase||!userId)return;
   const result=await supabase.from('tempo_exercises')
     .select('id,name,category,owner_id').order('name',{ascending:true}).limit(600).returns<CatalogItem[]>();
   if(result.error)throw result.error;
   setCatalog(result.data??[]);
 },[userId]);
 useEffect(()=>{if(!opened)return;void loadCatalog().catch(e=>setError(errorText(e)));},[opened,loadCatalog]);
 useEffect(()=>{
   if(!opened)return;
   const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpened(false);};
   window.addEventListener('keydown',close);
   return()=>window.removeEventListener('keydown',close);
 },[opened]);

 const choices=useMemo(()=>catalog.filter(item=>{
   if(tab==='personal' ? item.owner_id!==userId : item.owner_id!==null)return false;
   const needle=search.trim().toLocaleLowerCase('ru-RU');
   return !needle||item.name.toLocaleLowerCase('ru-RU').includes(needle);
 }),[catalog,tab,search,userId]);

 async function getHistory(id:string){
   if(!supabase||!userId)return [];
   const result=await supabase.from('tempo_workout_exercises')
     .select('id,exercise_id,exercise_name,sets,performed_on,workout_id,created_at')
     .eq('user_id',userId).eq('exercise_id',id)
     .order('performed_on',{ascending:false}).order('created_at',{ascending:false})
     .limit(60);
   if(result.error)throw result.error;
   return parseLogs(result.data);
 }
 async function choose(item:CatalogItem){
   setBusy(true);setError('');
   try{
     const rows=await getHistory(item.id);
     setHistory(rows);
     const selected=value.find(entry=>entry.exercise_id===item.id);
     const latest=rows[0];
     setEditor(selected??{
       key:crypto.randomUUID(),exercise_id:item.id,name:item.name,
       sets:latest?.sets.length?latest.sets.map(s=>({weight:String(s.weight_kg),reps:String(s.reps)})):emptySets()
     });
     setCopyWeight(false);setCopyReps(false);setStage('sets');
   }catch(e){setError(errorText(e));}finally{setBusy(false);}
 }
 async function openExisting(item:ExerciseDraft){
   setBusy(true);setError('');
   try{setHistory(await getHistory(item.exercise_id));setEditor({...item,sets:item.sets.map(s=>({...s}))});setStage('sets');setOpened(true);setCopyWeight(false);setCopyReps(false);}
   catch(e){setError(errorText(e));}finally{setBusy(false);}
 }
 function setCount(count:number){
   setEditor(prev=>prev?{...prev,sets:Array.from({length:count},(_,i)=>prev.sets[i]??{
     weight:copyWeight?prev.sets[0]?.weight??'':'',
     reps:copyReps?prev.sets[0]?.reps??'':''
   })}:prev);
 }
 function setField(index:number,field:'weight'|'reps',newValue:string){
   setEditor(prev=>prev?{...prev,sets:prev.sets.map((set,i)=>({
     ...set,
     [field]:(i===index || (index===0 && (field==='weight'?copyWeight:copyReps)))?newValue:set[field]
   }))}:prev);
 }
 function applyAll(field:'weight'|'reps',checked:boolean){
   if(field==='weight')setCopyWeight(checked);else setCopyReps(checked);
   if(checked)setEditor(prev=>prev?{...prev,sets:prev.sets.map(set=>({...set,[field]:prev.sets[0][field]}))}:prev);
 }
 function saveSelection(){
   if(!editor)return;
   try{
     exerciseEntries([editor]);
     const old=value.findIndex(row=>row.exercise_id===editor.exercise_id);
     if(old>=0)onChange(value.map((row,index)=>index===old?editor:row));
     else onChange([...value,editor]);
     setOpened(false);setEditor(null);setError('');
   }catch(e){setError(errorText(e));}
 }
 async function createExercise(){
   if(!supabase||!userId||busy)return;
   const name=customName.trim().replace(/\s+/g,' ');
   if(name.length<2||name.length>100){setError('Название упражнения должно быть от 2 до 100 символов.');return;}
   setBusy(true);setError('');
   const result=await supabase.from('tempo_exercises')
     .insert({name,category:'Мои упражнения',owner_id:userId})
     .select('id,name,category,owner_id').single<CatalogItem>();
   setBusy(false);
   if(result.error){setError(result.error.code==='23505'?'Такое упражнение уже есть в твоём списке.':errorText(result.error));return;}
   if(result.data){setCatalog(prev=>[...prev,result.data!]);setCustomName('');setTab('personal');setSearch('');await choose(result.data);}
 }
 function openPicker(){setOpened(true);setStage('catalog');setSearch('');setError('');}

 return <div className="tempo-exercises-section">
   <button type="button" className="tempo-ex-add" disabled={disabled||!userId} onClick={openPicker}>＋ Добавить упражнения</button>
   <p className="tempo-ex-muted">Необязательно. Можно просто написать тренировку вручную.</p>
   {value.length>0&&<div className="tempo-ex-selected">
     <div className="tempo-ex-selected-head"><strong>Упражнения ({value.length})</strong><button type="button" disabled={disabled} onClick={openPicker}>＋ Добавить</button></div>
     {value.map((entry,index)=><div className="tempo-ex-selected-item" key={entry.key}>
       <span className="tempo-ex-number">{index+1}</span>
       <button type="button" disabled={disabled} className="tempo-ex-selected-main" onClick={()=>void openExisting(entry)}>
         <strong>{entry.name}</strong>
         <small>{entry.sets.length} подх. · {entry.sets.map(s=>s.weight+' кг × '+s.reps).join(' / ')}</small>
       </button>
       <button type="button" className="tempo-ex-remove" disabled={disabled} title="Убрать из тренировки" aria-label={'Убрать '+entry.name}
         onClick={()=>onChange(value.filter(item=>item.key!==entry.key))}>×</button>
     </div>)}
     <div className="tempo-ex-summary"><small>Автоматически добавится в описание:</small><p>{formatExerciseSummary(value)}</p></div>
   </div>}
   {opened&&<div className="tempo-ex-overlay" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)setOpened(false);}}>
     <section className="tempo-ex-dialog" role="dialog" aria-modal="true" aria-label="Добавить упражнения">
       <div className="tempo-ex-dialog-head">
         <div><small>TEMPO / ТРЕНИРОВКА</small><h2>{stage==='catalog'?'Добавить упражнения':stage==='create'?'Своё упражнение':editor?.name||'Прогресс'}</h2></div>
         <button type="button" aria-label="Закрыть" disabled={busy} onClick={()=>setOpened(false)}>×</button>
       </div>
       {error&&<p className="tempo-ex-error" role="alert">{error}</p>}
       {stage==='catalog'&&<>
         <div className="tempo-ex-tabs">
           <button type="button" className={tab==='all'?'selected':''} onClick={()=>setTab('all')}>Общий список</button>
           <button type="button" className={tab==='personal'?'selected':''} onClick={()=>setTab('personal')}>Мои упражнения</button>
         </div>
         <input className="tempo-ex-search" type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Поиск упражнения…" autoFocus/>
         <div className="tempo-ex-catalog">
           {choices.length?choices.map(item=><button key={item.id} className="tempo-ex-catalog-item" type="button" disabled={busy} onClick={()=>void choose(item)}>
             <span><strong>{item.name}</strong><small>{item.category}</small></span><b aria-hidden="true">＋</b>
           </button>):<p className="tempo-ex-muted">Упражнений не найдено.</p>}
         </div>
         <button type="button" className="tempo-ex-create-link" onClick={()=>{setStage('create');setError('');}}>＋ Создать своё упражнение</button>
         {tab==='personal'&&<p className="tempo-ex-muted">Твой личный список доступен только тебе.</p>}
       </>}
       {stage==='create'&&<>
         <label className="tempo-ex-field">Название упражнения
           <input type="text" maxLength={100} value={customName} onChange={e=>setCustomName(e.target.value)} placeholder="Например, жим в Смите" autoFocus/>
         </label>
         <div className="tempo-ex-dialog-actions">
           <button type="button" onClick={()=>setStage('catalog')}>Назад</button>
           <button type="button" className="primary" disabled={busy||customName.trim().length<2} onClick={()=>void createExercise()}>Сохранить</button>
         </div>
       </>}
       {stage==='sets'&&editor&&<>
         {history.length>0&&<div className="tempo-ex-last"><small>Прошлая тренировка · {prettify(history[0].performed_on)}</small><span>{describe(history[0].sets)}</span></div>}
         <div className="tempo-ex-count"><strong>Количество подходов</strong><div className="tempo-ex-counter">
           <button type="button" disabled={editor.sets.length<=1} aria-label="Уменьшить количество подходов" onClick={()=>setCount(editor.sets.length-1)}>−</button>
           <span>{editor.sets.length}</span>
           <button type="button" disabled={editor.sets.length>=20} aria-label="Увеличить количество подходов" onClick={()=>setCount(editor.sets.length+1)}>＋</button>
         </div></div>
         <div className="tempo-ex-sets">
           <div className="tempo-ex-set-head"><span>Подход</span><span>Вес, кг</span><span>Повторения</span></div>
           {editor.sets.map((set,index)=><div className="tempo-ex-set-row" key={index}>
             <span>{index+1}</span>
             <input aria-label={'Вес, подход '+(index+1)} type="number" inputMode="decimal" step="0.5" min="0" max="1000" placeholder="0" value={set.weight}
               onChange={e=>setField(index,'weight',e.target.value)}/>
             <input aria-label={'Повторения, подход '+(index+1)} type="number" inputMode="numeric" step="1" min="1" max="1000" placeholder="10" value={set.reps}
               onChange={e=>setField(index,'reps',e.target.value)}/>
           </div>)}
         </div>
         <div className="tempo-ex-apply">
           <label><input type="checkbox" checked={copyWeight} onChange={e=>applyAll('weight',e.target.checked)}/> Вес из первого подхода — ко всем</label>
           <label><input type="checkbox" checked={copyReps} onChange={e=>applyAll('reps',e.target.checked)}/> Повторения из первого — ко всем</label>
         </div>
         {history.length>0&&<button type="button" className="tempo-ex-history-link" onClick={()=>setStage('history')}>Посмотреть прогресс и историю →</button>}
         <div className="tempo-ex-dialog-actions">
           <button type="button" onClick={()=>setStage('catalog')}>Назад к списку</button>
           <button type="button" className="primary" onClick={saveSelection}>Готово</button>
         </div>
       </>}
       {stage==='history'&&editor&&<>
         <ExerciseHistory rows={history}/>
         <div className="tempo-ex-dialog-actions"><button type="button" className="primary" onClick={()=>setStage('sets')}>Вернуться к подходам</button></div>
       </>}
     </section>
   </div>}
 </div>;
}

/** Personal history is accessible independently, even without starting a new workout. */
export function ExerciseProgressPage({userId}:{userId:string|null}){
 const [rows,setRows]=useState<ExerciseLog[]>([]);
 const [selected,setSelected]=useState<string|null>(null);
 const [query,setQuery]=useState('');
 const [error,setError]=useState('');
 const [loading,setLoading]=useState(true);
 useEffect(()=>{
   let active=true;
   async function load(){
     if(!supabase||!userId){setLoading(false);return;}
     const result=await supabase.from('tempo_workout_exercises')
       .select('id,exercise_id,exercise_name,sets,performed_on,workout_id,created_at')
       .eq('user_id',userId).order('performed_on',{ascending:false}).order('created_at',{ascending:false}).limit(2000);
     if(!active)return;
     if(result.error)setError(errorText(result.error));else setRows(parseLogs(result.data));
     setLoading(false);
   }
   void load();return()=>{active=false;};
 },[userId]);
 const byExercise=useMemo(()=>{
   const map=new Map<string,ExerciseLog[]>();
   for(const row of rows){const list=map.get(row.exercise_id)??[];list.push(row);map.set(row.exercise_id,list);}
   return [...map.entries()].sort((a,b)=>a[1][0].exercise_name.localeCompare(b[1][0].exercise_name,'ru'));
 },[rows]);
 const filtered=byExercise.filter(([,list])=>list[0].exercise_name.toLocaleLowerCase('ru-RU').includes(query.toLocaleLowerCase('ru-RU')));
 const current=selected??filtered[0]?.[0]??null;
 const selectedRows=byExercise.find(([id])=>id===current)?.[1]??[];
 return <section className="tempo-ex-progress-page card">
   <div className="tempo-ex-page-head"><div><small>TEMPO / ПРОФИЛЬ</small><h1>Прогресс упражнений</h1></div>{userId&&<Link href={'/people/'+userId}>← Профиль</Link>}</div>
   {!userId?<p className="tempo-ex-muted">Войди в аккаунт, чтобы увидеть свою историю.</p>
    :loading?<p className="tempo-ex-muted">Загрузка истории…</p>
    :error?<p className="tempo-ex-error" role="alert">{error}</p>
    :byExercise.length===0?<p className="tempo-ex-muted">Пока нет выполненных упражнений. Добавь упражнения к первой тренировке, и здесь появится прогресс.</p>
    :<div className="tempo-ex-progress-layout">
      <aside className="tempo-ex-progress-list">
        <input type="search" value={query} onChange={e=>{setQuery(e.target.value);setSelected(null);}} placeholder="Поиск упражнения"/>
        {filtered.map(([id,list])=><button type="button" className={id===current?'active':''} key={id} onClick={()=>setSelected(id)}>
          <strong>{list[0].exercise_name}</strong><small>{list.length} тренировок</small>
        </button>)}
        {!filtered.length&&<p className="tempo-ex-muted">Ничего не найдено.</p>}
      </aside>
      <div className="tempo-ex-progress-content">{selectedRows.length>0&&<>
        <h2>{selectedRows[0].exercise_name}</h2>
        <ExerciseHistory rows={selectedRows}/>
      </>}</div>
    </div>}
 </section>;
}
