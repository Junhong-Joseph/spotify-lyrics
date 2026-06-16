const express = require('express');
const axios = require('axios');
const OpenCC = require('opencc-js');

const app = express();
const port = process.env.PORT || 3000;

const converter = OpenCC.Converter({ from: 'hk', to: 'cn' });

const client = axios.create({
    timeout: 8000, 
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
});

app.get('/', (req, res) => res.send('High-Speed Proxy Active'));

app.get('/lyrics', async (req, res) => {
    let { track_name, artist_name, duration } = req.query;

    if (!track_name || !artist_name) {
        return res.status(400).json({ error: "Missing parameters" });
    }

    // FIX 1: Robust Double-Decoding Matrix
    // Checks if the string still contains valid URL hex codes (like %E6) and decodes them safely
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

    // Helper function now accepts a 'useDuration' flag
    const fetchLrc = async (track, artist, useDuration) => {
        let url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(track)}&artist_name=${encodeURIComponent(artist)}`;
        if (useDuration && duration && !isNaN(duration)) {
            url += `&duration=${Math.round(duration)}`;
        }
        try {
            const response = await client.get(url);
            return response.data && (response.data.syncedLyrics || response.data.plainLyrics) ? response.data : null;
        } catch (error) {
            return null; // Catch 404s silently so fallbacks can execute
        }
    };

    try {
        let data = null;
        console.log(`[Search] Querying: ${track_name}`);
        
        // ==========================================
        // LAYER 1: Ultra-Fast Indexed Search
        // ==========================================
        data = await fetchLrc(track_name, artist_name, true);
        if (!data && (simplifiedTrack !== track_name || simplifiedArtist !== artist_name)) {
            data = await fetchLrc(simplifiedTrack, simplifiedArtist, true);
        }

        // ==========================================
        // LAYER 2: Fallback Text Search (FIX 2)
        // If Layer 1 failed, it's likely a duration mismatch. Drop duration and try again!
        // ==========================================
        if (!data) {
            console.log(` -> Duration strict-match failed. Falling back to fuzzy text search...`);
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