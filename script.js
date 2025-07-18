// public/script.js (目标导向的最终版本)

document.addEventListener('DOMContentLoaded', () => {
    fetchAndRenderData();
});

let rootData; // 用来存储原始的层级数据

function fetchAndRenderData() {
    fetch('/api/stocks')
        .then(response => response.json())
        .then(data => {
            console.log(`Successfully fetched ${data.length} stocks.`);

            const cleanData = data
                .map(stock => ({
                    ...stock,
                    market_cap: +stock.market_cap || 0,
                    change_percentage: +stock.change_percentage || 0,
                }))
                .filter(stock => stock.market_cap > 0);

            // === 核心：构建三级层级数据 ===
            // 根 (root) -> 行业 (sector) -> 股票 (ticker)
            const groupedData = d3.group(cleanData, d => d.sector);
            
            rootData = {
                name: "S&P 500",
                children: Array.from(groupedData, ([key, value]) => ({
                    name: key,
                    children: value
                }))
            };

            renderTreemap(rootData, "S&P 500 Heatmap");
        })
        .catch(error => console.error('Error fetching data:', error));
}


function renderTreemap(data, title) {
    const container = d3.select("#heatmap-container");
    container.selectAll("*").remove();

    const width = container.node().getBoundingClientRect().width;
    const height = container.node().getBoundingClientRect().height;

    const hierarchy = d3.hierarchy(data)
        .sum(d => d.market_cap) // 告诉 d3 如何计算每个节点的“值”
        .sort((a, b) => b.value - a.value); // 按市值排序

    const treemapLayout = d3.treemap()
        .size([width, height])
        .paddingTop(28) // 为行业标题留出空间
        .paddingRight(7)
        .paddingInner(3);

    treemapLayout(hierarchy);

    const colorScale = d3.scaleLinear()
        .domain([-3, 0, 3])
        .range(["#e63946", "#4a4a4a", "#2a9d8f"]) // 红-深灰-绿
        .clamp(true);

    // === 创建 Tooltip ===
    const tooltip = d3.select("body").append("div")
        .attr("class", "tooltip")
        .style("opacity", 0);

    // === 创建节点 ===
    const nodes = container.selectAll("g")
        .data(hierarchy.leaves()) // 只选择最底层的叶子节点（股票）
        .enter().append("g")
        .attr("transform", d => `translate(${d.x0},${d.y0})`)
        .on("mouseover", function(event, d) {
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
        })
        .on("mouseout", function(d) {
            d3.select(this).select("rect").style("stroke", "#1a1a1a");
            tooltip.transition().duration(500).style("opacity", 0);
        });

    // === 绘制矩形 ===
    nodes.append("rect")
        .attr("width", d => d.x1 - d.x0)
        .attr("height", d => d.y1 - d.y0)
        .attr("fill", d => colorScale(d.data.change_percentage))
        .style("stroke", "#1a1a1a")
        .style("stroke-width", "2px");

    // === 使用 foreignObject 实现灵活的文字布局 ===
    const foreignObjects = nodes.append("foreignObject")
        .attr("width", d => d.x1 - d.x0)
        .attr("height", d => d.y1 - d.y0)
        .style("pointer-events", "none") // 让鼠标事件穿透
        .append("xhtml:div")
        .attr("class", "text-container");
    
    foreignObjects.append("div")
        .attr("class", "ticker-text")
        .text(d => d.data.ticker);

    foreignObjects.append("div")
        .attr("class", "change-text")
        .text(d => `${d.data.change_percentage.toFixed(2)}%`);
        
    // === 绘制行业标题 ===
    const sectorNodes = hierarchy.children; // 获取所有行业的节点
    container.selectAll("text.sector-title")
        .data(sectorNodes)
        .enter()
        .append("text")
        .attr("class", "sector-title")
        .attr("x", d => d.x0 + 5)
        .attr("y", d => d.y0 + 20)
        .text(d => d.data.name) // 行业中文名
        .attr("font-size", "14px")
        .attr("fill", "#ccc");

    // === 更新主标题 ===
    document.getElementById('heatmap-title').textContent = title;
}

// 注意：这个新版本中，我们不再需要行业按钮和返回按钮的复杂逻辑，
// 因为D3的层级布局已经原生支持了行业分组。
// 如果需要点击进入某个行业，需要更复杂的Zoomable Treemap逻辑，可以作为下一步优化。