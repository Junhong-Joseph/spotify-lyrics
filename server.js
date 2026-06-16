const express = require('express');
const axios = require('axios');
const OpenCC = require('opencc-js');

const app = express();
const port = process.env.PORT || 3000;

// Traditional to Simplified Converter
const converter = OpenCC.Converter({ from: 'hk', to: 'cn' });

// Setup an axial instance with browser-spoofing headers to bypass bot blocks
const client = axios.create({
    timeout: 10000, // Boost timeout to 10 seconds to eliminate Render latency drops
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
    }
});

// Friendly message for the home directory root path
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

    // ==========================================
    // LAYER 1: LRCLIB (With Extended Timeout)
    // ==========================================
    try {
        console.log(`[LAYER 1] Querying LRCLIB: "${simplifiedTrack}" - ${simplifiedArtist}`);
        const lrclibUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(simplifiedTrack)}&artist_name=${encodeURIComponent(simplifiedArtist)}`;
        const response = await client.get(lrclibUrl);
        
        if (response.data && (response.data.syncedLyrics || response.data.plainLyrics)) {
            finalLyrics.syncedLyrics = response.data.syncedLyrics;
            finalLyrics.plainLyrics = response.data.plainLyrics;
            found = true;
            console.log(` -> SUCCESS: Found on LRCLIB.`);
        }
    } catch (error) {
        console.log(` -> LAYER 1 FAIL: ${error.response ? `HTTP ${error.response.status}` : error.message}`);
    }

    // ==========================================
    // LAYER 2: UNBLOCKED NETEASE MIRROR API
    // ==========================================
    if (!found) {
        // Swapped out the broken vercel app for the active mu-api production cluster
        const targetMirror = 'https://mu-api.top';
        try {
            console.log(`[LAYER 2] Querying Netease Node: ${targetMirror} for "${simplifiedTrack}"`);
            
            // Search Query
            const searchUrl = `${targetMirror}/search?keywords=${encodeURIComponent(simplifiedTrack + ' ' + simplifiedArtist)}&limit=3`;
            const searchRes = await client.get(searchUrl);
            
            if (searchRes.data && searchRes.data.result && searchRes.data.result.songs && searchRes.data.result.songs.length > 0) {
                const songId = searchRes.data.result.songs[0].id;
                console.log(` -> Found Song ID: ${songId}. Pulling lyric text layers...`);
                
                // Fetch Lyric Document
                const lyricUrl = `${targetMirror}/lyric?id=${songId}`;
                const lyricRes = await client.get(lyricUrl);

                if (lyricRes.data && lyricRes.data.lrc && lyricRes.data.lrc.lyric) {
                    finalLyrics.syncedLyrics = lyricRes.data.lrc.lyric;
                    found = true;
                    console.log(` -> SUCCESS: Pulled from Netease Matrix.`);
                }
            } else {
                console.log(` -> Netease track matching returned empty results.`);
            }
        } catch (error) {
            console.log(` -> LAYER 2 FAIL: ${error.response ? `HTTP ${error.response.status}` : error.message}`);
        }
    }

    // ==========================================
    // OUTPUT EMITTER
    // ==========================================
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
    console.log(`Hardened Aggregator Proxy actively listening on port ${port}`);
});