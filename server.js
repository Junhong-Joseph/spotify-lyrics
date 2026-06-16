const express = require('express');
const axios = require('axios');
const OpenCC = require('opencc-js');

const app = express();
const port = process.env.PORT || 3000;

const converter = OpenCC.Converter({ from: 'hk', to: 'cn' });

const client = axios.create({
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
});

app.get('/', (req, res) => res.send('High-Speed Proxy Active'));

app.get('/lyrics', async (req, res) => {
    let { track_name, artist_name, duration } = req.query;

    if (!track_name || !artist_name) {
        return res.status(400).json({ error: "Missing parameters" });
    }

    const safeDecode = (str) => {
        try {
            if (/%[0-9A-Fa-f]{2}/.test(str)) return decodeURIComponent(str);
        } catch (e) { console.log("Decode bypassed"); }
        return str;
    };
    
    track_name = safeDecode(track_name);
    artist_name = safeDecode(artist_name);

    const simplifiedTrack = converter(track_name).trim();
    const simplifiedArtist = converter(artist_name).trim();

    // ==========================================
    // THE NEW "SMART SEARCH" ALGORITHM
    // ==========================================
    const fetchLrc = async (track, artist, targetDuration) => {
        // We use /api/search now, which returns an array of ALL matching songs
        const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(track)}&artist_name=${encodeURIComponent(artist)}`;

        try {
            const response = await client.get(url, { timeout: 6000 });
            let results = response.data;

            // 1. Ensure we actually got a list back
            if (!Array.isArray(results) || results.length === 0) return null;

            // 2. Filter out junk entries that don't actually have lyrics attached
            let validResults = results.filter(r => r.syncedLyrics || r.plainLyrics);
            if (validResults.length === 0) return null;

            // 3. Proximity Sorting: Find the result closest to our ESP32's duration
            if (targetDuration && !isNaN(targetDuration)) {
                const targetSec = Math.round(targetDuration);
                
                // Sort the array by absolute mathematical difference
                validResults.sort((a, b) => {
                    const diffA = Math.abs((a.duration || 0) - targetSec);
                    const diffB = Math.abs((b.duration || 0) - targetSec);
                    return diffA - diffB;
                });

                console.log(` -> SUCCESS: Found best match. Target: ${targetSec}s | Database: ${validResults[0].duration}s`);
                return validResults[0]; // Return the absolute closest match
            }

            console.log(` -> SUCCESS: Found match (No duration sort applied)`);
            return validResults[0];

        } catch (error) {
            return null; 
        }
    };

    try {
        let data = null;
        console.log(`\n[Search] Querying: ${track_name} - ${artist_name}`);
        
        // Attempt 1: Original Text
        data = await fetchLrc(track_name, artist_name, duration);
        
        // Attempt 2: Simplified Text Fallback
        if (!data && (simplifiedTrack !== track_name || simplifiedArtist !== artist_name)) {
            console.log(` -> Original text failed, trying Simplified Chinese...`);
            data = await fetchLrc(simplifiedTrack, simplifiedArtist, duration);
        }

        // Output Emitter
        if (data) {
            let payloadString = data.syncedLyrics || data.plainLyrics;
            payloadString = converter(payloadString)
                .replace(/\r/g, '')             
                .replace(/[\x00-\x1F]/g, (c) => (c === '\n' ? '\n' : ''));

            return res.json({ syncedLyrics: payloadString });
        }
        
        console.log(`[CRITICAL] Processing pipeline failed to resolve any valid indices.`);
        res.status(404).json({ error: "Not found in database" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(port, () => console.log(`Speed Proxy online on port ${port}`));