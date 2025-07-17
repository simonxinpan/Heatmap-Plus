document.addEventListener('DOMContentLoaded', router);
window.addEventListener('hashchange', router);

function router() {
    const mainContent = document.getElementById('app-container');
    if (!mainContent) {
        console.error("致命错误: 无法在 HTML 中找到 id='app-container' 的元素。");
        return;
    }
    mainContent.innerHTML = '';

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
        const stocks = await response.json();
        console.log("步骤 4: 已成功解析 JSON，获取到股票数据:", stocks);

        if (!Array.isArray(stocks)) {
            throw new Error('API 返回的数据不是一个有效的数组。');
        }
        
        console.log(`步骤 5: 成功验证 ${stocks.length} 条股票数据。`);
        
        console.log("步骤 6: 正在处理和转换股票数据（增加对无效数据的防御）...");
        // 【关键修复】进行防御性数据处理，确保 value 和 change 始终是有效数字
        const processedStocks = stocks.map(stock => {
            const marketCap = parseFloat(stock.market_cap);
            const changePercent = parseFloat(stock.change_percent);

            return {
                name: stock.ticker,
                value: isNaN(marketCap) ? 0 : marketCap, // 如果市值无效，则设为0
                change: isNaN(changePercent) ? 0 : changePercent, // 如果涨跌幅无效，则设为0
                sector: stock.sector_zh || '未知板块', // 如果板块为空，则设为'未知板块'
                logo: stock.logo,
                name_zh: stock.name_zh
            };
        });

        console.log("步骤 7: 正在按板块组织数据...");
        const sectors = {};
        processedStocks.forEach(stock => {
            if (!sectors[stock.sector]) {
                sectors[stock.sector] = { name: stock.sector, children: [] };
            }
            // 只有市值大于0的股票才被添加到图表中
            if (stock.value > 0) {
                sectors[stock.sector].children.push(stock);
            }
        });

        const treemapData = { name: 'S&P 500', children: Object.values(sectors) };
        console.log("步骤 8: Treemap 数据结构已准备好，准备调用渲染函数。", treemapData);

        loadingDiv.style.display = 'none';
        
        // 增加对 renderTreemap 的独立错误捕获
        try {
            renderTreemap(treemapData);
            console.log("步骤 10: [成功] 热力图渲染函数执行完毕。");
        } catch (renderError) {
            console.error("步骤 9.1: [致命] renderTreemap 函数内部发生错误!", renderError);
            throw renderError; // 将错误重新抛出，以便外层 catch 捕获并显示模拟数据
        }

    } catch (error) {
        console.error('主页渲染过程中发生严重错误:', error);
        loadingDiv.innerText = `加载失败: ${error.message}。正在显示模拟数据。`;
        
        const mockStocks = generateMockData(500);
        const sectors = {};
        mockStocks.forEach(stock => {
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
    console.log("步骤 9: 已进入 renderTreemap 函数。");
    const container = document.getElementById('heatmap-container');
    if (!container) {
        console.error("renderTreemap 错误: 找不到 id='heatmap-container' 的元素。");
        return;
    }
    container.innerHTML = '';

    const width = container.clientWidth;
    const height = container.clientHeight || window.innerHeight * 0.9;

    const treemap = d3.treemap().size([width, height]).padding(2).round(true);

    const root = d3.hierarchy(data)
        .sum(d => d.value) // 在数据处理阶段已确保 d.value 是有效数字
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
            if (area < 500) return [];
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