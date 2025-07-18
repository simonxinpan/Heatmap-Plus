// /api/update-stocks.js

import { Pool } from 'pg';

// --- 配置项 ---
// 每次更新的股票数量。你的代码是50，这是一个很好的值。
const UPDATE_BATCH_SIZE = 50; 

// --- 数据库连接 ---
// 使用 Vercel 的环境变量进行连接
const pool = new Pool({
    connectionString: process.env.DATABASE_URL, // 确保这个环境变量在 Vercel 中已设置
    ssl: {
        rejectUnauthorized: false
    }
});

// ===================================================================
// ==================== 主处理函数 (Handler) =======================
// ===================================================================
export default async function handler(request, response) {
    // --- [1. 安全检查] ---
    // 只允许 GET 请求
    if (request.method !== 'GET') {
        return response.status(405).json({ message: 'Method Not Allowed' });
    }
    
    // 检查URL中是否包含正确的 "密码" (secret key)
    const { secret } = request.query;
    if (secret !== process.env.UPDATE_SECRET_KEY) { // 从Vercel环境变量读取正确的密码
        return response.status(401).json({ message: 'Unauthorized: A valid secret key is required.' });
    }

    console.log('--- [PG] Starting Manual Stock Update via Secret Key ---');

    try {
        // --- [2. 获取需要更新的股票列表] ---
        const tickersToProcess = await getTickersToUpdate(pool);
        
        if (tickersToProcess.length === 0) {
            const message = 'All stocks seem to be up-to-date. No new stocks to fetch.';
            console.log(message);
            return response.status(200).json({ success: true, updated: 0, message: message });
        }

        // --- [3. 从 Finnhub 获取数据] ---
        const fetchedStockData = await fetchBatchData(tickersToProcess);
        
        // --- [4. 将新数据写入数据库] ---
        if (fetchedStockData.length > 0) {
            await upsertBatchData(pool, fetchedStockData);
        }

        const successMessage = `Update finished. Processed ${fetchedStockData.length} stocks.`;
        console.log(`--- [PG] ${successMessage} ---`);
        response.status(200).json({ 
            success: true, 
            updated: fetchedStockData.length, 
            tickers: fetchedStockData.map(s => s.ticker) 
        });

    } catch (error) {
        console.error('[PG] Update Handler Error:', error.message, error.stack);
        response.status(500).json({ success: false, error: error.message });
    }
}


// ===================================================================
// ==================== 辅助函数 (保持不变) ======================
// ===================================================================

/**
 * 决定本次需要更新哪些股票。
 * 优先插入数据库中没有的新股票，如果没有新股票，则更新最久未更新的股票。
 */
async function getTickersToUpdate(pool) {
    // 从你的"主列表"获取所有股票的基本信息
    const { rows: allStockInfo } = await pool.query('SELECT ticker, name_zh, sector_zh FROM stock_list');
    if (!allStockInfo || allStockInfo.length === 0) {
        throw new Error('Failed to load stock list from "stock_list" table.');
    }
    console.log(`Loaded ${allStockInfo.length} stocks from the master list.`);
    
    // 查找在 'stock_list' 中存在，但在 'stocks' 数据表中不存在的新股票
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
        // 返回包含完整信息的对象数组
        return tickers.map(ticker => allStockInfo.find(info => info.ticker === ticker)).filter(Boolean);
    }
    
    // 如果没有新股票，则查找最久未更新的股票
    console.log(`All stocks are populated. Switching to update oldest entries.`);
    const { rows: stocksToUpdate } = await pool.query(`
        SELECT ticker FROM stocks
        ORDER BY last_updated ASC
        LIMIT ${UPDATE_BATCH_SIZE}
    `);
    
    const tickers = stocksToUpdate.map(s => s.ticker);
    console.log(`Found ${tickers.length} oldest stocks to update.`);
    // 返回包含完整信息的对象数组
    return tickers.map(ticker => allStockInfo.find(info => info.ticker === ticker)).filter(Boolean);
}

/**
 * 并发地为一批股票从 Finnhub 获取数据。
 */
async function fetchBatchData(stockInfos) {
    const promises = stockInfos.map(info => fetchApiDataForTicker(info));
    const results = await Promise.allSettled(promises);
    const successfulData = results
        .filter(result => result.status === 'fulfilled' && result.value)
        .map(result => result.value);
    console.log(`Successfully fetched data for ${successfulData.length} of ${stockInfos.length} stocks.`);
    return successfulData;
}

/**
 * 为单个股票获取市值(profile)和行情(quote)数据。
 */
async function fetchApiDataForTicker(stockInfo) {
    if (!stockInfo || !stockInfo.ticker) return null;
    const { ticker, name_zh, sector_zh } = stockInfo;
    try {
        const apiKey = process.env.FINNHUB_API_KEY;
        if (!apiKey) throw new Error('FINNHUB_API_KEY is not configured in environment variables.');
        
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
            console.warn(`[WARN] Invalid or incomplete API data for ${ticker}, skipping.`);
            return null;
        }

        return {
            ticker, 
            name_zh, 
            sector_zh, 
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

/**
 * 使用 "INSERT ... ON CONFLICT DO UPDATE" (UPSERT) 语句批量更新数据。
 * 这是原子操作，能保证数据一致性。
 */
async function upsertBatchData(pool, stockData) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        for (const stock of stockData) {
            const query = `
                INSERT INTO stocks (ticker, name_zh, sector_zh, market_cap, change_percent, logo, last_updated)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (ticker) DO UPDATE SET
                    name_zh = EXCLUDED.name_zh,
                    sector_zh = EXCLUDED.sector_zh,
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
        console.log(`Successfully upserted ${stockData.length} stocks into Neon DB.`);
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('[PG] Database upsert transaction failed. Rolling back.', e.message);
        throw e;
    } finally {
        client.release();
    }
}