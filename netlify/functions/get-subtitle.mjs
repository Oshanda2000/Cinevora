import axios from 'axios';
import AdmZip from 'adm-zip';

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

async function fetchEnglishVtt(imdb_id) {
    const SUBDL_KEY = process.env.SUBDL_KEY;
    const OS_KEY = process.env.OPENSUBS_KEY;

    if (SUBDL_KEY) {
        try {
            const r = await axios.get(
                `https://api.subdl.com/api/v1/subtitles?api_key=${SUBDL_KEY}&imdb_id=${imdb_id}&languages=EN&subs_per_page=5`,
                { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } }
            );
            if (r.data?.subtitles?.length > 0) {
                const zipRes = await axios.get(`https://dl.subdl.com${r.data.subtitles[0].url}`, { responseType: 'arraybuffer', timeout: 8000 });
                const zip = new AdmZip(Buffer.from(zipRes.data));
                const srt = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.srt'));
                if (srt) return srtToVtt(srt.getData().toString('utf8'));
            }
        } catch (e) { console.warn('[SUBDL-EN]', e.message); }
    }

    if (OS_KEY) {
        try {
            const tId = imdb_id.replace(/^tt/, '');
            const osR = await axios.get(
                `https://api.opensubtitles.com/api/v1/subtitles?imdb_id=${tId}&languages=en&order_by=download_count`,
                { headers: { 'Api-Key': OS_KEY, 'User-Agent': 'CinevraApp v1.0' }, timeout: 8000 }
            );
            if (osR.data?.data?.length > 0) {
                const dlR = await axios.post('https://api.opensubtitles.com/api/v1/download',
                    { file_id: osR.data.data[0].attributes.files[0].file_id },
                    { headers: { 'Api-Key': OS_KEY, 'Content-Type': 'application/json', 'User-Agent': 'CinevraApp v1.0' }, timeout: 8000 }
                );
                const srtR = await axios.get(dlR.data.link, { responseType: 'text', timeout: 8000 });
                return srtToVtt(srtR.data);
            }
        } catch (e) { console.warn('[OPENSUBS-EN]', e.message); }
    }

    throw new Error('No English subtitles found. Set SUBDL_KEY or OPENSUBS_KEY in Netlify environment variables.');
}

export default async (req, context) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

    const url = new URL(req.url);
    const imdb_id = url.searchParams.get('imdb_id');

    if (!imdb_id) return Response.json({ error: 'imdb_id is required' }, { status: 400, headers: corsHeaders() });

    try {
        const vtt = await fetchEnglishVtt(imdb_id);
        return new Response(vtt, {
            status: 200,
            headers: { 'Content-Type': 'text/vtt', ...corsHeaders() }
        });
    } catch (e) {
        return Response.json({ error: e.message }, { status: 500, headers: corsHeaders() });
    }
};

export const config = { path: '/api/subtitles/:movie_id' };
