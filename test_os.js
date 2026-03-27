import axios from 'axios';

const osKey = 'TScQLAKt63ng8utkbhOS4Kh9cPTSAtcO';
const userAgent = 'Cinevora v1.0.0';

async function testOS() {
    try {
        console.log("Searching on OpenSubtitles for 'Avatar' (tt0499549)...");
        const res = await axios.get('https://api.opensubtitles.com/api/v1/subtitles?imdb_id=0499549&languages=en&order_by=download_count', {
            headers: {
                'Api-Key': osKey,
                'User-Agent': userAgent
            }
        });
        console.log("Status:", res.status);
        console.log("Results found:", res.data?.data?.length || 0);
        if (res.data?.data?.length > 0) {
            console.log("First Result:", JSON.stringify(res.data.data[0].attributes, null, 2));
        }
    } catch (e) {
        console.error("OS Error:", e.response ? e.response.status : e.message);
        if (e.response?.data) console.error("Error Detail:", JSON.stringify(e.response.data, null, 2));
    }
}

testOS();
