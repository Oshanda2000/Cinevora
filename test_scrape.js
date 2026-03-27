import axios from 'axios';
import * as cheerio from 'cheerio';

async function testScrape() {
    try {
        console.log("Scraping baiscopelk.com directly...");
        const response = await axios.get('https://baiscopelk.com/?s=Avatar', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        console.log("Status:", response.status);
        const $ = cheerio.load(response.data);
        const titles = [];
        $('.post-title a').each((i, el) => {
            titles.push($(el).text().trim());
        });
        console.log("Titles found:", titles);
    } catch (e) {
        console.error("Scrape Error:", e.message);
    }
}

testScrape();
