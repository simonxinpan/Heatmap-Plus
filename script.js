// public/script.js (基于V6的成功版本)

document.addEventListener('DOMContentLoaded', () => {
    fetchAndRenderHomepage();
});

let allStocksData = [];
let currentView = 'all';

function fetchAndRenderHomepage() {
    console.log("Rendering Homepage...");
    const titleEl = document.getElementById('heatmap-title');
    if (titleEl) titleEl.textContent = 'S&P 500 Heatmap';
    const backBtnEl = document.getElementById('back-button');
    if (backBtnEl) backBtnEl.style.display = 'none';

    fetch('/api/stocks')
        .then(response => response.json())
        .then(data => {
            console.log(`Successfully fetched ${data.length} stocks.`);
            
            // 使用V6验证过的简单数据清洗
            allStocksData = data.map(stock => ({
                ...stock,
                market_cap: +stock.market_cap || 0,
                change_percentage: +stock.change_percentage || 0,
            })).filter(stock => stock.market_cap > 0);
            
            if (allStocksData.length > 0) {
                 renderTreemap(allStocksData);
                 setupSectorButtons(allStocksData);
            }
        })
        .catch(error => console.error('Error fetching stock data:', error));
}

function setupSectorButtons(data) {
    const sectors = [...new Set(data.map(d => d.sector))].sort();
    const container = document.getElementById('sector-buttons');
    if (!container) return;
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
    const titleEl = document.getElementById('heatmap-title');
    if (titleEl) titleEl.textContent = `${sector} Sector`;
    const backBtnEl = document.getElementById('back-button');
    if (backBtnEl) backBtnEl.style.display = 'inline-block';
    
    const sectorData = allStocksData.filter(d => d.sector === sector);
    renderTreemap(sectorData);
}

const backButton = document.getElementById('back-button');
if (backButton) {
    backButton.addEventListener('click', () => {
        currentView = 'all';
        fetchAndRenderHomepage();
    });
}

function renderTreemap(data) {
    const container = d3.select("#heatmap-container");
    container.selectAll("*").remove();

    const width = container.node().getBoundingClientRect().width;
    const height = container.node().getBoundingClientRect().height;
    
    if (width <= 0 || height <= 0 || !data || data.length === 0) return;

    // V6的核心逻辑：直接使用扁平数据
    const root = d3.hierarchy({ children: data })
        .sum(d => d.market_cap)
        .sort((a, b) => b.value - a.value);

    const treemap = d3.treemap().size([width, height]).padding(2);
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
        .attr("width", d => d.x1 - d.x0)
        .attr("height", d => d.y1 - d.y0)
        .attr("fill", d => colorScale(d.data.change_percentage))
        .style("stroke", "#333");

    // V6的文本渲染逻辑
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
}

window.addEventListener('resize', () => {
    if (currentView === 'all') {
        renderTreemap(allStocksData);
    } else {
        const sectorData = allStocksData.filter(d => d.sector === currentView);
        renderTreemap(sectorData);
    }
});