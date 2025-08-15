#!/usr/bin/env node
/**
 * scripts/assignScorekeepers.mjs
 * ------------------------------------------------------------------
 * Auto-assign exactly ONE scorekeeper to each match (default: all
 * scheduled matches without a scorekeeper) using a round‑robin while
 * avoiding time clashes for the same person.
 *
 * Usage:
 *   node scripts/assignScorekeepers.mjs              # assign all events
 *   node scripts/assignScorekeepers.mjs --event badminton_doubles
 *   node scripts/assignScorekeepers.mjs --dry        # dry run (no writes)
 *   node scripts/assignScorekeepers.mjs --from 2025-08-22T12:00:00Z --to 2025-08-23T16:00:00Z
 *
 * Options:
 *   --event <event_id>     limit to single event (repeat flag for multiple)
 *   --dry                  log plan only
 *   --from <ISO>           only matches scheduled at/after this time (inclusive)
 *   --to <ISO>             only matches scheduled before this time (exclusive)
 *   --overwrite            also reassign matches that already have a scorekeeper
 *   --gap <minutes>        minimum minutes gap before a keeper can take another (default 0)
 *   --export <file.csv>    write an editable CSV of matches (no assignments made) then exit
 *   --import <file.csv>    read a CSV specifying manual assignments and apply them
 *   --no-auto              when used with --import, do NOT auto-fill remaining matches
 *   --set matchId=email    directly assign a single match to a keeper (repeatable)
 *                          example: --set D-Q1=scorekeeper01@example.com --set D-Q2=scorekeeper02@example.com
 *
 * Manual workflow:
 *   1) Export template:
 *        node scripts/assignScorekeepers.mjs --export plan.csv
 *   2) Open plan.csv, fill keeper_email (must match an existing scorekeeper email)
 *   3) Apply:
 *        node scripts/assignScorekeepers.mjs --import plan.csv [--overwrite]
 *   (If you omit keeper_email for some rows, they will be auto-assigned unless --no-auto is set.)
 *
 * Output: summary + per-match assignment plan.
 *
 * Match doc field used:  scorekeeper (string uid)
 * (scorekeeper.js already supports either a string or array; we use a string.)
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const key = require('./serviceAccountKey.json');

initializeApp({ credential: cert(key), projectId: key.project_id });
const db = getFirestore();
const auth = getAuth();

/* ----------------------- arg parsing ----------------------- */
function parseArgs(){
  const args = process.argv.slice(2);
  const out = { event: [], dry:false, overwrite:false, gap:0, csv:null, export:null, import:null, noAuto:false, sets:[] };
  for(let i=0;i<args.length;i++){
    const a = args[i];
    if(a === '--dry'){ out.dry = true; continue; }
    if(a === '--overwrite'){ out.overwrite = true; continue; }
    if(a === '--event'){ out.event.push(args[++i]); continue; }
    if(a === '--from'){ out.from = args[++i]; continue; }
    if(a === '--to'){ out.to = args[++i]; continue; }
    if(a === '--gap'){ out.gap = Number(args[++i])||0; continue; }
    if(a === '--csv'){ out.csv = args[++i]; continue; }
    if(a === '--export'){ out.export = args[++i]; continue; }
    if(a === '--import'){ out.import = args[++i]; continue; }
    if(a === '--no-auto'){ out.noAuto = true; continue; }
    if(a === '--set'){ out.sets.push(args[++i]); continue; }
  }
  return out;
}
const opts = parseArgs();

function parseTime(label, v){
  if(!v) return null; const d = new Date(v); if(isNaN(d)) { console.error(`❌ Invalid ${label} time: ${v}`); process.exit(1);} return d; }
const fromTs = parseTime('from', opts.from);
const toTs = parseTime('to', opts.to);

/* ----------------------- helpers ----------------------- */
function minutesBetween(a,b){ return Math.abs(a - b) / 60000; }

function withinWindow(date){
  if(fromTs && date < fromTs) return false;
  if(toTs && date >= toTs) return false;
  return true;
}

async function fetchScorekeepers(){
  // Strategy: fetch user docs where role == 'scorekeeper'. If none, fall back to auth list (custom claims not queryable directly here).
  const snap = await db.collection('users').where('role','==','scorekeeper').get();
  const keepers = [];
  snap.forEach(d=> keepers.push({ uid: d.id, email: d.data().email || d.id, name: d.data().full_name || d.id }));
  if(!keepers.length){
    console.warn('⚠️  No users/{uid} docs with role=scorekeeper found. Attempting to list Auth users (will include all roles).');
    const authUsers = await auth.listUsers(1000);
    authUsers.users.forEach(u => { if(u.customClaims?.role === 'scorekeeper') keepers.push({ uid: u.uid, email: u.email, name: u.displayName || u.email }); });
  }
  if(!keepers.length){
    console.error('❌ No scorekeepers found. Create scorekeeper accounts first (set custom claim role=scorekeeper).');
    process.exit(1);
  }
  keepers.sort((a,b)=> (a.email||'').localeCompare(b.email||''));
  // If a CSV was provided, filter & reorder by CSV email list
  if(opts.csv){
    if(!fs.existsSync(opts.csv)){
      console.error(`❌ CSV file not found: ${opts.csv}`); process.exit(1);
    }
    const txt = fs.readFileSync(opts.csv,'utf8');
    const lines = txt.split(/\r?\n/).map(l=>l.trim()).filter(l=> l && !/^#/.test(l));
    const emails = [];
    for(const line of lines){
      // Very light CSV parse: take first comma-separated token that looks like an email
      const parts = line.split(',').map(x=>x.trim()).filter(Boolean);
      if(!parts.length) continue;
      let e = parts.find(p=> /@/.test(p)) || parts[0];
      if(/^email$/i.test(e)) continue; // header
      e = e.replace(/^"|"$/g,'');
      if(!emails.includes(e)) emails.push(e);
    }
    const map = new Map(keepers.map(k=> [k.email,k]));
    const filtered = emails.map(e=> map.get(e)).filter(Boolean);
    const missing = emails.filter(e=> !map.has(e));
    if(missing.length){
      console.warn(`⚠️  ${missing.length} email(s) in CSV not found as scorekeeper accounts: ${missing.join(', ')}`);
    }
    if(!filtered.length){
      console.error('❌ After applying CSV filter, no matching scorekeepers remain.');
      process.exit(1);
    }
    return filtered;
  }
  return keepers;
}

async function fetchMatches(){
  let q = db.collection('matches');
  if(opts.event.length === 1){
    q = q.where('event_id','==', opts.event[0]);
  }
  // Firestore cannot OR across multiple event filters; if >1 events specified we post-filter.
  const snap = await q.get();
  const rows = [];
  snap.forEach(d=> { const data = d.data(); rows.push({ id:d.id, ref:d.ref, ...data }); });
  // --- diagnostics buckets ---
  const diag = { total: rows.length, perEvent:{}, skipped:{}, eligible:{}, reasons:{} };
  const bump = (obj,key)=> obj[key]= (obj[key]||0)+1;
  const markSkip = (m,reason) => { bump(diag.skipped, reason); bump(diag.perEvent, m.event_id||'unknown'); };
  const markEligible = (m)=> { bump(diag.perEvent, m.event_id||'unknown'); bump(diag.eligible, m.event_id||'unknown'); };

  const multiEventFilter = opts.event.length>1 ? new Set(opts.event) : null;
  const list = [];
  rows.forEach(m=>{
    if(multiEventFilter && !multiEventFilter.has(m.event_id)) return; // other events
    if(m.status !== 'scheduled'){ markSkip(m,'status_'+m.status); return; }
    if(!opts.overwrite && m.scorekeeper){ markSkip(m,'already_assigned'); return; }
    // Accept match even if scheduled_at missing (fallback to now) but flag it.
    let dt = null;
    if(m.scheduled_at && m.scheduled_at.toDate){ dt = m.scheduled_at.toDate(); }
    else if(m.scheduledAt && m.scheduledAt.toDate){ dt = m.scheduledAt.toDate(); }
    else if(m.start_time && m.start_time.toDate){ dt = m.start_time.toDate(); }
    else if(m.starts_at && m.starts_at.toDate){ dt = m.starts_at.toDate(); }
    else { dt = new Date(); markSkip(m,'missing_time_using_now'); }
    if(!withinWindow(dt)) { markSkip(m,'outside_window'); return; }
    // Keep; attach synthetic date if needed
    if(!m.scheduled_at){ m._synthetic_time = true; m._effective_time = dt; } else { m._effective_time = dt; }
    list.push(m); markEligible(m);
  });
  // Sort by effective scheduled time
  list.sort((a,b)=> a._effective_time - b._effective_time);
  // Print concise diagnostics
  console.log('📊 Match filtering summary');
  console.log('   total docs:', diag.total);
  Object.keys(diag.perEvent).sort().forEach(ev=>{
    console.log(`   event ${ev}: ${diag.eligible[ev]||0} eligible`);
  });
  const skipKeys = Object.keys(diag.skipped);
  if(skipKeys.length){
    console.log('   skip reasons counts:', skipKeys.map(k=> `${k}:${diag.skipped[k]}`).join(' | '));
  }
  const missingDoubles = !Object.keys(diag.eligible).includes('badminton_doubles');
  if(missingDoubles){
    console.log('   ⚠️ No eligible badminton_doubles matches found. Likely reasons:');
    console.log('      - status not "scheduled" (maybe already final/live)');
    console.log('      - already has scorekeeper (run with --overwrite to reassign)');
    console.log('      - missing event_id or filtered out by --event flags');
  }
  return list;
}

/* ----------------------- manual CSV helpers ----------------------- */
function toIso(d){ return d instanceof Date ? d.toISOString() : ''; }

function exportCsv(file, matches, keepers){
  const header = 'match_id,event_id,time,current_scorekeeper,auto_proposed,keeper_email\n';
  // We'll create a naive auto plan just for suggestion: round-robin ignoring gaps
  let idx=0; const suggestion = [];
  for(const m of matches){
    const k = keepers[idx % keepers.length]; idx++;
    suggestion.push([m.id,m.event_id,toIso(m._effective_time|| (m.scheduled_at?.toDate?.()||new Date())), m.scorekeeper||'', k.email,'']);
  }
  const csv = header + suggestion.map(r=> r.map(v=> v.includes(',')? '"'+v.replace(/"/g,'""')+'"': v).join(',')).join('\n');
  fs.writeFileSync(file,csv,'utf8');
  console.log(`📝 Exported ${suggestion.length} match rows to ${file}`);
  console.log('   Fill keeper_email (last column) with desired scorekeeper emails and run with --import.');
}

function parseImportCsv(file){
  if(!fs.existsSync(file)){ console.error('❌ Import CSV not found:', file); process.exit(1); }
  const txt = fs.readFileSync(file,'utf8');
  const lines = txt.split(/\r?\n/).filter(l=> l.trim());
  if(!lines.length){ console.error('❌ Import CSV empty.'); process.exit(1); }
  const header = lines[0].split(',').map(h=> h.trim());
  const colMatch = header.findIndex(h=> /match_id/i.test(h));
  const colKeeper = header.findIndex(h=> /keeper_email/i.test(h));
  if(colMatch === -1){ console.error('❌ Import CSV missing match_id header.'); process.exit(1); }
  // keeper email column optional (could be second style with only two cols)
  const out = [];
  for(let i=1;i<lines.length;i++){
    const raw = lines[i];
    const parts = raw.split(',');
    const matchId = (parts[colMatch]||'').trim(); if(!matchId) continue;
    let keeperEmail = colKeeper !== -1 ? (parts[colKeeper]||'').trim() : '';
    // Allow alternative minimal format: match_id,keeper_email
    if(colKeeper === -1 && parts.length >= 2){ keeperEmail = parts[1].trim(); }
    out.push({ matchId, keeperEmail });
  }
  return out;
}

async function fetchMatchesByIds(ids){
  const res = [];
  for(const id of ids){
    const ref = db.collection('matches').doc(id);
    const snap = await ref.get();
    if(!snap.exists){ console.warn('⚠️ match not found (skipped):', id); continue; }
    const data = snap.data();
    let dt=null; if(data.scheduled_at?.toDate) dt = data.scheduled_at.toDate();
    res.push({ id, ref, ...data, _effective_time: dt || new Date() });
  }
  return res;
}

/* ----------------------- core assignment ----------------------- */
function planAssignments(matches, keepers){
  // Track per-keeper last assigned time (Date)
  const lastTime = new Map();
  const plan = [];
  if(!keepers.length) return plan;
  let idx = 0; // round-robin pointer

  for(const m of matches){
    const matchTime = m.scheduled_at.toDate();
    let attempts = 0;
    let chosen = null;
    while(attempts < keepers.length){
      const k = keepers[idx % keepers.length];
      idx++;
      attempts++;
      const lt = lastTime.get(k.uid);
      if(!lt || minutesBetween(lt.getTime(), matchTime.getTime()) >= opts.gap){
        chosen = k; break;
      }
    }
    if(!chosen){
      // If every keeper clashes within gap, just pick next in cycle (ignoring gap)
      const k = keepers[idx % keepers.length]; idx++; chosen = k;
    }
    lastTime.set(chosen.uid, matchTime);
    plan.push({ matchId: m.id, event: m.event_id, time: matchTime.toISOString(), keeperUid: chosen.uid, keeperEmail: chosen.email });
  }
  return plan;
}

async function commit(plan, matchMap){
  if(!plan.length) return 0;
  const batch = db.batch();
  plan.forEach(p => {
    const ref = matchMap.get(p.matchId).ref;
    batch.update(ref, { 
      scorekeeper: p.keeperEmail,          // primary (email) for human readability
      scorekeeper_uid: p.keeperUid,        // keep uid for auth matching
      updated_at: FieldValue.serverTimestamp() 
    });
  });
  await batch.commit();
  return plan.length;
}


/* ----------------------- main ----------------------- */
(async function main(){
  console.log('🎯 Scorekeeper assignment starting');
  const keepers = await fetchScorekeepers();
  console.log(`👥 Using ${keepers.length} scorekeeper(s)${opts.csv ? ' from CSV filter' : ''}`);
  // Manual import/export modes
  if(opts.export){
    const matches = await fetchMatches();
    exportCsv(opts.export, matches, keepers);
    console.log('✅ Export complete. No assignments written.');
    process.exit(0);
  }

  if(opts.import){
    const rows = parseImportCsv(opts.import);
    const byId = new Map(); rows.forEach(r=> byId.set(r.matchId, r));
    const matches = await fetchMatchesByIds([...byId.keys()]);
    if(!matches.length){ console.error('❌ No valid matches from import file.'); process.exit(1); }
    const keeperByEmail = new Map(keepers.map(k=> [k.email, k]));
    const plan = [];
    const autoPool = keepers.slice(); let autoIdx=0;
    for(const m of matches){
      const row = byId.get(m.id);
      let email = row.keeperEmail;
      if(!email){
        if(opts.noAuto) { continue; }
        // auto fill
        const k = autoPool[autoIdx % autoPool.length]; autoIdx++; email = k.email;
      }
      const keeper = keeperByEmail.get(email);
      if(!keeper){ console.warn(`⚠️ keeper email not found (skipped): ${email} for match ${m.id}`); continue; }
      if(!opts.overwrite && m.scorekeeper){
        console.log(`↪️  Skip (already assigned, use --overwrite): ${m.id}`); continue;
      }
      plan.push({ matchId: m.id, event: m.event_id, time: (m._effective_time||new Date()).toISOString(), keeperUid: keeper.uid, keeperEmail: keeper.email });
    }
    if(!plan.length){ console.log('Nothing to assign from import file.'); process.exit(0); }
    console.log(`📥 Import plan contains ${plan.length} assignment(s).`);
    if(opts.dry){
      plan.forEach(p=> console.log(`  ${p.matchId} (${p.event}) -> ${p.keeperEmail}`));
      console.log('\n💡 Dry run only (no writes). Use without --dry to commit.');
      process.exit(0);
    }
    const matchMap = new Map(matches.map(m=> [m.id,m]));
    const n = await commit(plan, matchMap);
    console.log(`\n✅ Assigned ${n} match(es) from import.`);
    console.log('Done.');
    process.exit(0);
  }

  // Direct --set assignments mode
  if(opts.sets.length){
    const pairs = opts.sets.map(s=>{
      const [id,email] = s.split('=');
      if(!id || !email) { console.error('❌ --set expects matchId=email form, got:', s); process.exit(1); }
      return { matchId:id.trim(), email:email.trim() };
    });
    const matchIds = [...new Set(pairs.map(p=> p.matchId))];
    const matches = await fetchMatchesByIds(matchIds);
    if(!matches.length){ console.error('❌ No valid matches for provided --set flags.'); process.exit(1); }
    const keeperByEmail = new Map(keepers.map(k=> [k.email, k]));
    const plan = [];
    for(const p of pairs){
      const m = matches.find(mm=> mm.id === p.matchId);
      if(!m){ console.warn('⚠️ match not found (skipped):', p.matchId); continue; }
      if(!opts.overwrite && m.scorekeeper){ console.log(`↪️  Skip (already assigned, use --overwrite): ${m.id}`); continue; }
      const k = keeperByEmail.get(p.email);
      if(!k){ console.warn('⚠️ keeper email not found (skipped):', p.email); continue; }
      plan.push({ matchId: m.id, event: m.event_id, time: (m._effective_time|| new Date()).toISOString(), keeperUid: k.uid, keeperEmail: k.email });
    }
    if(!plan.length){ console.log('Nothing to assign from --set flags.'); process.exit(0); }
    console.log(`🛠  Direct assignment plan (${plan.length}):`);
    plan.forEach(p=> console.log(`  ${p.matchId} (${p.event}) -> ${p.keeperEmail}`));
    if(opts.dry){ console.log('\n💡 Dry run only (no writes).'); process.exit(0); }
    const matchMap = new Map(matches.map(m=> [m.id,m]));
    const n = await commit(plan, matchMap);
    console.log(`\n✅ Assigned ${n} match(es) via --set.`);
    console.log('Done.');
    process.exit(0);
  }

  // Normal automatic mode
  const matches = await fetchMatches();
  console.log(`📅 Matches needing assignment: ${matches.length}`);
  if(!matches.length){ console.log('Nothing to do.'); process.exit(0); }

  const matchMap = new Map(matches.map(m => [m.id, m]));
  const plan = planAssignments(matches, keepers);
  // Extra per-event distribution after planning
  const perEventPlan = {}; plan.forEach(p=> perEventPlan[p.event]=(perEventPlan[p.event]||0)+1);
  console.log('🧮 Planned per-event assignments:', Object.entries(perEventPlan).map(([e,c])=> `${e}:${c}`).join(' | '));

  console.log('\nProposed assignments:');
  plan.slice(0,20).forEach(p => console.log(`  ${p.matchId} (${p.event} @ ${p.time}) -> ${p.keeperEmail}`));
  if(plan.length > 20) console.log(`  ... ${plan.length-20} more`);

  if(opts.dry){
    console.log('\n💡 Dry run only (no writes). Use without --dry to commit.');
    process.exit(0);
  }
  const n = await commit(plan, matchMap);
  console.log(`\n✅ Assigned ${n} match(es).`);
  console.log('Done.');
  process.exit(0);
})();
