// public/script.js (绝对完整的最终诊断版)

document.addEventListener('DOMContentLoaded', () => {
    fetchAndRenderData();
});

let allStocksData = []; // 用于存储清理后的扁平化数据
let currentView = 'all';
let rootDataForTreemap; // 用于存储层级化后的数据

function fetchAndRenderData() {
    console.log("[STEP 1] Starting fetch...");
    fetch('/api/stocks')
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return response.json();
        })
        .then(data => {
            console.log(`[STEP 2] Fetched ${data.length} raw stocks.`);
            
            // 数据清洗和转换
            allStocksData = data
                .map(stock => ({
                    ...stock,
                    market_cap: +stock.market_cap || 0,
                    change_percentage: +stock.change_percentage || 0,
                }))
                .filter(stock => stock.market_cap > 0);
            
            console.log(`[STEP 3] Cleaned data. ${allStocksData.length} stocks have valid market_cap.`);
            console.log("Sample clean data:", allStocksData.slice(0, 5));

            // 构建层级数据
            const groupedData = d3.group(allStocksData, d => d.sector);
            console.log("[STEP 4] Data grouped by d3.group. Result is a Map:", groupedData);

            rootDataForTreemap = {
                name: "S&P 500",
                children: Array.from(groupedData, ([key, value]) => ({
                    name: key,
                    children: value
                }))
            };
            
            console.log("[STEP 5] Data structure prepared for d3.hierarchy:", rootDataForTreemap);
            
            renderTreemap(rootDataForTreemap, "S&P 500 Heatmap");
            // 注意：我们在这个版本中暂时不设置行业按钮，先解决主视图问题
        })
        .catch(error => console.error('Error fetching data:', error));
}


function renderTreemap(data, title) {
    console.log("[STEP 6] renderTreemap function called.");
    currentView = data.name; // 更新当前视图名称

    const container = d3.select("#heatmap-container");
    container.selectAll("*").remove();

    const width = container.node().getBoundingClientRect().width;
    const height = container.node().getBoundingClientRect().height;

    // 创建层级数据
    const hierarchy = d3.hierarchy(data)
        .sum(d => d.market_cap)
        .sort((a, b) => b.value - a.value);
    
    console.log("[STEP 7] d3.hierarchy object created. Root node:", hierarchy);
    console.log("Root node's children (Sectors):", hierarchy.children);
    
    const treemapLayout = d3.treemap()
        .size([width, height])
        .paddingTop(28)
        .paddingRight(7)
        .paddingInner(3);

    treemapLayout(hierarchy);

    // 检查叶子节点
    const leaves = hierarchy.leaves();
    console.log(`[STEP 8] Treemap layout calculated. Found ${leaves.length} leaves (stocks) to render.`);
    console.log("Sample leaf node (with x0, y0 coordinates):", leaves[0]);
    
    if (leaves.length < 2 && leaves.length > 0) {
        console.error("MAJOR ISSUE: Treemap resulted in less than 2 leaves. This is likely why only one box is showing!");
    }

    // 颜色比例尺
    const colorScale = d3.scaleLinear()
        .domain([-3, 0, 3])
        .range(["#e63946", "#4a4a4a", "#2a9d8f"])
        .clamp(true);

    // Tooltip
    const tooltip = d3.select("body").append("div")
        .attr("class", "tooltip")
        .style("opacity", 0);

    // 创建节点
    const nodes = container.selectAll("g.node")
        .data(leaves)
        .enter().append("g")
        .attr("class", "node")
        .attr("transform", d => `translate(${d.x0},${d.y0})`);
    
    // 鼠标事件
    nodes.on("mouseover", function(event, d) {
        d3.select(this).select("rect").style("stroke", "white");
        tooltip.transition().duration(200).style("opacity", .9);
        tooltip.html(
            `<strong>${d.data.ticker}</strong> (${d.data.company})<br/>` +
            `Sector: ${d.data.sector}<br/>` +
            `Market Cap: ${(d.data.market_cap / 1e6).toFixed(2)}B USD<br/>` +
            `Change: <span style="color:${colorScale(d.data.change_percentage)}; font-weight:bold;">${d.data.change_percentage.toFixed(2)}%</span>`
        )
        .style("left", (event.pageX + 10) + "px")
        .style("top", (event.pageY - 28) + "px");
    });
    nodes.on("mouseout", function(d) {
        d3.select(this).select("rect").style("stroke", "#1a1a1a");
        tooltip.transition().duration(500).style("opacity", 0);
    });

    // 绘制矩形
    nodes.append("rect")
        .attr("width", d => d.x1 - d.x0)
        .attr("height", d => d.y1 - d.y0)
        .attr("fill", d => colorScale(d.data.change_percentage))
        .style("stroke", "#1a1a1a")
        .style("stroke-width", "2px");

    // 绘制文字
    const foreignObjects = nodes.append("foreignObject")
        .attr("width", d => d.x1 - d.x0)
        .attr("height", d => d.y1 - d.y0)
        .style("pointer-events", "none")
        .append("xhtml:div")
        .attr("class", "text-container");
    
    foreignObjects.append("div")
        .attr("class", "ticker-text")
        .text(d => d.data.ticker);

    foreignObjects.append("div")
        .attr("class", "change-text")
        .text(d => `${d.data.change_percentage.toFixed(2)}%`);
        
    // 绘制行业标题
    container.selectAll("text.sector-title")
        .data(hierarchy.children) // children 是行业节点
        .enter()
        .append("text")
        .attr("class", "sector-title")
        .attr("x", d => d.x0 + 5)
        .attr("y", d => d.y0 + 20)
        .text(d => d.data.name)
        .attr("font-size", "14px")
        .attr("fill", "#ccc");

    // 更新主标题
    const titleEl = document.getElementById('heatmap-title');
    if (titleEl) titleEl.textContent = title;

    console.log("[STEP 9] Render complete.");
}

// 窗口大小调整事件监听
window.addEventListener('resize', () => {
    if (rootDataForTreemap) {
        renderTreemap(rootDataForTreemap, "S&P 500 Heatmap");
    }
});
