import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const source=await readFile(new URL('../src/lib/comment-threads.ts',import.meta.url),'utf8');
const {arrangeCommentThreads}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
const c=(id,reply_to_id=null,created_at='2026-11-16T12:00:00Z')=>({id,reply_to_id,created_at});
test('late replies are grouped immediately after their parent, not at the bottom',()=>{
 const result=arrangeCommentThreads([c('root1'),c('root2'),c('child','root1','2026-11-16T15:00:00Z')]);
 assert.deepEqual(result.map(x=>x.comment.id),['root1','child','root2']);
 assert.deepEqual(result.map(x=>x.depth),[0,1,0]);
});
test('replies to replies are under their target in chronological order',()=>{
 const result=arrangeCommentThreads([c('root'),c('answer1','root','2026-11-16T13:00:00Z'),c('other'),c('deep','answer1','2026-11-16T14:00:00Z')]);
 assert.deepEqual(result.map(x=>x.comment.id),['root','answer1','deep','other']);
});
test('deleted parent leaves a harmless top-level comment',()=>{
 const result=arrangeCommentThreads([c('orphan','deleted')]);
 assert.deepEqual(result.map(x=>[x.comment.id,x.depth]),[['orphan',0]]);
});
test('cycle and deep nesting do not hang or expand the layout',()=>{
 const result=arrangeCommentThreads([c('a','b'),c('b','a'),c('c','b'),c('d','c'),c('e','d')]);
 assert.equal(result.length,5);
 assert.ok(result.every(x=>x.depth<=3));
});
