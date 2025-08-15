// scripts/seedScorekeepers.mjs
/**
 * Seed (or update) scorekeeper accounts from a CSV.
 * Similar style to seedUsers.mjs for players, but simpler:
 * - Creates Firebase Auth users (if missing) with role=scorekeeper
 * - Upserts users/{uid} doc (role=scorekeeper)
 * - Optional: generate initial passwords (like --invite)
 * - Optional: delete scorekeeper accounts not in the CSV (unless --keep-missing)
 *
 * CSV format (header row required):
 *   full_name,email
 * Extra columns are ignored.
 *
 * Usage:
 *   node scripts/seedScorekeepers.mjs --csv ./data/scorekeepers.csv [--invite] [--dry] [--keep-missing]
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const key = require('./serviceAccountKey.json');

initializeApp({ credential: cert(key), projectId: key.project_id });
const auth = getAuth();
const db = getFirestore();

const args = process.argv.slice(2);
const opts = { csv:null, dry:false, invite:false, keepMissing:false };
for(let i=0;i<args.length;i++){
  const a = args[i];
  if(a==='--csv') opts.csv = args[++i];
  else if(a==='--dry') opts.dry = true;
  else if(a==='--invite') opts.invite = true;
  else if(a==='--keep-missing') opts.keepMissing = true;
}
if(!opts.csv){
  console.error('Usage: node scripts/seedScorekeepers.mjs --csv ./data/scorekeepers.csv [--invite] [--dry] [--keep-missing]');
  process.exit(1);
}

function normEmail(e){ return (e||'').trim().toLowerCase(); }
function normStr(s){ return (s||'').toString().trim(); }

async function readCsv(file){
  const text = await fs.readFile(path.resolve(file),'utf8');
  // Try dynamic import of papaparse; fall back to minimal parser if missing
  let PapaMod = null;
  try { ({ default: PapaMod } = await import('papaparse')); } catch(e){ /* fallback */ }
  if(PapaMod){
    return new Promise((resolve,reject)=>{
      PapaMod.parse(text,{ header:true, skipEmptyLines:true, transformHeader:h=>h.trim(), complete:res=>resolve(res.data), error:reject });
    });
  }
  // Minimal CSV parse (handles commas, quotes, header) – not fully RFC 4180 but sufficient
  const lines = text.split(/\r?\n/).filter(l=>l.trim().length);
  if(!lines.length) return [];
  const header = lines[0].split(',').map(h=>h.trim());
  const rows=[];
  for(let i=1;i<lines.length;i++){
    const raw = lines[i];
    const cols=[]; let cur=''; let inQ=false; for(let j=0;j<raw.length;j++){
      const ch=raw[j];
      if(ch==='"'){
        if(inQ && raw[j+1]==='"'){ cur+='"'; j++; } else { inQ=!inQ; }
      } else if(ch===',' && !inQ){ cols.push(cur); cur=''; } else { cur+=ch; }
    }
    cols.push(cur);
    const obj={}; header.forEach((h,idx)=> obj[h]= (cols[idx]||'').trim());
    rows.push(obj);
  }
  return rows;
}

// Safe unparse (convert objects -> CSV) without requiring papaparse installed.
async function unparseCsv(rows){
  if(!rows.length) return 'email,full_name,default_password,uid\n';
  // Try dynamic import first
  try {
    const { default: PapaMod } = await import('papaparse');
    return PapaMod.unparse(rows);
  } catch(e){ /* fallback */ }
  const headers = Object.keys(rows[0]);
  const esc = v => {
    if(v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
  };
  const lines = [ headers.join(',') ];
  rows.forEach(r=> lines.push(headers.map(h=> esc(r[h])).join(',')) );
  return lines.join('\n') + '\n';
}

function validate(rows){
  const keepers=[]; const errors=[]; const seen=new Set();
  rows.forEach((r,i)=>{
    const row=i+2; // 1-based + header
    const email=normEmail(r.email);
    const full_name=normStr(r.full_name);
    if(!email) errors.push(`Row ${row}: missing email`);
    if(!full_name) errors.push(`Row ${row}: missing full_name`);
    if(email && seen.has(email)) errors.push(`Row ${row}: duplicate email ${email}`);
    seen.add(email);
    if(email && full_name) keepers.push({ email, full_name });
  });
  return {keepers, errors};
}

function genPassword(){
  const chars='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out=''; for(let i=0;i<10;i++) out+=chars[Math.floor(Math.random()*chars.length)];
  return out;
}

async function ensureScorekeeper(k){
  try{ const u = await auth.getUserByEmail(k.email); return { uid:u.uid, created:false }; }
  catch(e){ if(e.code!=='auth/user-not-found') throw e; if(opts.dry) return { uid:`dry_${k.email}`, created:true };
    const u = await auth.createUser({ email:k.email, displayName:k.full_name, disabled:false, emailVerified:false });
    await auth.setCustomUserClaims(u.uid,{ role:'scorekeeper' });
    return { uid:u.uid, created:true }; }
}

async function upsertDoc(uid,k){ if(opts.dry) return; const ref=db.doc(`users/${uid}`); await ref.set({ full_name:k.full_name, email:k.email, role:'scorekeeper', updated_at:new Date() },{ merge:true }); }

async function cleanup(validEmails){
  if(opts.keepMissing || opts.dry) return; // skip cleanup
  console.log('🧹 Checking for scorekeepers not in CSV...');
  const snap = await db.collection('users').where('role','==','scorekeeper').get();
  const valid = new Set(validEmails);
  const toDelete=[]; snap.forEach(d=>{ const data=d.data(); if(!valid.has((data.email||'').toLowerCase())) toDelete.push({ id:d.id, email:data.email }); });
  if(!toDelete.length){ console.log('✅ No extraneous scorekeepers.'); return; }
  console.log(`🗑️  Deleting ${toDelete.length} scorekeeper doc(s) + auth user(s)...`);
  for(const u of toDelete){ try { await auth.deleteUser(u.id); await db.doc(`users/${u.id}`).delete(); console.log('   removed', u.email||u.id); } catch(e){ console.warn('   failed remove', u.email, e.message); } }
}

async function maybePasswords(records){
  if(!opts.invite || opts.dry) return;
  const out=[]; for(const r of records){
    try{ const user=await auth.getUser(r.uid); const hasPass=user.passwordHash!==undefined; if(hasPass){ continue; }
      const pwd=genPassword(); await auth.updateUser(r.uid,{ password:pwd }); out.push({ email:r.email, full_name:r.full_name, default_password:pwd, uid:r.uid });
      console.log('🔑 set password for', r.email);
    } catch(e){ console.warn('⚠️ pw fail', r.email, e.message); }
  }
  if(out.length){
    const csv = await unparseCsv(out); const stamp=new Date().toISOString().slice(0,19).replace(/[:.]/g,'-');
    const file=path.resolve(`./scorekeeper-credentials-${stamp}.csv`); await fs.writeFile(file,csv,'utf8');
    console.log(`🔑 wrote ${out.length} credentials to ${file}`);
  }
}

(async function main(){
  console.log('📥 Reading scorekeepers CSV');
  const rows = await readCsv(opts.csv);
  const {keepers, errors} = validate(rows);
  if(errors.length){ console.error('❌ CSV errors:'); errors.forEach(e=>console.error(' -',e)); process.exit(1); }
  console.log(`👥 ${keepers.length} scorekeepers in CSV${opts.dry?' (dry run)':''}`);

  // ensure/create
  const created=[]; const processed=[]; const emailToUid=new Map();
  for(const k of keepers){
    const { uid, created:wasNew } = await ensureScorekeeper(k);
    emailToUid.set(k.email, uid);
    if(!opts.dry) await upsertDoc(uid,k);
    processed.push({ ...k, uid }); if(wasNew) created.push(k.email);
  }
  console.log(`✅ ensured ${processed.length} scorekeeper accounts (${created.length} created)`);

  await cleanup(keepers.map(k=>k.email));
  await maybePasswords(processed);
  console.log('🎉 done.');
})();
