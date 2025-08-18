#!/usr/bin/env node
/**
 * Re-upload matches from data/matches.csv into Firestore.
 *
 * Features:
 *  --wipe      : deletes ALL existing match docs before upload
 *  --dry-run   : parses + reports actions but does NOT write
 *  --file <p>  : alternate CSV path (default data/matches.csv)
 *
 * CSV Columns (header required):
 *  match_id,event_id,match_type,venue,scheduled_at,pool,competitor_a,competitor_b,scorekeeper_email
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const serviceAccount = require('./serviceAccountKey.json');

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ----------- arg parsing -----------
const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
function takeValue(flag){
	const idx = args.indexOf(flag);
	if(idx === -1 || idx === args.length-1) return null;
	return args[idx+1];
}
const csvPath = takeValue('--file') || path.join(process.cwd(),'data','matches.csv');
const doWipe = flags.has('--wipe');
const dryRun = flags.has('--dry-run');

function usage(){
	console.log(`Usage: node scripts/uploadMatchesFromCSV.mjs [--wipe] [--dry-run] [--file <path>]\n\n`+
	`Examples:\n  node scripts/uploadMatchesFromCSV.mjs --wipe\n  node scripts/uploadMatchesFromCSV.mjs --dry-run\n  node scripts/uploadMatchesFromCSV.mjs --file ./custom.csv --wipe`);
}
if(flags.has('--help')){ usage(); process.exit(0); }

// ----------- helpers -----------
function parseCSV(text){
	const lines = text.split(/\r?\n/).filter(l=>l.trim().length);
	if(!lines.length) throw new Error('CSV empty');
	const header = lines[0].split(',').map(s=>s.trim());
	const rows = [];
	for(let i=1;i<lines.length;i++){
		const raw = lines[i];
		if(!raw.trim()) continue;
		// naive split (OK: dataset has no embedded commas)
		const parts = raw.split(',');
		if(parts.length < header.length){
			console.warn(`Skipping line ${i+1}: column mismatch (${parts.length} < ${header.length})`);
			continue;
		}
		const rec = {};
		header.forEach((h,idx)=> rec[h] = parts[idx]?.trim() ?? '');
		rows.push(rec);
	}
	return rows;
}

function buildMatchDoc(rec){
	const { match_id,event_id,match_type,venue,scheduled_at,pool,competitor_a,competitor_b,scorekeeper_email } = rec;
	if(!match_id) throw new Error('Missing match_id in row');
	if(!event_id) throw new Error(`Row ${match_id}: missing event_id`);
	if(!match_type) throw new Error(`Row ${match_id}: missing match_type`);
	let ts;
	try { ts = scheduled_at ? Timestamp.fromDate(new Date(scheduled_at)) : null; } catch { ts = null; }
	const doc = {
		event_id,
		match_type,
		venue: venue || null,
		scheduled_at: ts,
		pool: pool || null,
		status: 'scheduled',
		score_a: null,
		score_b: null,
		competitor_a: competitor_a ? { id: competitor_a } : null,
		competitor_b: competitor_b ? { id: competitor_b } : null,
	};
	if(scorekeeper_email) doc.scorekeeper_email = scorekeeper_email;
	return { id: match_id, data: doc };
}

// ----------- main flow -----------
async function main(){
	if(!fs.existsSync(csvPath)){
		console.error('❌ CSV not found:', csvPath);
		process.exit(1);
	}
	console.log('📄 Reading', csvPath);
	const text = fs.readFileSync(csvPath,'utf8');
	const rows = parseCSV(text);
	console.log(`🧾 Parsed ${rows.length} rows.`);

	// Build docs & basic validation
	const docs = rows.map(r=> buildMatchDoc(r));
	const ids = new Set();
	const dupIds = [];
	docs.forEach(d=> { if(ids.has(d.id)) dupIds.push(d.id); else ids.add(d.id); });
	if(dupIds.length){
		console.warn('⚠️ Duplicate match_id values in CSV:', dupIds.join(', '));
	}

	if(doWipe){
		console.log('🗑️  Wiping existing matches collection...');
		if(!dryRun){
			const snap = await db.collection('matches').get();
			const batchSize = 400; // chunk deletes
			let batch = db.batch();
			let count = 0, committed=0;
			for(const doc of snap.docs){
				batch.delete(doc.ref);
				count++; if(count % batchSize === 0){ await batch.commit(); committed+=batchSize; batch = db.batch(); }
			}
			if(count % batchSize) { await batch.commit(); committed += (count % batchSize); }
			console.log(`   ✅ Deleted ${count} existing matches.`);
		} else {
			console.log('   (dry-run) would delete all existing matches');
		}
	}

	console.log(`⬆️  Uploading ${docs.length} matches${dryRun?' (dry-run)':''}...`);
	if(dryRun){
		console.log('   Sample first 5 docs:');
		docs.slice(0,5).forEach(d=> console.log('   ', d.id, d.data));
		console.log('✅ Dry run complete.');
		return;
	}

	const batchSize = 400;
	let batch = db.batch();
	let count = 0; let committed = 0;
	for(const m of docs){
		const ref = db.collection('matches').doc(m.id);
		batch.set(ref, m.data, { merge: true });
		count++;
		if(count % batchSize === 0){ await batch.commit(); committed += batchSize; batch = db.batch(); }
	}
	if(count % batchSize){ await batch.commit(); committed += (count % batchSize); }
	console.log(`✅ Uploaded ${count} matches.`);
	console.log('🎯 Done.');
}

main().catch(err => { console.error('❌ Failed:', err); process.exit(1); });

