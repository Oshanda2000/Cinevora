import axios from 'axios';
import * as cheerio from 'cheerio';
import AdmZip from 'adm-zip';
import { translate } from 'google-translate-api-x';

axios.defaults.headers.common['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';
axios.defaults.headers.common['Accept-Language'] = 'en-US,en;q=0.9';

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
}

function srtToVtt(srt) {
    return 'WEBVTT\n\n' + srt
        .replace(/\r\n|\r/g, '\n')
        .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
        .replace(/<font[^>]*>/gi, '').replace(/<\/font>/gi, '')
        .replace(/\{[^}]+\}/g, '');
}

async function translateVttToSinhala(vttContent) {
    if (!vttContent) return '';
    const blocks = vttContent.split(/\n\n/);
    const header = blocks[0];
    const cues = blocks.slice(1).filter(b => b.trim()).map(block => {
        const lines = block.split('\n');
        const tsIdx = lines.findIndex(l => l.includes('-->'));
        if (tsIdx < 0) return null;
        return {
            prefix: lines.slice(0, tsIdx + 1).join('\n'),
            text: lines.slice(tsIdx + 1).join('\n').replace(/<[^>]+>/g, '').trim()
        };
    }).filter(Boolean);

    // Cap at 1200 cues to avoid Netlify timeout, translate in 2 parallel streams
    const MAX = 1200;
    const limited = cues.slice(0, MAX);
    const translated = new Array(limited.length);
    const BATCH = 80;
    const half = Math.ceil(limited.length / 2);

    async function stream(start, end) {
        for (let i = start; i < end; i += BATCH) {
            const batch = limited.slice(i, i + BATCH).map(c => c.text);
            try {
                const res = await translate(batch, { to: 'si', from: 'en' });
                const out = Array.isArray(res) ? res.map(r => r.text) : [res.text];
                out.forEach((t, j) => { translated[i + j] = t; });
            } catch {
                batch.forEach((t, j) => { translated[i + j] = t; });
            }
        }
    }

    await Promise.all([stream(0, half), stream(half, limited.length)]);

    const reassembled = limited.map((c, i) => `${c.prefix}\n${translated[i] || c.text}`);
    // Append untranslated remainder (if movie was very long)
    if (cues.length > MAX) {
        cues.slice(MAX).forEach(c => reassembled.push(`${c.prefix}\n${c.text}`));
    }
    return [header, ...reassembled].join('\n\n');
}

async function fetchSinhalaSubtitle(imdb_id, movieTitle) {
    const SUBDL_KEY = process.env.SUBDL_KEY;
    const OS_KEY = process.env.OPENSUBS_KEY;

    // ── TIER 0: BaiscopeLK scraping (no key needed) ──────────────────
    if (movieTitle) {
        try {
            const searchRes = await axios.get(`https://www.baiscopelk.com/?s=${encodeURIComponent(movieTitle)}`, { timeout: 6000 });
            const $ = cheerio.load(searchRes.data);
            const moviePage = $('.entry-title a, .post-title a').first().attr('href');
            if (moviePage) {
                const pageRes = await axios.get(moviePage, { timeout: 6000 });
                const $p = cheerio.load(pageRes.data);
                const zipUrl = $p('a[href*="/download/"], a[href*=".zip"], .download-link a').first().attr('href');
                if (zipUrl) {
                    const zipRes = await axios.get(zipUrl, { responseType: 'arraybuffer', timeout: 8000 });
                    const zip = new AdmZip(Buffer.from(zipRes.data));
                    const srt = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.srt') && !e.entryName.includes('__MACOSX'));
                    if (srt) { console.log('[BAISCOPE] ✅ Native Sinhala found'); return srtToVtt(srt.getData().toString('utf8')); }
                }
            }
        } catch (e) { console.warn('[BAISCOPE]', e.message); }
    }

    // ── TIER 1: SubDL Native Sinhala ─────────────────────────────────
    if (SUBDL_KEY) {
        try {
            const r = await axios.get(`https://api.subdl.com/api/v1/subtitles?api_key=${SUBDL_KEY}&imdb_id=${imdb_id}&languages=SI&subs_per_page=5`, { timeout: 8000 });
            if (r.data?.subtitles?.length > 0) {
                const zipRes = await axios.get(`https://dl.subdl.com${r.data.subtitles[0].url}`, { responseType: 'arraybuffer', timeout: 8000 });
                const zip = new AdmZip(Buffer.from(zipRes.data));
                const srt = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.srt'));
                if (srt) { console.log('[SUBDL] ✅ Native Sinhala found'); return srtToVtt(srt.getData().toString('utf8')); }
            }
        } catch (e) { console.warn('[SUBDL-SI]', e.message); }
    }

    // ── TIER 2+3: English source → translate ─────────────────────────
    let enSrt = null;

    if (SUBDL_KEY) {
        try {
            const r = await axios.get(`https://api.subdl.com/api/v1/subtitles?api_key=${SUBDL_KEY}&imdb_id=${imdb_id}&languages=EN&subs_per_page=5`, { timeout: 8000 });
            if (r.data?.subtitles?.length > 0) {
                const zipRes = await axios.get(`https://dl.subdl.com${r.data.subtitles[0].url}`, { responseType: 'arraybuffer', timeout: 8000 });
                const zip = new AdmZip(Buffer.from(zipRes.data));
                const srt = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.srt'));
                if (srt) enSrt = srt.getData().toString('utf8');
            }
        } catch (e) { console.warn('[SUBDL-EN]', e.message); }
    }

    if (!enSrt && OS_KEY) {
        try {
            const tId = imdb_id.replace(/^tt/, '');
            const osR = await axios.get(`https://api.opensubtitles.com/api/v1/subtitles?imdb_id=${tId}&languages=en&order_by=download_count`, { headers: { 'Api-Key': OS_KEY, 'User-Agent': 'CinevraApp v1.0' }, timeout: 8000 });
            if (osR.data?.data?.length > 0) {
                const dlR = await axios.post('https://api.opensubtitles.com/api/v1/download', { file_id: osR.data.data[0].attributes.files[0].file_id }, { headers: { 'Api-Key': OS_KEY, 'Content-Type': 'application/json', 'User-Agent': 'CinevraApp v1.0' }, timeout: 8000 });
                const srtR = await axios.get(dlR.data.link, { responseType: 'text', timeout: 8000 });
                enSrt = srtR.data;
            }
        } catch (e) { console.warn('[OPENSUBS-EN]', e.message); }
    }

    // ── TIER 4: YIFY Subtitles (no key needed — free) ─────────────────
    if (!enSrt) {
        try {
            const yifyR = await axios.get(`https://yifysubtitles.ch/movie-imdb/${imdb_id}`, { timeout: 8000 });
            const $y = cheerio.load(yifyR.data);
            // Prefer Sinhala, fall back to English
            let subPath = '';
            $y('.select-subtitle tr').each((_, row) => {
                const lang = $y(row).find('td').eq(1).text().trim().toLowerCase();
                const link = $y(row).find('a[href*="/subtitles/"]').attr('href');
                if (lang === 'sinhala' && !subPath) subPath = link;
            });
            if (!subPath) {
                $y('.select-subtitle tr').each((_, row) => {
                    const lang = $y(row).find('td').eq(1).text().trim().toLowerCase();
                    const link = $y(row).find('a[href*="/subtitles/"]').attr('href');
                    if (lang === 'english' && !subPath) subPath = link;
                });
            }
            if (subPath) {
                const subPage = await axios.get(`https://yifysubtitles.ch${subPath}`, { timeout: 8000 });
                const $sp = cheerio.load(subPage.data);
                const dlLink = $sp('a.download-subtitle').attr('href') || $sp('a[href$=".zip"]').first().attr('href');
                if (dlLink) {
                    const fullLink = dlLink.startsWith('http') ? dlLink : `https://yifysubtitles.ch${dlLink}`;
                    const zipRes = await axios.get(fullLink, { responseType: 'arraybuffer', timeout: 10000 });
                    const zip = new AdmZip(Buffer.from(zipRes.data));
                    const srt = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.srt') && !e.entryName.includes('__MACOSX'));
                    if (srt) {
                        enSrt = srt.getData().toString('utf8');
                        console.log('[YIFY] ✅ Found subtitle via YIFY');
                    }
                }
            }
        } catch (e) { console.warn('[YIFY]', e.message); }
    }

    // ── TIER 5: SubDL free (no key, search by title) ──────────────────
    if (!enSrt && movieTitle) {
        try {
            const searchQ = encodeURIComponent(movieTitle);
            const r = await axios.get(`https://api.subdl.com/auto?query=${searchQ}&languages=en`, {
                headers: { 'Accept': 'application/json' }, timeout: 8000
            });
            const results = r.data?.subtitles || r.data?.results || [];
            if (results.length > 0) {
                const first = results[0];
                const zipUrl = first.url || first.zip_link || first.download_link;
                if (zipUrl) {
                    const base = zipUrl.startsWith('http') ? zipUrl : `https://dl.subdl.com${zipUrl}`;
                    const zipRes = await axios.get(base, { responseType: 'arraybuffer', timeout: 10000 });
                    const zip = new AdmZip(Buffer.from(zipRes.data));
                    const srt = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.srt') && !e.entryName.includes('__MACOSX'));
                    if (srt) { enSrt = srt.getData().toString('utf8'); console.log('[SUBDL-FREE] ✅ Found via free search'); }
                }
            }
        } catch (e) { console.warn('[SUBDL-FREE]', e.message); }
    }

    if (!enSrt) throw new Error('No English subtitle source found for this movie. Subtitles may not be available yet.');

    console.log('[TRANSLATE] Starting Sinhala translation...');
    return translateVttToSinhala(srtToVtt(enSrt));
}

export default async (req, context) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

    const url = new URL(req.url);
    const movie_id = context.params?.movie_id || url.searchParams.get('movie_id') || 'unknown';
    const imdb_id = url.searchParams.get('imdb_id');
    const title = url.searchParams.get('title') || '';

    if (!imdb_id) return Response.json({ error: 'imdb_id is required' }, { status: 400, headers: corsHeaders() });

    try {
        const vtt = await fetchSinhalaSubtitle(imdb_id, title);
        return new Response(vtt, {
            status: 200,
            headers: { 'Content-Type': 'text/vtt', 'Content-Disposition': `attachment; filename="Sinhala_${movie_id}.vtt"`, ...corsHeaders() }
        });
    } catch (e) {
        console.error('[ERROR]', e.message);
        return Response.json({ error: e.message }, { status: 500, headers: corsHeaders() });
    }
};

export const config = { path: '/api/translate-subtitle/:movie_id' };
