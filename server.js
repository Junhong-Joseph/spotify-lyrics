const express = require('express');
const axios = require('axios');
const OpenCC = require('opencc-js');

const app = express();
const port = process.env.PORT || 3000;

// Converter to turn Traditional (hk/tw) into Simplified (cn)
const converter = OpenCC.Converter({ from: 'hk', to: 'cn' });

app.get('/lyrics', async (req, res) => {
    const { track_name, artist_name } = req.query;

    if (!track_name || !artist_name) {
        return res.status(400).json({ error: "Missing track or artist name" });
    }

    // 1. Translate the search terms themselves so the backend databases match!
    const simplifiedTrack = converter(track_name);
    const simplifiedArtist = converter(artist_name);

    let finalLyrics = { syncedLyrics: null, plainLyrics: null };
    let found = false;

    // Helper function to process LRCLIB queries
    const tryLrclib = async (tName, aName, attemptName) => {
        try {
            console.log(`[LRCLIB] ${attemptName} Search: ${tName} - ${aName}`);
            const lrclibUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(tName)}&artist_name=${encodeURIComponent(aName)}`;
            const response = await axios.get(lrclibUrl, { timeout: 5000 });
            
            if (response.data && (response.data.syncedLyrics || response.data.plainLyrics)) {
                finalLyrics.syncedLyrics = response.data.syncedLyrics;
                finalLyrics.plainLyrics = response.data.plainLyrics;
                found = true;
                return true;
            }
        } catch (error) {
            console.log(`[LRCLIB] ${attemptName} Failed: ${error.response ? error.response.status : error.message}`);
        }
        return false;
    };

    // Attempt 1: Exact Match (Original Text)
    await tryLrclib(track_name, artist_name, "Original");

    // Attempt 2: Simplified Match (If original input was Traditional)
    if (!found && (simplifiedTrack !== track_name || simplifiedArtist !== artist_name)) {
        await tryLrclib(simplifiedTrack, simplifiedArtist, "Simplified");
    }

    // Attempt 3: Netease Fallback (Using a stable public instance)
    if (!found) {
        try {
            console.log(`[Netease] Trying Fallback Search: ${simplifiedTrack} - ${simplifiedArtist}`);
            const neteaseSearch = `https://neteasecloudmusicapi.vercel.app/search?keywords=${encodeURIComponent(simplifiedTrack + ' ' + simplifiedArtist)}&limit=1`;
            const searchRes = await axios.get(neteaseSearch, { timeout: 5000 });
            
            if (searchRes.data.result && searchRes.data.result.songs && searchRes.data.result.songs.length > 0) {
                const songId = searchRes.data.result.songs[0].id;
                console.log(`[Netease] Found Song ID: ${songId}. Fetching LRC matrix...`);
                
                const lyricUrl = `https://neteasecloudmusicapi.vercel.app/lyric?id=${songId}`;
                const lyricRes = await axios.get(lyricUrl, { timeout: 5000 });

                if (lyricRes.data.lrc && lyricRes.data.lrc.lyric) {
                    finalLyrics.syncedLyrics = lyricRes.data.lrc.lyric;
                    found = true;
                }
            } else {
                console.log(`[Netease] Search executed but returned no songs.`);
            }
        } catch (error) {
            console.log(`[Netease] Fallback Flow Failed: ${error.message}`);
        }
    }

    // FINAL DATA PROCESSING
    if (found) {
        // Enforce conversion to Simplified Chinese so the ESP32 gb2312 font doesn't crash
        if (finalLyrics.syncedLyrics) finalLyrics.syncedLyrics = converter(finalLyrics.syncedLyrics);
        if (finalLyrics.plainLyrics) finalLyrics.plainLyrics = converter(finalLyrics.plainLyrics);
        
        res.json(finalLyrics);
    } else {
        res.status(404).json({ error: "Lyrics not found in any database down the fallback chain." });
    }
});

app.listen(port, () => {
    console.log(`Lyrics Aggregator Proxy actively listening on port ${port}`);
});