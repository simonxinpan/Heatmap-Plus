document.addEventListener('DOMContentLoaded', router);
window.addEventListener('hashchange', router);

function router() {
    // 使用 'app-container' 作为主内容区域
    const mainContent = document.getElementById('app-container');
    if (!mainContent) {
        console.error("致命错误: 无法在 HTML 中找到 id='app-container' 的元素。");
        return;
    }
    mainContent.innerHTML = ''; // 清空之前的内容

    const path = window.location.hash.substring(1) || '/';

    if (path === '/') {
        renderHomePage();
    } else if (path.startsWith('/stock/')) {
        const ticker = path.split('/')[2];
        renderStockDetailPage(ticker);
    } else {
        mainContent.innerHTML = '<h1>404 - 页面未找到</h1>';
    }
}

async function renderHomePage() {
    console.log("开始渲染主页...");
    const mainContent = document.getElementById('app-container');
    mainContent.innerHTML = '<div id="heatmap-container"></div><div id="loading">加载数据中...</div>';
    
    const loadingDiv = document.getElementById('loading');
    loadingDiv.style.display = 'block';

    try {
        console.log("步骤 1: 正在从 /api/stocks 获取数据...");
        const response = await fetch('/api/stocks');
        console.log("步骤 2: API 响应已收到，状态码:", response.status);

        if (!response.ok) {
            throw new Error(`获取市场数据失败，服务器返回状态: ${response.status}`);
        }

        console.log("步骤 3: 正在将响应解析为 JSON...");
        const data = await response.json();
        console.log("步骤 4: 已成功解析 JSON，这是从 API 获取的原始数据:", data);

        const stocks = data.stocks;

        if (!stocks || !Array.isArray(stocks)) {
            throw new Error('API 返回的数据格式不正确，缺少 "stocks" 数组。');
        }
        
        console.log(`步骤 5: 成功提取到 ${stocks.length} 条股票数据，准备渲染热力图。`);

        const processedStocks = stocks.map(stock => ({
            name: stock.ticker,
            value: parseFloat(stock.market_cap),
            change: parseFloat(stock.change_percent),
            sector: stock.sector_zh,
            logo: stock.logo,
            name_zh: stock.name_zh
        }));

        const sectors = {};
        processedStocks.forEach(stock => {
            if (!sectors[stock.sector]) {
                sectors[stock.sector] = { name: stock.sector, children: [] };
            }
            sectors[stock.sector].children.push(stock);
        });

        const treemapData = { name: 'S&P 500', children: Object.values(sectors) };

        loadingDiv.style.display = 'none';
        renderTreemap(treemapData);

    } catch (error) {
        console.error('主页渲染过程中发生严重错误:', error);
        loadingDiv.innerText = `加载失败: ${error.message}。正在显示模拟数据。`;
        
        const stocks = generateMockData(500);
        const sectors = {};
        stocks.forEach(stock => {
            if (!sectors[stock.sector]) {
                sectors[stock.sector] = { name: stock.sector, children: [] };
            }
            sectors[stock.sector].children.push(stock);
        });
        const treemapData = { name: 'S&P 500 (模拟数据)', children: Object.values(sectors) };
        renderTreemap(treemapData);
    }
}

function renderTreemap(data) {
    const container = document.getElementById('heatmap-container');
    if (!container) return; // 如果容器不存在则退出
    container.innerHTML = '';

    const width = container.clientWidth;
    const height = container.clientHeight || window.innerHeight * 0.9;

    const treemap = d3.treemap().size([width, height]).padding(2).round(true);

    const root = d3.hierarchy(data)
        .sum(d => d.value > 0 ? d.value : 0) // 确保市值大于0
        .sort((a, b) => b.height - a.height || b.value - a.value);

    treemap(root);

    const color = d3.scaleLinear()
        .domain([-3, 0, 3])
        .range(['#2ECC71', '#F0F0F0', '#E74C3C'])
        .interpolate(d3.interpolateRgb);

    const svg = d3.select(container).append('svg')
        .attr('viewBox', `0 0 ${width} ${height}`)
        .style('font', '12px sans-serif');

    const leaf = svg.selectAll('g')
        .data(root.leaves())
        .join('g')
        .attr('transform', d => `translate(${d.x0},${d.y0})`);

    leaf.append('title')
        .text(d => `${d.data.name_zh} (${d.data.name})\n市值: ${(d.data.value / 1e6).toFixed(2)}B\n涨跌幅: ${d.data.change.toFixed(2)}%`);

    leaf.append('rect')
        .attr('id', d => `leaf-${d.data.name}`)
        .attr('fill', d => color(d.data.change))
        .attr('width', d => d.x1 - d.x0)
        .attr('height', d => d.y1 - d.y0);

    leaf.append('clipPath')
        .attr('id', d => `clip-${d.data.name}`)
        .append('rect')
        .attr('width', d => d.x1 - d.x0)
        .attr('height', d => d.y1 - d.y0);

    const text = leaf.append('text')
        .attr('clip-path', d => `url(#clip-${d.data.name})`)
        .selectAll('tspan')
        .data(d => {
            const area = (d.x1 - d.x0) * (d.y1 - d.y0);
            if (area < 500) return []; // 如果面积太小，则不显示文字
            return [d.data.name, `${d.data.change.toFixed(2)}%`];
        })
        .join('tspan')
        .attr('x', 5)
        .attr('y', (d, i) => 15 + i * 12)
        .attr('fill', 'white')
        .attr('fill-opacity', 0.9)
        .style('text-shadow', '1px 1px 2px rgba(0,0,0,0.7)')
        .text(d => d);
}

function generateMockData(count) {
    console.warn("警告: 正在生成并使用模拟数据！");
    const sectors = ['技术', '医疗', '金融', '消费', '工业', '能源', '房地产'];
    const stocks = [];
    for (let i = 0; i < count; i++) {
        stocks.push({
            name: `STOCK${i}`,
            value: 1000,
            change: 0,
            sector: sectors[i % sectors.length],
            logo: '',
            name_zh: `模拟股票${i}`
        });
    }
    return stocks;
}

function renderStockDetailPage(ticker) {
    const mainContent = document.getElementById('app-container');
    mainContent.innerHTML = `<h1>股票详情: ${ticker}</h1><p>此页面功能正在开发中...</p>`;
}