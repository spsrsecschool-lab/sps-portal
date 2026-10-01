/**
 * r2-storage.js — Cloudflare R2 Storage helper for SPS Portal
 *
 * Drop-in replacement for Supabase Storage. Load AFTER config.js and auth.js.
 * Exposes a global R2 object whose methods match the shapes the portal code uses.
 *
 * config.js must define:
 *   R2_WORKER_URL  — deployed Cloudflare Worker URL
 *
 * The R2 bucket stays PRIVATE. Files are served via the Worker's
 * /file?path=... endpoint (no auth needed for viewing, same as before).
 */
;(function(){
'use strict'

async function getToken(){
  try{const{data}=await window.sb.auth.getSession();return data?.session?.access_token||''}catch(_){return ''}
}

window.R2={

  async upload(path,file,opts){
    const tk=await getToken()
    const u=R2_WORKER_URL+'/upload?path='+encodeURIComponent(path)+(opts?.upsert?'&upsert=1':'')
    try{
      const res=await fetch(u,{
        method:'PUT',
        headers:{'Authorization':'Bearer '+tk,'Content-Type':file.type||'application/octet-stream'},
        body:file
      })
      if(!res.ok){const t=await res.text();return{error:{message:t,statusCode:String(res.status)}}}
      return{error:null}
    }catch(e){return{error:{message:e.message||'Network error'}}}
  },

  getPublicUrl(path){
    return{data:{publicUrl:R2_WORKER_URL+'/file?path='+encodeURIComponent(path)}}
  },

  async remove(paths){
    if(!paths||!paths.length)return{error:null}
    const tk=await getToken()
    try{
      const res=await fetch(R2_WORKER_URL+'/delete',{
        method:'POST',
        headers:{'Authorization':'Bearer '+tk,'Content-Type':'application/json'},
        body:JSON.stringify({paths})
      })
      if(!res.ok){const t=await res.text();return{error:{message:t}}}
      return{error:null}
    }catch(e){return{error:{message:e.message||'Network error'}}}
  },

  async list(prefix,opts){
    const tk=await getToken()
    const u=R2_WORKER_URL+'/list?prefix='+encodeURIComponent(prefix)+(opts?.search?'&search='+encodeURIComponent(opts.search):'')
    try{
      const res=await fetch(u,{headers:{'Authorization':'Bearer '+tk}})
      if(!res.ok)return{data:[]}
      return{data:await res.json()}
    }catch(_){return{data:[]}}
  },

  extractPath(fileUrl){
    if(!fileUrl)return null
    // R2 Worker URL: .../file?path=student-photos/STU-0001.jpg
    try{
      const u=new URL(fileUrl)
      const p=u.searchParams.get('path')
      if(p)return p
    }catch(_){}
    // Legacy Supabase storage URL
    const m=fileUrl.split('/school-files/')[1]
    return m?m.split('?')[0]:null
  }
}
})()
