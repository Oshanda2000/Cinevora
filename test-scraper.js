import axios from 'axios';
import * as cheerio from 'cheerio';

async function test() {
    try {
        console.log("Fetching IMDB ID: tt0111161");
        const res = await axios.get('https://yifysubtitles.org/movie-imdb/tt0111161', { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(res.data);
        
        const allLangs = [];
        $('.sub-lang').each((i, el) => {
            allLangs.push($(el).text().trim().toLowerCase());
        });
        console.log('Found langs:', allLangs.length, allLangs.slice(0, 5));
        
        // Find by looping
        let subPagePath = null;
        $('tbody tr').each((i, el) => {
            if (!subPagePath) {
                const lang = $(el).find('.sub-lang').text().trim().toLowerCase();
                if (lang === 'english') {
                    subPagePath = $(el).find('a[href^="/subtitles/"]').attr('href');
                }
            }
        });
        
        console.log('Sub Page Path:', subPagePath);
        
        const subPageRes = await axios.get('https://yifysubtitles.org' + subPagePath, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $$ = cheerio.load(subPageRes.data);
        
        console.log('Download Element HTML:', $$('.btn-icon.download-subtitle').parent().html());
        
    } catch(e) {
        console.error(e.message);
    }
}
test();
