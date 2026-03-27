import axios from 'axios';

export const handler = async (event) => {
    const { query } = event.queryStringParameters;
    if (!query) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Query parameter required' })
        };
    }

    const domains = ['yts.mx', 'yts.bz', 'yts.li', 'yts.pm', 'yts.rs'];
    let lastError = null;

    for (const domain of domains) {
        try {
            const url = `https://${domain}/api/v2/list_movies.json?query_term=${encodeURIComponent(query)}&limit=1&sort_by=seeds`;
            const response = await axios.get(url, { timeout: 5000 });
            
            if (response.data && response.data.status === 'ok') {
                return {
                    statusCode: 200,
                    headers: { 
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    },
                    body: JSON.stringify(response.data)
                };
            }
        } catch (e) {
            lastError = e.message;
        }
    }

    return {
        statusCode: 502,
        body: JSON.stringify({ error: 'All YTS mirrors failed', details: lastError })
    };
};
