/** Structured workout exercise data. Notes remain optional and independently editable. */
export type SetDraft={weight:string;reps:string};
export type ExerciseDraft={key:string;exercise_id:string;name:string;sets:SetDraft[]};
export type SavedSet={weight_kg:number;reps:number};
export type ExerciseEntry={exercise_id:string;sets:SavedSet[]};
const HEADER='Упражнения:\n';
const SEPARATOR='\n\n'+HEADER;
export function extractManualNotes(body:string):string {
  const start=body.startsWith(HEADER)?0:body.indexOf(SEPARATOR);
  if(start<0)return body;
  return (start===0?'':body.slice(0,start)).trimEnd();
}
export function exerciseEntries(drafts:readonly ExerciseDraft[]):ExerciseEntry[] {
  if(drafts.length>40)throw new Error('В тренировке может быть не больше 40 упражнений.');
  return drafts.map(item=>{
    if(!item.exercise_id || item.sets.length<1 || item.sets.length>20)
      throw new Error('Проверь количество подходов: '+item.name);
    return {exercise_id:item.exercise_id,sets:item.sets.map((set,index)=>{
      const weight=Number(set.weight.replace(',','.'));
      const reps=Number(set.reps);
      if(!set.weight.trim()||!Number.isFinite(weight)||weight<0||weight>1000||!Number.isFinite(reps)||reps<1||reps>1000||!Number.isInteger(reps))
        throw new Error('Проверь вес и повторения в упражнении «'+item.name+'», подход '+(index+1));
      return {weight_kg:weight,reps};
    })};
  });
}
export function formatExerciseSummary(drafts:readonly ExerciseDraft[]):string {
  if(!drafts.length)return '';
  const entries=exerciseEntries(drafts);
  return HEADER+entries.map((entry,index)=>{
    const name=drafts[index].name;
    const allSame=entry.sets.every(set=>set.weight_kg===entry.sets[0].weight_kg&&set.reps===entry.sets[0].reps);
    const describe=(set:SavedSet)=>set.weight_kg.toLocaleString('ru-RU')+' кг × '+set.reps;
    return (index+1)+'. '+name+' — '+(allSame
      ? entry.sets.length+' подх. × '+describe(entry.sets[0])
      : entry.sets.map((set,i)=>(i+1)+') '+describe(set)).join('; '));
  }).join('\n');
}
export function composeWorkoutBody(manual:string,drafts:readonly ExerciseDraft[]):string {
  const notes=manual.trim();
  const summary=formatExerciseSummary(drafts);
  const body=notes && summary?notes+'\n\n'+summary:notes||summary;
  if(body.length>3000)throw new Error('Описание вместе с упражнениями превышает 3000 символов.');
  return body;
}
