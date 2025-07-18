// public/script.js (最终修正版)

document.addEventListener('DOMContentLoaded', () => {
    fetchAndRenderHomepage();
});

let allStocksData = [];
let currentView = 'all'; // 'all' or a sector name

function fetchAndRenderHomepage() {
    console.log("Rendering Homepage...");
    document.getElementById('heatmap-title').textContent = 'S&P 500 Heatmap';
    document.getElementById('back-button').style.display = 'none';
    fetch('/api/stocks')
        .then(response => response.json())
        .then(data => {
            console.log(`Successfully fetched ${data.length} stocks.`);
            
            // ===================================================================
            // ==================== [核心修复在这里] ===========================
            // 强制将市值和涨跌幅转换为数字类型，并处理可能存在的无效数据
            // ===================================================================
            allStocksData = data.map(stock => ({
                ...stock,
                market_cap: +stock.market_cap || 0, // 使用 + 号快速转换为数字
                change_percentage: +stock.change_percentage || 0,
            }));
            
            // 诊断日志：看看转换后的第一条数据是什么样
            if (allStocksData.length > 0) {
                console.log("DIAGNOSTIC: First stock data after type conversion:", allStocksData[0]);
            }

            renderTreemap(allStocksData);
            setupSectorButtons(allStocksData);
        })
        .catch(error => console.error('Error fetching stock data:', error));
}

function setupSectorButtons(data) {
    const sectors = [...new Set(data.map(d => d.sector))];
    const container = document.getElementById('sector-buttons');
    container.innerHTML = '';
    sectors.forEach(sector => {
        const button = document.createElement('button');
        button.textContent = sector;
        button.onclick = () => renderSectorView(sector);
        container.appendChild(button);
    });
}

function renderSectorView(sector) {
    currentView = sector;
    document.getElementById('heatmap-title').textContent = `${sector} Sector`;
    document.getElementById('back-button').style.display = 'inline-block';
    const sectorData = allStocksData.filter(d => d.sector === sector);
    renderTreemap(sectorData);
}

document.getElementById('back-button').addEventListener('click', () => {
    currentView = 'all';
    fetchAndRenderHomepage();
});


function renderTreemap(data) {
    console.log("DIAGNOSTIC: Step F - renderTreemap function has started.");
    const container = d3.select("#heatmap-container");
    container.selectAll("*").remove(); // 清空旧图

    const width = container.node().getBoundingClientRect().width;
    const height = container.node().getBoundingClientRect().height;
    
    if (width <= 0 || height <= 0 || !data || data.length === 0) {
        console.warn("DIAGNOSTIC: Invalid dimensions or no data. Aborting render.");
        return;
    }
    console.log(`DIAGNOSTIC: Step G - Container size is valid (${width}x${height}). Starting D3 operations...`);


    const root = d3.hierarchy({ children: data })
        .sum(d => d.market_cap)
        .sort((a, b) => b.value - a.value);

    const treemap = d3.treemap()
        .size([width, height])
        .padding(2);

    treemap(root);

    const colorScale = d3.scaleLinear()
        .domain([-3, 0, 3])
        .range(["#e63946", "#f1f1f1", "#2a9d8f"])
        .clamp(true);

    const cell = container.selectAll("g")
        .data(root.leaves())
        .enter().append("g")
        .attr("transform", d => `translate(${d.x0},${d.y0})`);

    cell.append("rect")
        .attr("id", d => `rect-${d.data.ticker}`)
        .attr("width", d => d.x1 - d.x0)
        .attr("height", d => d.y1 - d.y0)
        .attr("fill", d => colorScale(d.data.change_percentage))
        .style("stroke", "#333");

    cell.append("text")
        .attr("x", 5)
        .attr("y", 20)
        .text(d => d.data.ticker)
        .attr("font-size", "14px")
        .attr("fill", "white")
        .style("pointer-events", "none");

    cell.append("text")
        .attr("x", 5)
        .attr("y", 38)
        .text(d => `${d.data.change_percentage.toFixed(2)}%`)
        .attr("font-size", "12px")
        .attr("fill", "white")
        .style("pointer-events", "none");
        
    console.log("DIAGNOSTIC: Step H - renderTreemap function finished successfully.");
}

// 确保在窗口大小改变时重新渲染
window.addEventListener('resize', () => {
    if (currentView === 'all') {
        renderTreemap(allStocksData);
    } else {
        const sectorData = allStocksData.filter(d => d.sector === currentView);
        renderTreemap(sectorData);
    }
});