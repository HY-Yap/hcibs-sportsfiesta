#!/usr/bin/env node
/**
 * diagnoseTournament.mjs
 * ----------------------
 * Diagnoses tournament issues:
 * 1. Checks if all qualifiers are finished
 * 2. Checks frisbee standings calculation
 * 3. Checks basketball standings calculation
 * 4. Lists elimination matches status
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const key = require("./serviceAccountKey.json");

initializeApp({ credential: cert(key), projectId: "hcibs-sportsfiesta" });
const db = getFirestore();

async function checkQualifiers(eventId) {
    console.log(`\n🔍 Checking ${eventId} qualifiers...`);
    
    const snap = await db
        .collection("matches")
        .where("event_id", "==", eventId)
        .where("match_type", "==", "qualifier")
        .get();
    
    console.log(`Total qualifiers: ${snap.size}`);
    
    const statusCounts = {};
    const teams = new Set();
    
    snap.docs.forEach(doc => {
        const data = doc.data();
        statusCounts[data.status] = (statusCounts[data.status] || 0) + 1;
        teams.add(data.competitor_a.id);
        teams.add(data.competitor_b.id);
    });
    
    console.log(`Status breakdown:`, statusCounts);
    console.log(`Teams found: ${Array.from(teams).sort().join(', ')}`);
    
    return snap.docs.every(doc => doc.data().status === "final");
}

async function calculateFrisbeeStandings() {
    console.log(`\n🥏 Calculating frisbee standings...`);
    
    const snap = await db
        .collection("matches")
        .where("event_id", "==", "frisbee5v5")
        .where("match_type", "==", "qualifier")
        .get();
    
    const standings = {};
    
    snap.docs.forEach(doc => {
        const d = doc.data();
        if (d.status !== "final") {
            console.log(`⚠️  Match ${doc.id} not final: ${d.status}`);
            return;
        }
        
        const a = d.competitor_a.id;
        const b = d.competitor_b.id;
        const sa = d.score_a;
        const sb = d.score_b;
        
        if (typeof sa !== "number" || typeof sb !== "number") {
            console.log(`⚠️  Match ${doc.id} has invalid scores: ${sa} vs ${sb}`);
            return;
        }
        
        const upd = (id, win, diff) => {
            const t = standings[id] ?? { wins: 0, diff: 0, matches: 0 };
            t.wins += win;
            t.diff += diff;
            t.matches += 1;
            standings[id] = t;
        };
        
        if (sa > sb) {
            upd(a, 1, sa - sb);
            upd(b, 0, sb - sa);
        } else if (sb > sa) {
            upd(b, 1, sb - sa);
            upd(a, 0, sa - sb);
        } else {
            upd(a, 0, 0);
            upd(b, 0, 0);
        }
    });
    
    const ranked = Object.entries(standings)
        .sort(([, a], [, b]) => b.wins - a.wins || b.diff - a.diff)
        .map(([id, stats]) => ({ id, ...stats }));
    
    console.log("Frisbee standings:");
    ranked.forEach((team, i) => {
        console.log(`${i + 1}. ${team.id}: ${team.wins} wins, ${team.diff >= 0 ? '+' : ''}${team.diff} diff (${team.matches} matches)`);
    });
    
    return ranked;
}

async function calculateBasketballStandings() {
    console.log(`\n🏀 Calculating basketball standings...`);
    
    const snap = await db
        .collection("matches")
        .where("event_id", "==", "basketball3v3")
        .where("match_type", "==", "qualifier")
        .get();
    
    const pools = { A: {}, B: {} };
    
    snap.docs.forEach(doc => {
        const d = doc.data();
        if (d.status !== "final") {
            console.log(`⚠️  Match ${doc.id} not final: ${d.status}`);
            return;
        }
        
        const pool = d.pool;
        if (!pool) {
            console.log(`⚠️  Match ${doc.id} missing pool`);
            return;
        }
        
        const a = d.competitor_a.id;
        const b = d.competitor_b.id;
        const sa = d.score_a;
        const sb = d.score_b;
        
        if (typeof sa !== "number" || typeof sb !== "number") {
            console.log(`⚠️  Match ${doc.id} has invalid scores: ${sa} vs ${sb}`);
            return;
        }
        
        const upd = (id, win, diff) => {
            const t = pools[pool][id] ?? { wins: 0, diff: 0, matches: 0 };
            t.wins += win;
            t.diff += diff;
            t.matches += 1;
            pools[pool][id] = t;
        };
        
        if (sa > sb) {
            upd(a, 1, sa - sb);
            upd(b, 0, sb - sa);
        } else if (sb > sa) {
            upd(b, 1, sb - sa);
            upd(a, 0, sa - sb);
        } else {
            upd(a, 0, 0);
            upd(b, 0, 0);
        }
    });
    
    console.log("Basketball standings:");
    Object.entries(pools).forEach(([poolName, teams]) => {
        console.log(`\nPool ${poolName}:`);
        const ranked = Object.entries(teams)
            .sort(([, a], [, b]) => b.wins - a.wins || b.diff - a.diff)
            .map(([id, stats]) => ({ id, ...stats }));
        
        ranked.forEach((team, i) => {
            console.log(`  ${i + 1}. ${team.id}: ${team.wins} wins, ${team.diff >= 0 ? '+' : ''}${team.diff} diff (${team.matches} matches)`);
        });
    });
    
    return pools;
}

async function checkEliminations() {
    console.log(`\n🏆 Checking elimination matches...`);
    
    const events = ["basketball3v3", "frisbee5v5", "badminton_singles", "badminton_doubles"];
    
    for (const eventId of events) {
        console.log(`\n${eventId} eliminations:`);
        
        const snap = await db
            .collection("matches")
            .where("event_id", "==", eventId)
            .where("match_type", "!=", "qualifier")
            .get();
        
        if (snap.empty) {
            console.log("  No elimination matches found");
            continue;
        }
        
        snap.docs.forEach(doc => {
            const d = doc.data();
            console.log(`  ${doc.id}: ${d.match_type} - ${d.status} - ${d.competitor_a?.id || 'TBD'} vs ${d.competitor_b?.id || 'TBD'}`);
        });
    }
}

async function main() {
    console.log("🔍 Tournament Diagnosis Starting...\n");
    
    // Check if all qualifiers are finished
    const frisbeeDone = await checkQualifiers("frisbee5v5");
    const basketballDone = await checkQualifiers("basketball3v3");
    const badmintonSinglesDone = await checkQualifiers("badminton_singles");
    const badmintonDoublesDone = await checkQualifiers("badminton_doubles");
    
    console.log(`\n📊 Qualifier Status:`);
    console.log(`  Frisbee: ${frisbeeDone ? '✅ Complete' : '❌ Incomplete'}`);
    console.log(`  Basketball: ${basketballDone ? '✅ Complete' : '❌ Incomplete'}`);
    console.log(`  Badminton Singles: ${badmintonSinglesDone ? '✅ Complete' : '❌ Incomplete'}`);
    console.log(`  Badminton Doubles: ${badmintonDoublesDone ? '✅ Complete' : '❌ Incomplete'}`);
    
    // Calculate standings
    if (frisbeeDone) {
        await calculateFrisbeeStandings();
    }
    
    if (basketballDone) {
        await calculateBasketballStandings();
    }
    
    // Check elimination matches
    await checkEliminations();
    
    console.log(`\n✅ Diagnosis complete!`);
}

main().catch(console.error);
