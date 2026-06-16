const express = require('express');
const axios = require('axios');
const OpenCC = require('opencc-js');

const app = express();
const port = process.env.PORT || 3000;

const converter = OpenCC.Converter({ from: 'hk', to: 'cn' });

const client = axios.create({
    timeout: 10000, 
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
    }
});

app.get('/', (req, res) => {
    res.send('Lyrics Aggregator Proxy is running successfully!');
});

app.get('/lyrics', async (req, res) => {
    const { track_name, artist_name } = req.query;

    if (!track_name || !artist_name) {
        return res.status(400).json({ error: "Missing track or artist name" });
    }

    const simplifiedTrack = converter(track_name).trim();
    const simplifiedArtist = converter(artist_name).trim();

    let finalLyrics = { syncedLyrics: null, plainLyrics: null };
    let found = false;

    // Helper function to query LRCLIB dynamically
    const tryLrclib = async (tName, aName, attemptName) => {
        try {
            console.log(`[LRCLIB] ${attemptName} Search: "${tName}" - ${aName}`);
            const lrclibUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(tName)}&artist_name=${encodeURIComponent(aName)}`;
            const response = await client.get(lrclibUrl);
            
            if (response.data && (response.data.syncedLyrics || response.data.plainLyrics)) {
                finalLyrics.syncedLyrics = response.data.syncedLyrics;
                finalLyrics.plainLyrics = response.data.plainLyrics;
                found = true;
                console.log(` -> SUCCESS: Found via ${attemptName} string.`);
                return true;
            }
        } catch (error) {
            console.log(` -> LRCLIB ${attemptName} FAIL: ${error.response ? `HTTP ${error.response.status}` : error.message}`);
        }
        return false;
    };

    // LAYER 1: Try the exact original text first (Catches Taiwanese/HK Spotify tracks)
    await tryLrclib(track_name, artist_name, "Original");

    // LAYER 2: Try the Simplified text (If the original failed)
    if (!found && (simplifiedTrack !== track_name || simplifiedArtist !== artist_name)) {
        await tryLrclib(simplifiedTrack, simplifiedArtist, "Simplified");
    }

    // OUTPUT EMITTER (Always translates final payload to Simplified for ESP32 safety)
    if (found) {
        if (finalLyrics.syncedLyrics) finalLyrics.syncedLyrics = converter(finalLyrics.syncedLyrics);
        if (finalLyrics.plainLyrics) finalLyrics.plainLyrics = converter(finalLyrics.plainLyrics);
        res.json(finalLyrics);
    } else {
        console.log(`[CRITICAL] Processing pipeline failed to resolve any valid indices.`);
        res.status(404).json({ error: "Lyrics not found in any database down the fallback chain." });
    }
});

app.listen(port, () => {
    console.log(`Dynamic Aggregator Proxy actively listening on port ${port}`);
});