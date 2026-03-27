import baiscopelk from 'baiscopelk-api';
import axios from 'axios';
const { baiscopelksearch, baiscopelkdownload } = baiscopelk;

// Mock axios since the API uses it internally but we might want to set defaults
axios.defaults.headers.common['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

async function test() {
    try {
        console.log("Searching for 'Avatar' on BaiscopeLK...");
        const results = await baiscopelksearch('Avatar');
        console.log("Search Results:", JSON.stringify(results, null, 2));
        
        if (results && results.results && results.results.length > 0) {
            const first = results.results[0];
            console.log("Downloading from URL:", first.url);
            const dl = await baiscopelkdownload(first.url);
            console.log("Download Info:", JSON.stringify(dl, null, 2));
        } else {
            console.log("No results found.");
        }
    } catch (e) {
        console.error("Test Error:", e);
    }
}

test();
