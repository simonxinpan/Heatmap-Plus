// /api/stocks.js (完整代码，带修复)

import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL, // 注意：我看到你的 update-stocks.js 里用的是 DATABASE_URL，请确保这里和那里用的是同一个环境变量名
  ssl: {
    rejectUnauthorized: false,
  },
});

export default async function handler(req, res) {
  // --- [核心修改点：增加缓存控制头] ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // **新增：告诉 Vercel 和浏览器不要缓存这个 API 响应**
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const query = `
      SELECT 
        ticker, 
        name_zh AS company, 
        sector_zh AS sector, 
        market_cap, 
        change_percent AS change_percentage 
      FROM 
        stocks;
    `; 

    const { rows } = await pool.query(query);
    res.status(200).json(rows);

  } catch (error) {
    console.error('Database Query Error:', error);
    res.status(500).json({ 
      message: 'Failed to fetch stock data from the database.',
      error: error.message 
    });
  }
}