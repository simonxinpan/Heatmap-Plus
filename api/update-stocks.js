// /api/update-stocks.js (最终修正版)

import { Pool } from 'pg';

const UPDATE_BATCH_SIZE = 50; 
const FINNHUB_CONCURRENT_REQUESTS = 10;
const DELAY_BETWEEN_BATCHES = 1000;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

export default async function handler(request, response) {
    if (request.method !== 'GET') return response.status(405).json({ message: 'Method Not Allowed' });
    const { secret } = request.query;
    if (secret !== process.env.UPDATE_SECRET_KEY) return response.status(401).json({ message: 'Unauthorized' });
    
    console.log('--- [PG] Starting CORRECTED Stock Update ---');
    try {
        const stocksToProcess = await getStocksToUpdate();
        if (stocksToProcess.length === 0) {
            return response.status(200).json({ success: true, updated: 0, message: 'All stocks are up-to-date.' });
        }
        const fetchedStockData = await fetchBatchData(stocksToProcess);
        if (fetchedStockData.length > 0) {
            await upsertBatchData(fetchedStockData);
        }
        response.status(200).json({ success: true, updated: fetchedStockData.length });
    } catch (error) {
        console.error('[PG] Update Handler Error:', error.message, error.stack);
        response.status(500).json({ success: false, error: error.message });
    }
}

// === 逻辑修正：直接从 stock_list 找新股，或从 stocks 找旧股 ===
async function getStocksToUpdate() {
    // 1. 优先查找在 stock_list 中但不在 stocks 中的新股票
    const { rows: newStocks } = await pool.query(`
        SELECT ticker, name_zh, sector_zh 
        FROM stock_list
        WHERE ticker NOT IN (SELECT ticker FROM stocks)
        LIMIT ${UPDATE_BATCH_SIZE};
    `);
    if (newStocks.length > 0) {
        console.log(`Found ${newStocks.length} NEW stocks to insert.`);
        return newStocks; // 返回包含 ticker, name_zh, sector_zh 的对象数组
    }

    // 2. 如果没有新股票，则更新最久未更新的旧股票
    console.log('No new stocks found. Updating oldest entries in `stocks` table.');
    const { rows: stocksToUpdate } = await pool.query(`
        SELECT ticker, name_zh, sector_zh 
        FROM stocks
        ORDER BY last_updated ASC NULLS FIRST
        LIMIT ${UPDATE_BATCH_SIZE};
    `);
    console.log(`Found ${stocksToUpdate.length} oldest stocks to update.`);
    return stocksToUpdate;
}


// === fetchBatchData 和 fetchApiDataForTicker 保持不变，但很重要，我们保留它们 ===
async function fetchBatchData(stockInfos) {
    let allSuccessfulData = [];
    for (let i = 0; i < stockInfos.length; i += FINNHUB_CONCURRENT_REQUESTS) {
        const batch = stockInfos.slice(i, i + FINNHUB_CONCURRENT_REQUESTS);
        const promises = batch.map(info => fetchApiDataForTicker(info));
        const results = await Promise.allSettled(promises);
        allSuccessfulData = allSuccessfulData.concat(results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value));
        if (i + FINNHUB_CONCURRENT_REQUESTS < stockInfos.length) {
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
        }
    }
    console.log(`Successfully fetched data for ${allSuccessfulData.length} of ${stockInfos.length} stocks.`);
    return allSuccessfulData;
}

async function fetchApiDataForTicker(stockInfo) {
    const { ticker, name_zh, sector_zh } = stockInfo;
    try {
        const apiKey = process.env.FINNHUB_API_KEY;
        const fetchFromFinnhub = async (endpoint) => {
            const url = `https://finnhub.io/api/v1${endpoint}&token=${apiKey}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Finnhub API error for ${ticker}: ${res.statusText}`);
            return res.json();
        };
        const [profile, quote] = await Promise.all([
            fetchFromFinnhub(`/stock/profile2?symbol=${ticker}`),
            fetchFromFinnhub(`/quote?symbol=${ticker}`)
        ]);
        if (!quote || typeof quote.c === 'undefined' || !profile) return null;
        return {
            ticker, name_zh, sector_zh, 
            market_cap: parseFloat(profile.marketCapitalization) || 0, 
            change_percent: parseFloat(quote.dp) || 0,
            logo: profile.logo || '',
            last_updated: new Date().toISOString(),
        };
    } catch (error) {
        console.error(`[PG] Error fetching data for ${ticker}:`, error.message);
        return null;
    }
}

// === upsertBatchData 保持不变 ===
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