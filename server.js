import 'dotenv/config';
import express from 'express';
import WebTorrent from 'webtorrent';
import cors from 'cors';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import axios from 'axios';
import path from 'path';
import * as cheerio from 'cheerio';
import AdmZip from 'adm-zip';
import { translate } from 'google-translate-api-x';

// Set global headers for all axios requests to avoid 403 blocks (BaiscopeLK, SubDL etc.)
axios.defaults.headers.common['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';
axios.defaults.headers.common['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7';
axios.defaults.headers.common['Accept-Language'] = 'en-US,en;q=0.9';
axios.defaults.headers.common['Cache-Control'] = 'no-cache';
axios.defaults.headers.common['Pragma'] = 'no-cache';
axios.defaults.headers.common['Referer'] = 'https://www.google.com/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import baiscopelk from 'baiscopelk-api';
const { baiscopelksearch, baiscopelkdownload } = baiscopelk;

const app = express();
const client = new WebTorrent();

const PORT = 3000;
const STORAGE_DIR = path.join(__dirname, 'storage');
const MOVIES_DIR = path.join(STORAGE_DIR, 'movies');
const SUBS_DIR = path.join(STORAGE_DIR, 'subtitles');
const DB_FILE = path.join(STORAGE_DIR, 'downloads.json');
const SUBS_DB_FILE = path.join(STORAGE_DIR, 'subtitles.json');

fs.ensureDirSync(MOVIES_DIR);
fs.ensureDirSync(SUBS_DIR);

let downloads = {};
let subtitles = {};
if (fs.existsSync(DB_FILE)) downloads = fs.readJsonSync(DB_FILE);
if (fs.existsSync(SUBS_DB_FILE)) subtitles = fs.readJsonSync(SUBS_DB_FILE);

function saveDB() {
    fs.writeJsonSync(DB_FILE, downloads, { spaces: 2 });
}
function saveSubsDB() {
    fs.writeJsonSync(SUBS_DB_FILE, subtitles, { spaces: 2 });
}

app.use(cors());
app.use(express.json());

app.use('/', express.static(__dirname));
app.use('/downloads', express.static(MOVIES_DIR));
app.use('/subtitles', express.static(SUBS_DIR));

const activeTorrents = {};

app.post('/api/start-download', (req, res) => {
    const { movie_id, magnet_link, title } = req.body;
    if (!magnet_link) return res.status(400).json({ error: 'Magnet link is required' });
    if (downloads[movie_id] && downloads[movie_id].status === 'completed') return res.json(downloads[movie_id]);
    try {
        if (activeTorrents[movie_id]) return res.json(downloads[movie_id]);
        const torrent = client.add(magnet_link, { path: MOVIES_DIR }, (t) => {
            activeTorrents[movie_id] = t;
            downloads[movie_id] = { id: movie_id, title, magnet_link, status: 'downloading', progress: 0, path: t.path, fileName: t.name, speed: 'Initializing...' };
            saveDB();
            t.on('download', () => {
                downloads[movie_id].progress = (t.progress * 100).toFixed(2);
                downloads[movie_id].speed = (t.downloadSpeed / 1024 / 1024).toFixed(2) + ' MB/s';
            });
            t.on('done', () => {
                // Find the largest file (the movie) to provide a direct download link
                const movieFile = t.files.reduce((prev, curr) => (prev.length > curr.length) ? prev : curr);
                downloads[movie_id].status = 'completed';
                downloads[movie_id].progress = 100;
                downloads[movie_id].speed = '0 MB/s';
                
                // If the torrent is a folder, t.name is the folder. We need path relative to MOVIES_DIR.
                downloads[movie_id].downloadUrl = `http://localhost:${PORT}/downloads/${encodeURIComponent(movieFile.path)}`;
                downloads[movie_id].fileName = movieFile.name;
                saveDB();
                console.log(`[DOWNLOAD] Completed: ${movieFile.name}`);
            });
            t.on('error', (err) => {
                downloads[movie_id].status = 'failed';
                downloads[movie_id].error = err.message;
                saveDB();
                delete activeTorrents[movie_id];
            });
        });
        downloads[movie_id] = { id: movie_id, title, magnet_link, status: 'starting', progress: 0, speed: 'Connecting...' };
        saveDB();
        res.json({ message: 'Download started', id: movie_id });
    } catch (error) { res.status(500).json({ error: 'Failed to start download' }); }
});

app.get('/api/download-status/:movie_id', (req, res) => {
    const dl = downloads[req.params.movie_id];
    if (!dl) return res.status(404).json({ error: 'Not found' });
    res.json(dl);
});

app.post('/api/pause-download/:movie_id', (req, res) => {
    const movie_id = req.params.movie_id;
    const t = activeTorrents[movie_id];
    if (t) { t.destroy(); delete activeTorrents[movie_id]; }
    if (downloads[movie_id]) { downloads[movie_id].status = 'paused'; downloads[movie_id].speed = 'Paused'; saveDB(); res.json({ message: 'Paused successfully' }); }
    else res.status(404).json({ error: 'Download not found' });
});

app.post('/api/resume-download/:movie_id', (req, res) => {
    const movie_id = req.params.movie_id;
    const dl = downloads[movie_id];
    if (!dl) return res.status(404).json({ error: 'Download not found' });
    if (activeTorrents[movie_id]) { dl.status = 'downloading'; saveDB(); return res.json({ message: 'Resumed' }); }
    const t = client.add(dl.magnet_link, { path: MOVIES_DIR }, (torrent) => {
        activeTorrents[movie_id] = torrent;
        dl.status = 'downloading'; saveDB();
        torrent.on('download', () => {
            if (downloads[movie_id]) {
                downloads[movie_id].progress = (torrent.progress * 100).toFixed(2);
                downloads[movie_id].speed = (torrent.downloadSpeed / 1024 / 1024).toFixed(2) + ' MB/s';
            }
        });
        torrent.on('done', () => {
            if (downloads[movie_id]) {
                const largest = torrent.files.reduce((p, c) => (p.length > c.length) ? p : c);
                downloads[movie_id].status = 'completed'; 
                downloads[movie_id].progress = 100;
                downloads[movie_id].fileName = largest.name;
                downloads[movie_id].downloadUrl = `http://localhost:${PORT}/downloads/${encodeURIComponent(largest.path)}`;
                saveDB();
            }
        });
    });
    res.json({ message: 'Resumed successfully' });
});

app.post('/api/delete-download/:movie_id', async (req, res) => {
    const movie_id = req.params.movie_id;
    const dl = downloads[movie_id];
    const t = activeTorrents[movie_id];

    if (t) {
        try { t.destroy(); } catch(e) {} 
        delete activeTorrents[movie_id];
    }

    if (dl) {
        if (dl.fileName) {
            const fileRelativePath = decodeURIComponent(dl.downloadUrl?.split('/downloads/')?.[1] || dl.fileName);
            const fullPath = path.join(MOVIES_DIR, fileRelativePath);
            try { await fs.remove(fullPath); } catch(e) { console.warn("Cleanup failed:", e.message); }
        }
        delete downloads[movie_id];
        saveDB();
        res.json({ message: 'Deleted successfully' });
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

app.get('/api/stream/:movie_id', async (req, res) => {
    const movie_id = req.params.movie_id;
    let torrent = activeTorrents[movie_id];
    
    // Wait for torrent to parse if it's there but not ready (max 10s)
    let retries = 0;
    while ((!torrent || !torrent.files.length) && retries < 20) {
        await new Promise(r => setTimeout(r, 500));
        torrent = activeTorrents[movie_id];
        retries++;
        if (torrent?.files?.length) break;
    }

    if (!torrent || !torrent.files.length) {
        // Fallback: Check if completed and available in storage
        const dl = downloads[movie_id];
        if (dl && dl.status === 'completed') {
            const filePath = path.join(MOVIES_DIR, decodeURIComponent(dl.downloadUrl.split('/downloads/')[1]));
            if (fs.existsSync(filePath)) return res.sendFile(filePath);
        }
        return res.status(404).send('Torrent not active or metadata not ready yet. Please retry in a few seconds.');
    }

    const file = torrent.files.reduce((p, c) => (p.length > c.length) ? p : c);
    const range = req.headers.range;

    if (!range) {
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Length', file.length);
        res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
        return file.createReadStream().pipe(res);
    }

    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : file.length - 1;
    const chunksize = (end - start) + 1;

    res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${file.length}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="${file.name}"`
    });

    file.createReadStream({ start, end }).pipe(res);
});
app.get('/api/yts-proxy', async (req, res) => {
    const { query } = req.query;
    if (!query) return res.status(400).json({ error: 'Query required' });
    const domains = ['yts.mx', 'yts.bz', 'yts.li', 'yts.pm'];
    for (const domain of domains) {
        try {
            const ytsUrl = `https://${domain}/api/v2/list_movies.json?query_term=${query}&limit=1&sort_by=seeds`;
            const response = await axios.get(ytsUrl);
            if (response.data?.status === 'ok') {
                return res.json(response.data);
            }
        } catch (e) {
            console.warn(`[YTS-PROXY] ${domain} failed: ${e.message}`);
        }
    }
    res.status(500).json({ error: 'YTS unreachable across all domains' });
});

// ─────────────────────────────────────────────────────────────────
//  SUBTITLE ENGINE (3-TIER + CLAUDE)
// ─────────────────────────────────────────────────────────────────

async function hasSinhalaContent(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf8');
        const sinhalaChars = (content.match(/[\u0D80-\u0DFF]/g) || []).length;
        return sinhalaChars > 10;
    } catch { return false; }
}

function srtToVtt(srtContent) {
    return 'WEBVTT\n\n' + srtContent
        .replace(/\r\n|\r/g, '\n')
        .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
        .replace(/<font[^>]*>/gi, '').replace(/<\/font>/gi, '')
        .replace(/{[^}]+}/g, '');
}

async function translateVttToSinhala(vttContent) { 
    if (!vttContent) return '';
    const blocks = vttContent.split(/\n\n/);
    const header = blocks[0]; 
    const cueBlocks = blocks.slice(1).filter(b => b.trim());

    const cues = cueBlocks.map(block => {
        const lines = block.split('\n');
        const tsIndex = lines.findIndex(l => l.includes('-->'));
        return {
            prefix: lines.slice(0, tsIndex + 1).join('\n'), 
            text: lines.slice(tsIndex + 1).join('\n').replace(/<[^>]+>/g, '').trim()
        };
    });

    const BATCH = 50; // Larger batch for speed
    const translated = [];

    console.log(`[TRANSLATE] Translating ${cues.length} cues in batches of ${BATCH}...`);

    for (let i = 0; i < cues.length; i += BATCH) {
        const batch = cues.slice(i, i + BATCH).map(c => c.text);
        const batchNum = Math.floor(i / BATCH) + 1;
        const totalBatches = Math.ceil(cues.length / BATCH);
        console.log(`[TRANSLATE] Batch ${batchNum}/${totalBatches} (${batch.length} lines)...`);
        try {
            const res = await translate(batch, { to: 'si', from: 'en' });
            // google-translate-api-x returns an array of objects for multi-input
            const batchResults = Array.isArray(res) ? res.map(r => r.text) : [res.text];
            
            if (batchResults.length !== batch.length) {
                console.warn(`[TRANSLATE] Count mismatch in batch. Fallback to English.`);
                batch.forEach(t => translated.push(t));
            } else {
                batchResults.forEach(t => translated.push(t));
            }
        } catch (err) {
            console.error(`[TRANSLATE] Batch failed: ${err.message}`);
            batch.forEach(t => translated.push(t));
        }
        await new Promise(r => setTimeout(r, 500)); // Shorter delay for speed
    }

    const reassembled = cues.map((cue, i) => `${cue.prefix}\n${translated[i] || cue.text}`);
    return [header, ...reassembled].join('\n\n');
}

async function fetchSinhalaSubtitle(imdb_id, movie_id, movieTitle = '') { // CHANGED: 3-tier + BaiscopeLK
    const siFilePath = path.join(SUBS_DIR, `${movie_id}_si.vtt`);

    // Cache check
    if (await fs.pathExists(siFilePath) && await hasSinhalaContent(siFilePath)) {
        console.log(`[SUBS] Serve cached Sinhala for ${movie_id}`);
        return siFilePath;
    }

    const subdlKey = process.env.SUBDL_KEY;
    const osKey = process.env.OPENSUBS_KEY;

    // TIER 0: BaiscopeLK (Native Sinhala)
    if (movieTitle) {
        try {
            console.log(`[BAISCOPE] Searching: ${movieTitle}`);
            const searchUrl = `https://www.baiscopelk.com/?s=${encodeURIComponent(movieTitle)}`;
            const searchRes = await axios.get(searchUrl);
            const $ = cheerio.load(searchRes.data);
            const moviePage = $('.entry-title a, .post-title a').first().attr('href');
            
            if (moviePage) {
                console.log(`[BAISCOPE] Found page: ${moviePage}`);
                const pageRes = await axios.get(moviePage);
                const $page = cheerio.load(pageRes.data);
                const zipUrl = $page('a[href*="/download/"], a[href*=".zip"], .download-link a').first().attr('href');
                
                if (zipUrl) {
                    console.log(`[BAISCOPE] Zip URL Found: ${zipUrl}`);
                    const zipRes = await axios.get(zipUrl, { responseType: 'arraybuffer' });
                    const zip = new AdmZip(Buffer.from(zipRes.data));
                    const srtEntry = zip.getEntries().find(e => {
                        const name = e.entryName.toLowerCase();
                        return name.endsWith('.srt') && !name.includes('macosx');
                    });
                    
                    if (srtEntry) {
                        const vtt = srtToVtt(srtEntry.getData().toString('utf8'));
                        await fs.writeFile(siFilePath, vtt, 'utf8');
                        return siFilePath;
                    }
                }
            }
        } catch (e) {
            console.warn(`[BAISCOPE] Error: ${e.message}`);
        }
    }

    // TIER 1: SubDL Native Sinhala
    if (subdlKey) {
        try {
            console.log(`[SUBDL] Checking Native Sinhala for ${imdb_id}`);
            const res = await axios.get(`https://api.subdl.com/api/v1/subtitles?api_key=${subdlKey}&imdb_id=${imdb_id}&languages=SI&subs_per_page=5`);
            if (res.data?.subtitles?.length > 0) {
                const subUrl = `https://dl.subdl.com${res.data.subtitles[0].url}`;
                const zipRes = await axios.get(subUrl, { responseType: 'arraybuffer' });
                const zip = new AdmZip(Buffer.from(zipRes.data));
                const srtEntry = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.srt'));
                if (srtEntry) {
                    const vtt = srtToVtt(srtEntry.getData().toString('utf8'));
                    await fs.writeFile(siFilePath, vtt, 'utf8');
                    console.log(`[SUBDL] ✅ Native Sinhala found for ${imdb_id}`);
                    return siFilePath;
                }
            }
        } catch (e) { console.warn(`[SUBDL-SI] Error: ${e.message}`); }
    }

    // TIER 2 & 3: English + Translation
    let enSrt = null;

    // T2: SubDL English
    if (subdlKey) {
        try {
            const res = await axios.get(`https://api.subdl.com/api/v1/subtitles?api_key=${subdlKey}&imdb_id=${imdb_id}&languages=EN&subs_per_page=5`);
            if (res.data?.subtitles?.length > 0) {
                const zipRes = await axios.get(`https://dl.subdl.com${res.data.subtitles[0].url}`, { responseType: 'arraybuffer' });
                const zip = new AdmZip(Buffer.from(zipRes.data));
                const srtEntry = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.srt'));
                if (srtEntry) enSrt = srtEntry.getData().toString('utf8');
            }
        } catch (e) { console.warn(`[SUBDL-EN] Error: ${e.message}`); }
    }

    // T3: OpenSubs English (Fallback)
    if (!enSrt && osKey) {
        try {
            const tImdb = imdb_id.replace(/^tt/, '');
            const osRes = await axios.get(`https://api.opensubtitles.com/api/v1/subtitles?imdb_id=${tImdb}&languages=en&order_by=download_count`, { headers: { 'Api-Key': osKey } });
            if (osRes.data?.data?.length > 0) {
                const dlRes = await axios.post('https://api.opensubtitles.com/api/v1/download', { file_id: osRes.data.data[0].attributes.files[0].file_id }, { headers: { 'Api-Key': osKey, 'Content-Type': 'application/json' } });
                const srtRes = await axios.get(dlRes.data.link, { responseType: 'text' });
                enSrt = srtRes.data;
            }
        } catch (e) { console.warn(`[OS-EN] Error: ${e.message}`); }
    }

    if (!enSrt) {
        throw new Error("No usable English source found for translation. Try generating again later.");
    }

    console.log(`[SUBS] Translating English SRT to Sinhala for ${movie_id}...`);
    try {
        const sinhalaVtt = await translateVttToSinhala(srtToVtt(enSrt));
        await fs.writeFile(siFilePath, sinhalaVtt, 'utf8');
        console.log(`[SUBS] ✅ Translation complete for ${movie_id}`);
        return siFilePath;
    } catch (err) {
        console.error(`[SUBS] Translation failed: ${err.message}`);
        throw new Error("Translation service is currently busy. Please try again in 1 minute.");
    }
}

app.get('/api/translate-subtitle/:movie_id', async (req, res) => {
    const { movie_id } = req.params;
    const { imdb_id, title } = req.query;
    console.log(`[ROUTE] /api/translate-subtitle/${movie_id} - IMDB: ${imdb_id}, Title: ${title}`);
    
    if (!imdb_id) return res.status(400).json({ error: "imdb_id required" });

    try {
        const filePath = await fetchSinhalaSubtitle(imdb_id, movie_id, title);
        if (!filePath || !fs.existsSync(filePath)) {
            throw new Error("Subtitle file not found after generation.");
        }
        res.download(filePath, `Sinhala_${movie_id}.vtt`);
    } catch (e) {
        console.error(`[ROUTE-ERROR] ${e.message}`);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/subtitles/:movie_id', async (req, res) => {
    const { movie_id } = req.params;
    const { imdb_id } = req.query;
    const enFilePath = path.join(SUBS_DIR, `${movie_id}_en.vtt`);

    if (await fs.pathExists(enFilePath)) return res.json({ status: 'ready', url: `http://localhost:${PORT}/subtitles/${movie_id}_en.vtt` });

    try {
        // Simple fetch of English SRT for the basic EN toggle
        const osKey = process.env.OPENSUBS_KEY;
        const tImdb = imdb_id.replace(/^tt/, '');
        const osRes = await axios.get(`https://api.opensubtitles.com/api/v1/subtitles?imdb_id=${tImdb}&languages=en&order_by=download_count`, { headers: { 'Api-Key': osKey } });
        const dlRes = await axios.post('https://api.opensubtitles.com/api/v1/download', { file_id: osRes.data.data[0].attributes.files[0].file_id }, { headers: { 'Api-Key': osKey, 'Content-Type': 'application/json' } });
        const srtRes = await axios.get(dlRes.data.link, { responseType: 'text' });
        const vtt = srtToVtt(srtRes.data);
        await fs.writeFile(enFilePath, vtt, 'utf8');
        res.json({ status: 'ready', url: `http://localhost:${PORT}/subtitles/${movie_id}_en.vtt` });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`Cinevora Backend running at port ${PORT}`));
