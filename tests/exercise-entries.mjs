import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const source=await readFile(new URL('../src/lib/exercise-entries.ts',import.meta.url),'utf8');
const helpers=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
const {exerciseEntries,composeWorkoutBody,extractManualNotes,formatExerciseSummary}=helpers;
const lift=(sets)=>({key:'draft',exercise_id:'11111111-1111-4111-8111-111111111111',name:'Жим лёжа',sets});

test('all four sets retain individual weights and repetitions',()=>{
 const item=lift([{weight:'80',reps:'10'},{weight:'85',reps:'8'},{weight:'80',reps:'10'},{weight:'75',reps:'12'}]);
 assert.deepEqual(exerciseEntries([item])[0].sets,[
  {weight_kg:80,reps:10},{weight_kg:85,reps:8},{weight_kg:80,reps:10},{weight_kg:75,reps:12}
 ]);
 assert.match(formatExerciseSummary([item]),/1\.\sЖим лёжа/);
 assert.match(formatExerciseSummary([item]),/2\)\s85 кг × 8/);
});
test('uniform sets produce a compact numbered summary and do not remove user notes',()=>{
 const chosen=[lift(Array.from({length:4},()=>({weight:'80',reps:'10'})))];
 const body=composeWorkoutBody('Было тяжело, но справился.',chosen);
 assert.match(body,/4 подх\. × 80 кг × 10/);
 assert.equal(extractManualNotes(body),'Было тяжело, но справился.');
 assert.equal(composeWorkoutBody('',[]),'');
 assert.equal(composeWorkoutBody('Только пробежка',[]),'Только пробежка');
});
test('sets can have decimal weight and bodyweight zero',()=>{
 assert.deepEqual(exerciseEntries([lift([{weight:'0',reps:'15'},{weight:'12,5',reps:'8'}])])[0].sets,[
  {weight_kg:0,reps:15},{weight_kg:12.5,reps:8}
 ]);
});
test('reject invalid set counts weights and repetitions',()=>{
 assert.throws(()=>exerciseEntries([lift([{weight:'40',reps:'0'}])]),/Проверь/);
 assert.throws(()=>exerciseEntries([lift([{weight:'-2',reps:'10'}])]),/Проверь/);
 assert.throws(()=>exerciseEntries([lift([{weight:'',reps:'10'}])]),/Проверь/);
 assert.throws(()=>exerciseEntries([lift(Array.from({length:21},()=>({weight:'40',reps:'10'})))]),/количество подходов/i);
});
