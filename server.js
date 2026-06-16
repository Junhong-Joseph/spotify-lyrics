const express = require('express');
const axios = require('axios');
const OpenCC = require('opencc-js');

const app = express();
const port = process.env.PORT || 3000;

const converter = OpenCC.Converter({ from: 'hk', to: 'cn' });

const client = axios.create({
    // Removed the global timeout here because we are dynamically setting it below
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
});

app.get('/', (req, res) => res.send('High-Speed Proxy Active'));

app.get('/lyrics', async (req, res) => {
    let { track_name, artist_name, duration } = req.query;

    if (!track_name || !artist_name) {
        return res.status(400).json({ error: "Missing parameters" });
    }

    // FIX 1: Robust Double-Decoding Matrix
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

    // UPGRADED HELPER: Includes ±2s Drift Buffer and Fail-Fast Timeouts
    const fetchLrc = async (track, artist, useDuration) => {
        const baseUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(track)}&artist_name=${encodeURIComponent(artist)}`;

        // PATH 1: Strict Duration Match with ±2s Offset Buffer
        if (useDuration && duration && !isNaN(duration)) {
            const baseSec = Math.round(duration);
            const offsets = [0, 1, -1, 2, -2]; // Checks exact time, then sweeps outward

            for (let offset of offsets) {
                try {
                    const url = `${baseUrl}&duration=${baseSec + offset}`;
                    // FAIL-FAST: Only give the database 2 seconds to prove the duration exists
                    const response = await client.get(url, { timeout: 2000 });
                    
                    if (response.data && (response.data.syncedLyrics || response.data.plainLyrics)) {
                        console.log(` -> SUCCESS: Duration matched with a ${offset}s offset!`);
                        return response.data;
                    }
                } catch (error) {
                    // Silently ignore timeouts/404s and instantly test the next offset
                }
            }
            return null; // The entire 5-check buffer window failed
        } 
        // PATH 2: Fuzzy Text Search
        else {
            try {
                // Generous 6-second timeout for the heavier fuzzy search
                const response = await client.get(baseUrl, { timeout: 6000 });
                return response.data && (response.data.syncedLyrics || response.data.plainLyrics) ? response.data : null;
            } catch (error) {
                return null; 
            }
        }
    };

    try {
        let data = null;
        console.log(`[Search] Querying: ${track_name}`);
        
        // ==========================================
        // LAYER 1: Ultra-Fast Indexed Search (with ±2s buffer)
        // ==========================================
        data = await fetchLrc(track_name, artist_name, true);
        if (!data && (simplifiedTrack !== track_name || simplifiedArtist !== artist_name)) {
            data = await fetchLrc(simplifiedTrack, simplifiedArtist, true);
        }

        // ==========================================
        // LAYER 2: Fallback Text Search 
        // ==========================================
        if (!data) {
            console.log(` -> Duration buffer failed to find a match. Falling back to fuzzy text search...`);
            data = await fetchLrc(track_name, artist_name, false);
        }
        if (!data && (simplifiedTrack !== track_name || simplifiedArtist !== artist_name)) {
            data = await fetchLrc(simplifiedTrack, simplifiedArtist, false);
        }

        // ==========================================
        // OUTPUT EMITTER
        // ==========================================
        if (data) {
            let payloadString = data.syncedLyrics || data.plainLyrics;
            payloadString = converter(payloadString)
                .replace(/\r/g, '')             
                .replace(/[\x00-\x1F]/g, (c) => (c === '\n' ? '\n' : ''));

            return res.json({ syncedLyrics: payloadString });
        }
        res.status(404).json({ error: "Not found in database" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(port, () => console.log(`Speed Proxy online on port ${port}`));