import { supabase } from './supabase';

export const MAX_COMMENT_IMAGES = 4;
export const MAX_COMMENT_IMAGE_BYTES = 5 * 1024 * 1024;
export const COMMENT_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';

const extensions: Record<string,string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function validateCommentImage(file:File) {
  if(!extensions[file.type] || file.size<1 || file.size>MAX_COMMENT_IMAGE_BYTES)
    throw new Error('Выберите JPG, PNG или WebP размером до 5 МБ.');
}

export async function uploadCommentImage(file:File,userId:string,commentId:string):Promise<string> {
  if(!supabase)throw new Error('Не удалось подключиться к хранилищу.');
  validateCommentImage(file);
  const path=[userId,commentId,crypto.randomUUID()+'.'+extensions[file.type]].join('/');
  const {error}=await supabase.storage.from('comment-media').upload(path,file,{
    contentType:file.type,cacheControl:'3600',upsert:false
  });
  if(error)throw error;
  return path;
}

export function commentImageUrl(path:string):string {
  return supabase?.storage.from('comment-media').getPublicUrl(path).data.publicUrl ?? '';
}
