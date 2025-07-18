// /api/update-stocks.js (最终的、最稳健的版本)

import { Pool } from 'pg';

const UPDATE_BATCH_SIZE = 50; 

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

export default async function handler(request, response) {
    if (request.method !== 'GET') return response.status(405).json({ message: 'Method Not Allowed' });
    const { secret } = request.query;
    if (secret !== process.env.UPDATE_SECRET_KEY) return response.status(401).json({ message: 'Unauthorized' });
    
    console.log('--- [PG] Starting ROBUST Stock Update (Serial Mode) ---');
    try {
        const stocksToProcess = await getStocksToUpdate();
        if (stocksToProcess.length === 0) {
            return response.status(200).json({ success: true, updated: 0, message: 'All stocks are up-to-date.' });
        }
        // 使用新的、稳健的串行获取函数
        const fetchedStockData = await fetchBatchDataSerially(stocksToProcess);
        if (fetchedStockData.length > 0) {
            await upsertBatchData(fetchedStockData);
        }
        response.status(200).json({ success: true, updated: fetchedStockData.length });
    } catch (error) {
        console.error('[PG] Update Handler Error:', error.message, error.stack);
        response.status(500).json({ success: false, error: error.message });
    }
}


// ==================== 辅助函数 ======================

async function getStocksToUpdate() {
    const { rows: newStocks } = await pool.query(`
        SELECT ticker, name_zh, sector_zh 
        FROM stock_list
        WHERE ticker NOT IN (SELECT ticker FROM stocks)
        LIMIT ${UPDATE_BATCH_SIZE};
    `);
    if (newStocks.length > 0) {
        console.log(`Found ${newStocks.length} NEW stocks to insert.`);
        return newStocks;
    }
    console.log('No new stocks found. Updating oldest entries in "stocks" table.');
    const { rows: stocksToUpdate } = await pool.query(`
        SELECT ticker, name_zh, sector_zh 
        FROM stocks
        ORDER BY last_updated ASC NULLS FIRST
        LIMIT ${UPDATE_BATCH_SIZE};
    `);
    console.log(`Found ${stocksToUpdate.length} oldest stocks to update.`);
    return stocksToUpdate;
}

// === 这是被重写为串行模式的核心函数 ===
async function fetchBatchDataSerially(stockInfos) {
    const allSuccessfulData = [];
    console.log(`Starting to fetch data for ${stockInfos.length} stocks SERIALLY to guarantee success.`);

    for (const info of stockInfos) {
        try {
            // 一次只处理一个股票，等待它完成后再进行下一个
            const stockData = await fetchApiDataForTicker(info);
            if (stockData) {
                allSuccessfulData.push(stockData);
                console.log(`[SUCCESS] Fetched data for ${info.ticker}`);
            }
            // 在每个股票处理后加入一个微小的延迟，更加保险
            await new Promise(resolve => setTimeout(resolve, 200)); // 200毫秒延迟
        } catch (error) {
            console.error(`[FAILURE] Could not process ${info.ticker}: ${error.message}`);
        }
    }
    
    console.log(`Finished serial fetching. Successfully got data for ${allSuccessfulData.length} of ${stockInfos.length} stocks.`);
    return allSuccessfulData;
}


async function fetchApiDataForTicker(stockInfo) {
    const { ticker, name_zh, sector_zh } = stockInfo;
    const apiKey = process.env.FINNHUB_API_KEY;

    const fetchFromFinnhub = async (endpoint) => {
        const url = `https://finnhub.io/api/v1${endpoint}&token=${apiKey}`;
        const res = await fetch(url);
        // 如果请求不成功，直接抛出错误，由上层捕获
        if (!res.ok) {
            throw new Error(`Finnhub API error for ${ticker} on endpoint ${endpoint}: ${res.status} ${res.statusText}`);
        }
        return res.json();
    };

    // 分开 await，如果第一个失败，就不会再请求第二个
    const profile = await fetchFromFinnhub(`/stock/profile2?symbol=${ticker}`);
    const quote = await fetchFromFinnhub(`/quote?symbol=${ticker}`);

    if (!quote || typeof quote.c === 'undefined' || !profile) {
        console.warn(`[WARN] Invalid or incomplete API data for ${ticker}, skipping.`);
        return null;
    }
    
    return {
        ticker, name_zh, sector_zh, 
        market_cap: parseFloat(profile.marketCapitalization) || 0, 
        change_percent: parseFloat(quote.dp) || 0,
        logo: profile.logo || '',
        last_updated: new Date().toISOString(),
    };
}


async function upsertBatchData(stockData) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const stock of stockData) {
            const query = `
                INSERT INTO stocks (ticker, name_zh, sector_zh, market_cap, change_percent, logo, last_updated)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (ticker) DO UPDATE SET
                    name_zh = EXCLUDED.name_zh, sector_zh = EXCLUDED.sector_zh,
                    market_cap = EXCLUDED.market_cap, change_percent = EXCLUDED.change_percent,
                    logo = EXCLUDED.logo, last_updated = EXCLUDED.last_updated;
            `;
            await client.query(query, [stock.ticker, stock.name_zh, stock.sector_zh, stock.market_cap, stock.change_percent, stock.logo, stock.last_updated]);
        }
        await client.query('COMMIT');
        console.log(`Successfully upserted ${stockData.length} stocks.`);
    } catch (e) {
        await client.query('ROLLBACK'); throw e;
    } finally {
        client.release();
    }
}