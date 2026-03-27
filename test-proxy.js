import axios from 'axios';

async function testProxy() {
    const testQueries = ['tt1375666', 'Inception'];
    const backend = 'http://localhost:3000';
    
    console.log("--- STARTING PROXY QA TEST ---");
    
    for (const query of testQueries) {
        console.log(`\n[TEST] Query: ${query}`);
        try {
            const res = await axios.get(`${backend}/api/yts-proxy?query=${query}`);
            console.log(`[PASS] Response: ${res.data.status}`);
            if (res.data.data.movies) {
                console.log(`[INFO] Found ${res.data.data.movies.length} movies`);
                console.log(`[INFO] First title: ${res.data.data.movies[0].title}`);
                console.log(`[INFO] Torrent qualities: ${res.data.data.movies[0].torrents.map(t => t.quality).join(', ')}`);
            } else {
                console.log(`[WARN] No movies found in response`);
            }
        } catch (e) {
            console.error(`[FAIL] ${e.message}`);
            if (e.response) {
                console.error(`[ERROR DATA]`, e.response.data);
            }
        }
    }
    console.log("\n--- TEST COMPLETE ---");
}

testProxy();
