import { Pool } from 'pg';

const UPDATE_BATCH_SIZE = 50; 

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

export default async function handler(request, response) {
    if (request.method !== 'GET') {
        return response.status(405).json({ message: 'Method Not Allowed' });
    }
    
    console.log('--- [PG] Starting FLAWLESS ACCUMULATIVE Stock Update ---');

    try {
        const tickersToProcess = await getTickersToUpdate(pool);
        
        if (tickersToProcess.length === 0) {
            console.log('All stocks seem to be up-to-date. No new stocks to fetch.');
            return response.status(200).json({ success: true, updated: 0, message: 'All stocks are populated and up-to-date.' });
        }

        const fetchedStockData = await fetchBatchData(tickersToProcess);
        
        if (fetchedStockData.length > 0) {
            await upsertBatchData(pool, fetchedStockData);
        }

        console.log(`--- [PG] Flawless Update finished. Processed ${fetchedStockData.length} stocks. ---`);
        response.status(200).json({ success: true, updated: fetchedStockData.length, tickers: fetchedStockData.map(s => s.ticker) });

    } catch (error) {
        console.error('[PG] Flawless Update Handler Error:', error.message, error.stack);
        response.status(500).json({ success: false, error: error.message });
    }
}


async function getTickersToUpdate(pool) {
    const { rows: allStockInfo } = await pool.query('SELECT ticker, name_zh, sector_zh FROM stock_list');
    if (!allStockInfo || allStockInfo.length === 0) {
        throw new Error('Failed to load stock list from "stock_list" table.');
    }
    console.log(`Loaded ${allStockInfo.length} stocks from the master list.`);
    
    const { rows: newStocks } = await pool.query(`
        SELECT t1.ticker 
        FROM stock_list AS t1
        LEFT JOIN stocks AS t2 ON t1.ticker = t2.ticker
        WHERE t2.ticker IS NULL
        LIMIT ${UPDATE_BATCH_SIZE}
    `);

    if (newStocks && newStocks.length > 0) {
        const tickers = newStocks.map(s => s.ticker);
        console.log(`Found ${tickers.length} NEW stocks to insert.`);
        return tickers.map(ticker => allStockInfo.find(info => info.ticker === ticker)).filter(Boolean);
    }
    
    console.log(`All stocks are populated. Switching to update oldest entries.`);
    const { rows: stocksToUpdate } = await pool.query(`
        SELECT ticker FROM stocks
        ORDER BY last_updated ASC
        LIMIT ${UPDATE_BATCH_SIZE}
    `);
    
    const tickers = stocksToUpdate.map(s => s.ticker);
    console.log(`Found ${tickers.length} oldest stocks to update.`);
    return tickers.map(ticker => allStockInfo.find(info => info.ticker === ticker)).filter(Boolean);
}

async function fetchBatchData(stockInfos) {
    const promises = stockInfos.map(info => fetchApiDataForTicker(info));
    const results = await Promise.allSettled(promises);
    const successfulData = results
        .filter(result => result.status === 'fulfilled' && result.value)
        .map(result => result.value);
    console.log(`Successfully fetched data for ${successfulData.length} of ${stockInfos.length} stocks.`);
    return successfulData;
}
async function fetchApiDataForTicker(stockInfo) {
    if (!stockInfo || !stockInfo.ticker) return null;
    const { ticker, name_zh, sector_zh } = stockInfo;
    try {
        const apiKey = process.env.FINNHUB_API_KEY;
        if (!apiKey) throw new Error('FINNHUB_API_KEY is not configured.');
        const fetchFromFinnhub = async (endpoint) => {
            const url = `https://finnhub.io/api/v1${endpoint}&token=${apiKey}`;
            const res = await fetch(url);
            if (!res.ok) {
                 if (res.status === 429) { console.warn(`[WARN] Rate limit hit for ${ticker}, skipping.`); return null; }
                throw new Error(`Finnhub API error for ${ticker}: ${res.statusText}`);
            }
            return res.json();
        };
        const [profile, quote] = await Promise.all([
            fetchFromFinnhub(`/stock/profile2?symbol=${ticker}`),
            fetchFromFinnhub(`/quote?symbol=${ticker}`)
        ]);
        if (!quote || typeof quote.c === 'undefined' || !profile) {
            console.warn(`[WARN] Invalid API data for ${ticker}, skipping.`);
            return null;
        }
        return {
            ticker, name_zh, sector_zh, 
            market_cap: profile.marketCapitalization || 0, 
            change_percent: quote.dp || 0,
            logo: profile.logo || '',
            last_updated: new Date().toISOString(),
        };
    } catch (error) {
        console.error(`[PG] Error fetching data for ${ticker}:`, error.message);
        return null;
    }
}

// ===================================================================
// ================== 这是我们最核心的逻辑修改 ==================
// ===================================================================
async function upsertBatchData(pool, stockData) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        for (const stock of stockData) {
            // 在这里，我们修改了 ON CONFLICT 的部分
            const query = `
                INSERT INTO stocks (ticker, name_zh, sector_zh, market_cap, change_percent, logo, last_updated)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (ticker) DO UPDATE SET
                    name_zh = EXCLUDED.name_zh,         -- 确保更新时也更新中文名
                    sector_zh = EXCLUDED.sector_zh,   -- 确保更新时也更新行业
                    market_cap = EXCLUDED.market_cap,
                    change_percent = EXCLUDED.change_percent,
                    logo = EXCLUDED.logo,
                    last_updated = EXCLUDED.last_updated;
            `;
            await client.query(query, [
                stock.ticker, stock.name_zh, stock.sector_zh, stock.market_cap, 
                stock.change_percent, stock.logo, stock.last_updated
            ]);
        }
        
        await client.query('COMMIT');
        console.log(`Successfully upserted ${stockData.length} stocks into Neon DB with FLAWLESS logic.`);
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('[PG] Database upsert transaction failed. Rolling back.', e.message);
        throw e;
    } finally {
        client.release();
    }
}