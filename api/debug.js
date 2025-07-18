// /api/debug.js

import { Pool } from 'pg';

// 使用和你的 api/stocks.js 完全一样的连接配置
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL, // 请确认这个环境变量名是正确的
  ssl: {
    rejectUnauthorized: false,
  },
});

export default async function handler(req, res) {
  // 设置CORS和缓存头，确保我们看到最新数据
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  try {
    console.log('[DEBUG] API called. Attempting to fetch ONE stock from database...');

    // 只从数据库中查询一条记录，并选择所有字段
    const query = `
      SELECT 
        * 
      FROM 
        stocks 
      LIMIT 1;
    `;

    const { rows } = await pool.query(query);

    if (rows.length > 0) {
      console.log('[DEBUG] Successfully fetched one stock:', rows[0]);
      // 将这一条完整的数据返回给浏览器
      res.status(200).json({
        message: "Successfully fetched ONE stock for debugging.",
        stock_data: rows[0]
      });
    } else {
      console.log('[DEBUG] The stocks table is empty or query failed to return rows.');
      res.status(404).json({ message: "The 'stocks' table appears to be empty." });
    }

  } catch (error) {
    console.error('[DEBUG] API Error:', error);
    res.status(500).json({ 
      message: 'An error occurred in the debug API.',
      error_details: {
        name: error.name,
        message: error.message,
        stack: error.stack
      }
    });
  }
}