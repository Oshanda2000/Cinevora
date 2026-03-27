async function test() {
    const mid = '671'; // Avatar (2009) TMDB ID
    const imdb = 'tt0499549';
    const title = 'Avatar';
    const url = `http://localhost:3000/api/translate-subtitle/${mid}?imdb_id=${imdb}&title=${encodeURIComponent(title)}`;
    
    console.log(`Calling API: ${url}`);
    try {
        const res = await fetch(url);
        console.log(`Status: ${res.status}`);
        const data = await res.json();
        console.log(`Response Data:`, JSON.stringify(data, null, 2).substring(0, 500) + '...');
    } catch (e) {
        console.error(`Fetch Error: ${e.message}`);
    }
}

test();
