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

    // ==========================================
    // ABORT CONTROLLER: The "Kill Switch"
    // ==========================================
    const abortController = new AbortController();
    
    // If the ESP32 disconnects early (e.g., user skips song), kill the upstream request
    req.on('close', () => {
        if (!res.writableEnded) {
            console.log(`\n[ABORT] ESP32 disconnected. Canceling search for: ${track_name}`);
            abortController.abort(); // Triggers the kill signal
        }
    });

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
    // THE SMART SEARCH ALGORITHM (Now with Signals)
    // ==========================================
    const fetchLrc = async (track, artist, targetDuration, signal) => {
        const searchQuery = `${track} ${artist}`;
        const url = `https://lrclib.net/api/search?q=${encodeURIComponent(searchQuery)}`;

        try {
            // We pass the abort signal into the Axios request
            const response = await client.get(url, { 
                timeout: 12000, 
                signal: signal 
            });
            let results = response.data;

            if (!Array.isArray(results) || results.length === 0) return null;

            let validResults = results.filter(r => r.syncedLyrics || r.plainLyrics);
            if (validResults.length === 0) return null;

            if (targetDuration && !isNaN(targetDuration)) {
                const targetSec = Math.round(targetDuration);
                
                validResults.sort((a, b) => {
                    const diffA = Math.abs((a.duration || 0) - targetSec);
                    const diffB = Math.abs((b.duration || 0) - targetSec);
                    return diffA - diffB;
                });

                console.log(` -> SUCCESS: Target: ${targetSec}s | Database: ${validResults[0].duration}s`);
                return validResults[0]; 
            }

            console.log(` -> SUCCESS: Found match (No duration sort applied)`);
            return validResults[0];

        } catch (error) {
            // Intercept the specific abort error so it doesn't log as a CRITICAL failure
            if (axios.isCancel(error)) {
                console.log(` -> [CANCELLED] Upstream request to LRCLIB cleanly aborted.`);
                return null;
            }
            
            if (error.code === 'ECONNABORTED') {
                console.log(` -> [LRCLIB ERROR] Server took longer than 12 seconds to respond (Timeout).`);
            } else if (error.response) {
                console.log(` -> [LRCLIB ERROR] HTTP ${error.response.status}: ${error.response.statusText}`);
                if (error.response.status === 429) console.log(` -> (We are being Rate-Limited by LRCLIB!)`);
            } else {
                console.log(` -> [NETWORK ERROR] ${error.message}`);
            }
            return null; 
        }
    };

    try {
        let data = null;
        console.log(`\n[Search] Querying: ${track_name} - ${artist_name}`);
        
        // Pass the abortController.signal into the fetch function
        data = await fetchLrc(track_name, artist_name, duration, abortController.signal);
        
        if (!data && !abortController.signal.aborted && (simplifiedTrack !== track_name || simplifiedArtist !== artist_name)) {
            console.log(` -> Original text failed, trying Simplified Chinese...`);
            data = await fetchLrc(simplifiedTrack, simplifiedArtist, duration, abortController.signal);
        }

        if (data) {
            let payloadString = data.syncedLyrics || data.plainLyrics;
            payloadString = converter(payloadString)
                .replace(/\r/g, '')             
                .replace(/[\x00-\x1F]/g, (c) => (c === '\n' ? '\n' : ''));

            return res.json({ syncedLyrics: payloadString });
        }
        
        // Only log critical failure if the request wasn't manually aborted by a song skip
        if (!abortController.signal.aborted) {
            console.log(`[CRITICAL] Processing pipeline failed to resolve any valid indices.`);
            res.status(404).json({ error: "Not found in database" });
        }
    } catch (err) {
        if (!abortController.signal.aborted) {
            res.status(500).json({ error: err.message });
        }
    }
});

app.listen(port, () => console.log(`Speed Proxy online on port ${port}`));