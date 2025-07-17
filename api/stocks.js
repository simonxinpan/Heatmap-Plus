// 引入 vercel/postgres 的数据库客户端
const { db } = require('@vercel/postgres');

module.exports = async (req, res) => {
  let client;
  try {
    // 连接到数据库
    client = await db.connect();
    
    // 这是唯一的修改：从 "stocks" 表中查询所有数据，并按市值（market_cap）降序（DESC）排列
    const { rows } = await client.sql`SELECT * FROM stocks ORDER BY market_cap DESC;`;
    
    // 设置响应头，允许跨域请求
    res.setHeader('Access-Control-Allow-Origin', '*');
    // 以 JSON 格式返回查询到的数据
    res.status(200).json(rows);
    
  } catch (error) {
    // 如果发生错误，返回 500 状态码和错误信息
    res.status(500).json({ error: error.message });
  } finally {
    // 无论成功或失败，最后都释放数据库连接
    if (client) {
      await client.release();
    }
  }
};