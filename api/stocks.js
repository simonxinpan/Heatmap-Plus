// /api/stocks.js

// 引入 'pg' 库中的 Pool，用于管理数据库连接
import { Pool } from 'pg';

// 创建一个新的数据库连接池实例。
// Vercel 会自动从项目设置的环境变量中读取 POSTGRES_URL。
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: {
    // 对于 Neon.tech 和其他云数据库服务，通常需要此设置以允许连接
    rejectUnauthorized: false, 
  },
});

// 这是 Vercel Serverless Function 的主处理函数
export default async function handler(req, res) {
  // 设置 CORS 头，允许任何来源访问此 API。
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // 处理浏览器的 OPTIONS 预检请求
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // 此 API 只应响应 GET 请求
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    // --- [核心调整] ---
    // 根据你提供的数据库截图，我们使用 AS 关键字重命名列，以匹配前端的需求。
    // name_zh        -> company
    // sector_zh      -> sector
    // change_percent -> change_percentage
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
    // !!! 注意: 上面的 `FROM stocks` 假设你的表名是 'stocks'，如果不是请修改。

    // 使用连接池执行查询
    const { rows } = await pool.query(query);

    // 查询成功，将结果以 JSON 格式返回。
    // 返回的数据结构现在是 [{ ticker: "AAPL", company: "苹果公司", ... }]，前端可以直接使用。
    res.status(200).json(rows);

  } catch (error) {
    // 如果数据库连接或查询过程中发生任何错误
    console.error('Database Query Error:', error); // 在 Vercel 的 Logs 中可以看到这个错误日志

    // 向前端返回一个 500 服务器内部错误
    res.status(500).json({ 
      message: 'Failed to fetch stock data from the database.',
      error: error.message 
    });
  }
}