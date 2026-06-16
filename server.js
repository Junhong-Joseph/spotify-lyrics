const express = require('express');
const axios = require('axios');
const OpenCC = require('opencc-js');

const app = express();
const port = process.env.PORT || 3000;

const converter = OpenCC.Converter({ from: 'hk', to: 'cn' });

const client = axios.create({
    timeout: 6000, // Drop timeout down to 6s because indexed lookups are fast
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
});

app.get('/', (req, res) => res.send('High-Speed Proxy Active'));

app.get('/lyrics', async (req, res) => {
    let { track_name, artist_name, duration } = req.query;

    if (!track_name || !artist_name) {
        return res.status(400).json({ error: "Missing parameters" });
    }

    // Smart decoding pass
    if (track_name.includes('%25')) track_name = decodeURIComponent(track_name);
    if (artist_name.includes('%25')) artist_name = decodeURIComponent(artist_name);

    const simplifiedTrack = converter(track_name).trim();
    const simplifiedArtist = converter(artist_name).trim();

    const fetchLrc = async (track, artist) => {
        // High-Speed Route Switch: Append duration to trigger instant indexed mapping
        let url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(track)}&artist_name=${encodeURIComponent(artist)}`;
        if (duration && !isNaN(duration)) {
            url += `&duration=${Math.round(duration)}`;
        }
        const response = await client.get(url);
        return response.data && (response.data.syncedLyrics || response.data.plainLyrics) ? response.data : null;
    };

    try {
        let data = null;
        console.log(`[Fast-Track] Querying database for: ${track_name}`);
        
        // Try Original Encoding
        try { data = await fetchLrc(track_name, artist_name); } catch(e) {}
        
        // Try Simplified Fallback
        if (!data && (simplifiedTrack !== track_name || simplifiedArtist !== artist_name)) {
            try { data = await fetchLrc(simplifiedTrack, simplifiedArtist); } catch(e) {}
        }

        if (data) {
            let payloadString = data.syncedLyrics || data.plainLyrics;
            payloadString = converter(payloadString)
                .replace(/\r/g, '')             
                .replace(/[\x00-\x1F]/g, (c) => (c === '\n' ? '\n' : ''));

            return res.json({ syncedLyrics: payloadString });
        }
        res.status(404).json({ error: "Not found" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(port, () => console.log(`Speed Proxy online on port ${port}`));