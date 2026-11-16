/**
 * Comments are fetched chronologically; present replies directly beneath the
 * comment they answer, including replies to other replies.
 */
export type CommentThreadItem = {
  id: string;
  reply_to_id: string | null;
  created_at: string;
};
export function arrangeCommentThreads<T extends CommentThreadItem>(
  input: readonly T[],
): { comment: T; depth: number }[] {
  const ordered = [...input].sort((a,b) =>
    a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const byId = new Map(ordered.map(row=>[row.id,row]));
  const children = new Map<string,T[]>();
  const roots: T[] = [];
  for (const row of ordered) {
    if (row.reply_to_id && row.reply_to_id !== row.id && byId.has(row.reply_to_id)) {
      const siblings=children.get(row.reply_to_id) ?? [];
      siblings.push(row);
      children.set(row.reply_to_id,siblings);
    } else roots.push(row);
  }
  const result:{comment:T;depth:number}[]=[];
  const visited=new Set<string>();
  function visit(row:T,depth:number){
    if(visited.has(row.id))return;
    visited.add(row.id);
    result.push({comment:row,depth:Math.min(depth,3)});
    for(const child of children.get(row.id)??[])visit(child,depth+1);
  }
  for(const root of roots)visit(root,0);
  // Defensive fallback if imported data has an unexpected reply cycle.
  for(const row of ordered)visit(row,0);
  return result;
}
