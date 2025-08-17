#!/usr/bin/env node
/**
 * uploadMatchesFromCSV.mjs
 * ------------------------
 * Uploads all matches from data/matches.csv to Firestore.
 * Uses match_id as document ID and creates proper Firestore format.
 * 
 * Run: node scripts/uploadMatchesFromCSV.mjs
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const key = require("./serviceAccountKey.json");

initializeApp({ credential: cert(key), projectId: "hcibs-sportsfiesta" });
const db = getFirestore();

// Function to clear existing matches
async function clearExistingMatches() {
    console.log("🗑️  Clearing existing matches...");
    const existingMatches = await db.collection("matches").get();
    const batch = db.batch();
    
    existingMatches.docs.forEach(doc => {
        batch.delete(doc.ref);
    });
    
    await batch.commit();
    console.log(`✅ Cleared ${existingMatches.size} existing matches`);
}

// Function to create teams for all events
async function createAllTeams() {
    console.log("👥 Skipping team creation (teams will be uploaded separately)");
    // Teams will be uploaded from a separate CSV file later
}

// Function to upload matches from CSV
async function uploadMatches() {
    console.log("📤 Uploading matches from CSV...");
    
    // Read and parse CSV
    const csvContent = readFileSync("../data/matches.csv", "utf-8");
    const lines = csvContent.trim().split('\n');
    const headers = lines[0].split(',');
    
    const records = lines.slice(1).map(line => {
        const values = line.split(',');
        const record = {};
        headers.forEach((header, index) => {
            record[header] = values[index] || '';
        });
        return record;
    });
    
    console.log(`📊 Found ${records.length} matches to upload`);
    
    // Upload matches in batches
    const batchSize = 500; // Firestore batch limit
    let uploadedCount = 0;
    
    for (let i = 0; i < records.length; i += batchSize) {
        const batch = db.batch();
        const batchRecords = records.slice(i, i + batchSize);
        
        for (const record of batchRecords) {
            const matchData = {
                event_id: record.event_id,
                match_type: record.match_type,
                venue: record.venue,
                scheduled_at: new Date(record.scheduled_at),
                competitor_a: { id: record.competitor_a },
                competitor_b: { id: record.competitor_b },
                score_a: null,
                score_b: null,
                status: "scheduled",
                scorekeeper_email: record.scorekeeper_email
            };
            
            // Add pool if it exists
            if (record.pool && record.pool.trim()) {
                matchData.pool = record.pool;
            }
            
            const matchRef = db.doc(`matches/${record.match_id}`);
            batch.set(matchRef, matchData);
        }
        
        await batch.commit();
        uploadedCount += batchRecords.length;
        console.log(`✅ Uploaded batch ${Math.floor(i / batchSize) + 1}: ${uploadedCount}/${records.length} matches`);
    }
    
    console.log(`🎉 Successfully uploaded ${uploadedCount} matches to Firestore!`);
}

// Main execution
async function main() {
    try {
        console.log("🚀 Starting match upload process...");
        
        await clearExistingMatches();
        await createAllTeams();
        await uploadMatches();
        
        console.log("✅ All matches uploaded successfully!");
        console.log("📱 Matches will now sync with matches.js and matches-and-results.html");
        
    } catch (error) {
        console.error("❌ Error uploading matches:", error);
        process.exit(1);
    }
}

main();
