document.addEventListener('DOMContentLoaded', router);
window.addEventListener('hashchange', router);

function router() {
    const mainContent = document.getElementById('app-container');
    if (!mainContent) {
        console.error("Fatal Error: Cannot find element with id='app-container' in HTML.");
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
        mainContent.innerHTML = '<h1>404 - Page Not Found</h1>';
    }
}

async function renderHomePage() {
    console.log("Rendering Homepage...");
    const mainContent = document.getElementById('app-container');
    mainContent.innerHTML = '<div id="heatmap-container"><div id="loading">Loading Real Market Data...</div></div>';
    
    try {
        const response = await fetch('/api/stocks');
        if (!response.ok) {
            throw new Error(`Server responded with status: ${response.status}`);
        }
        const stocks = await response.json();

        if (!Array.isArray(stocks)) {
            throw new Error('API did not return a valid array.');
        }
        console.log(`Successfully fetched ${stocks.length} stocks.`);

        // --- 开始法医级诊断 ---
        console.log("DIAGNOSTIC: Step A - Starting data processing (map)...");
        const processedStocks = stocks.map(stock => {
            const marketCap = parseFloat(stock.market_cap);
            const changePercent = parseFloat(stock.change_percent);
            return {
                name: stock.ticker || 'UNKNOWN',
                value: isNaN(marketCap) ? 0 : marketCap,
                change: isNaN(changePercent) ? 0 : changePercent,
                sector: stock.sector_zh || 'Unknown Sector',
                name_zh: stock.name_zh
            };
        });
        console.log("DIAGNOSTIC: Step B - Data processing (map) complete. Starting grouping (forEach)...");

        const sectors = {};
        processedStocks.forEach(stock => {
            if (stock.value > 0) {
                if (!sectors[stock.sector]) {
                    sectors[stock.sector] = { name: stock.sector, children: [] };
                }
                sectors[stock.sector].children.push(stock);
            }
        });
        console.log("DIAGNOSTIC: Step C - Grouping (forEach) complete. Finalizing data structure...");

        const treemapData = { name: 'S&P 500', children: Object.values(sectors) };
        console.log("DIAGNOSTIC: Step D - Treemap data is ready. Calling rendering function via requestAnimationFrame...");
        
        requestAnimationFrame(() => {
            console.log("DIAGNOSTIC: Step E - Inside requestAnimationFrame. Calling renderTreemap NOW.");
            renderTreemap(treemapData);
        });

    } catch (error) {
        console.error('CRITICAL ERROR during homepage rendering:', error);
        const loadingDiv = document.querySelector('#heatmap-container #loading');
        if(loadingDiv) loadingDiv.innerText = `Failed to load data: ${error.message}. Displaying mock data.`;
        
        const mockData = generateMockData(500);
        renderTreemap(mockData);
    }
}

function renderTreemap(data) {
    console.log("DIAGNOSTIC: Step F - renderTreemap function has started.");
    const container = document.getElementById('heatmap-container');
    if (!container) {
        console.error("Render Error: Container not found.");
        return;
    }

    const loadingDiv = container.querySelector('#loading');
    if (loadingDiv) loadingDiv.remove();
    
    container.innerHTML = '';

    const width = container.clientWidth;
    const height = container.clientHeight;

    if (width === 0 || height === 0) {
        console.error("Render Error: Container has zero width or height.");
        container.innerHTML = '<p style="color: red;">Render Error: Container has no size.</p>';
        return;
    }
    console.log(`DIAGNOSTIC: Step G - Container size is valid (${width}x${height}). Starting D3 operations...`);

    const treemap = d3.treemap().size([width, height]).padding(2).round(true);
    const root = d3.hierarchy(data).sum(d => d.value).sort((a, b) => b.value - a.value);
    treemap(root);

    const color = d3.scaleLinear().domain([-3, 0, 3]).range(['#2ECC71', '#F0F0F0', '#E74C3C']);

    const svg = d3.select(container).append('svg')
        .attr('viewBox', `0 0 ${width} ${height}`)
        .style('font', '12px sans-serif');

    const leaf = svg.selectAll('g').data(root.leaves()).join('g')
        .attr('transform', d => `translate(${d.x0},${d.y0})`);

    leaf.append('title')
        .text(d => `${d.data.name_zh} (${d.data.name})\n市值: ${(d.data.value / 1e6).toFixed(2)}B\n涨跌幅: ${d.data.change.toFixed(2)}%`);

    leaf.append('rect')
        .attr('fill', d => color(d.data.change))
        .attr('width', d => d.x1 - d.x0)
        .attr('height', d => d.y1 - d.y0);

    leaf.append('clipPath').attr('id', d => `clip-${d.data.name}`)
        .append('rect').attr('width', d => d.x1 - d.x0).attr('height', d => d.y1 - d.y0);
    
    leaf.append('text').attr('clip-path', d => `url(#clip-${d.data.name})`)
        .selectAll('tspan')
        .data(d => ((d.x1 - d.x0) * (d.y1 - d.y0) > 800) ? [d.data.name, `${d.data.change.toFixed(2)}%`] : [])
        .join('tspan')
        .attr('x', 5).attr('y', (d, i) => 15 + i * 12)
        .attr('fill', 'white').style('text-shadow', '1px 1px 2px rgba(0,0,0,0.7)').text(d => d);
    
    console.log("DIAGNOSTIC: Step H - renderTreemap function finished successfully.");
}

function generateMockData(count) {
    console.warn("WARNING: Using mock data!");
    const sectorsData = {};
    const sectors = ['技术', '医疗', '金融', '消费', '工业'];
    for(let i = 0; i < count; i++) {
        const sector = sectors[i % sectors.length];
        if(!sectorsData[sector]) sectorsData[sector] = { name: sector, children: [] };
        sectorsData[sector].children.push({ name: `MOCK${i}`, value: Math.random() * 1000 + 100, change: (Math.random() * 6) - 3, name_zh: `模拟股票${i}` });
    }
    return { name: 'S&P 500 (模拟数据)', children: Object.values(sectorsData) };
}

function renderStockDetailPage(ticker) {
    const mainContent = document.getElementById('app-container');
    mainContent.innerHTML = `<h1>Stock Detail: ${ticker}</h1><p>This feature is under development.</p>`;
}