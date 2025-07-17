// script.js (Graduation Masterpiece - Final Polished V10 - Server-Side Sorting)

const appContainer = document.getElementById('app-container');
const tooltip = document.getElementById('tooltip');
let fullMarketData = null; // 用于缓存从API获取的完整数据

document.addEventListener('DOMContentLoaded', router);
window.addEventListener('popstate', router);

// 使用防抖技术优化resize事件，避免频繁重绘
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(rerenderCurrentView, 250);
});

// 主路由函数，根据URL参数决定渲染哪个页面
async function router() {
    showLoading();
    const params = new URLSearchParams(window.location.search);
    const page = params.get('page');
    const symbol = params.get('symbol');
    const sector = params.get('sector');

    if (page === 'stock' && symbol) {
        await renderStockDetailPage(symbol);
    } else if (sector) {
        // 如果有sector参数，则渲染行业详情页
        await renderHomePage(decodeURIComponent(sector));
    } else {
        // 默认渲染全景热力图
        document.title = '股票热力图 - 全景';
        await renderHomePage();
    }
}

// 显示加载动画
function showLoading() {
    appContainer.innerHTML = `<div class="loading-indicator"><div class="spinner"></div><p>数据加载中...</p></div>`;
}

// 渲染主页（全景或行业详情）
async function renderHomePage(sectorName = null) {
    try {
        // 每次渲染都从API获取最新数据
        const res = await fetch('/api/stocks');
        if (!res.ok) {
            let errorMsg = '获取市场数据失败';
            try { 
                const errorData = await res.json(); 
                errorMsg = errorData.error || errorMsg; 
            } catch(e) {}
            throw new Error(errorMsg);
        }
        fullMarketData = await res.json(); // 更新全局数据缓存

        let dataToRender = fullMarketData;
        let headerHtml;

        if (sectorName) {
            // 过滤出特定行业的数据
            dataToRender = fullMarketData.filter(stock => stock.sector_zh === sectorName);
            document.title = `${sectorName} - 行业热力图`;
            headerHtml = `<header class="header"><h1>${sectorName}</h1><a href="/" class="back-link" onclick="navigate(event, '/')">← 返回全景图</a></header>`;
        } else {
            // 全景图的标题
            headerHtml = `<header class="header"><h1>股票热力图</h1><div class="data-source">美股市场 (BETA)</div></header>`;
        }
        
        if (!dataToRender || dataToRender.length === 0) {
            appContainer.innerHTML = `<div class="loading-indicator">没有找到数据，后台可能正在更新，请稍后刷新...</div>`;
            return;
        }

        // 渲染页面骨架
        appContainer.innerHTML = `
            ${headerHtml}
            <main id="heatmap-container-final" class="heatmap-container-final"></main>
            <footer class="legend">
                <span>-3%</span>
                <div class="legend-item"><div class="legend-color-box loss-5"></div></div>
                <div class="legend-item"><div class="legend-color-box loss-3"></div></div>
                <div class="legend-item"><div class="legend-color-box loss-1"></div></div>
                <div class="legend-item"><div class="legend-color-box flat"></div></div>
                <div class="legend-item"><div class="legend-color-box gain-1"></div></div>
                <div class="legend-item"><div class="legend-color-box gain-3"></div></div>
                <div class="legend-item"><div class="legend-color-box gain-5"></div></div>
                <span>+3%</span>
            </footer>
        `;
        
        // 行业视图下不显示图例
        if (sectorName) {
            appContainer.querySelector('.legend').style.display = 'none';
        }

        // 使用 requestAnimationFrame 确保在DOM渲染后执行treemap计算
        requestAnimationFrame(() => {
            const container = document.getElementById('heatmap-container-final');
            if (container) {
                generateTreemap(dataToRender, container, !sectorName);
            }
        });
    } catch (error) {
        console.error("Render HomePage Error:", error);
        appContainer.innerHTML = `<div class="loading-indicator">加载失败: ${error.message}</div>`;
    }
}

// 生成Treemap布局的核心函数
function generateTreemap(data, container, groupIntoSectors = true) {
    container.innerHTML = '';
    const { clientWidth: totalWidth, clientHeight: totalHeight } = container;
    if (totalWidth === 0 || totalHeight === 0 || !data || data.length === 0) return;

    let itemsToLayout;
    if (groupIntoSectors) {
        const stocksBySector = groupDataBySector(data);
        // 【优化】: itemsToLayout不再需要排序，因为后端返回的数据已经是按市值排序的
        itemsToLayout = Object.entries(stocksBySector).map(([sectorName, sectorData]) => ({
            name: sectorName, 
            isSector: true, 
            value: sectorData.total_market_cap,
            // 【优化】: sectorData.stocks也不再需要排序
            items: sectorData.stocks.map(s => ({ ...s, value: s.market_cap, isSector: false }))
        }));
    } else {
        // 【优化】: data本身也不再需要排序
        itemsToLayout = data.map(s => ({ ...s, value: s.market_cap, isSector: false }));
    }

    // 递归布局函数
    function layout(items, x, y, width, height, parentEl) {
        if (items.length === 0 || width <= 1 || height <= 1) return;
        
        const totalValue = items.reduce((sum, item) => sum + (item.value || 0), 0);
        if (totalValue <= 0) return;

        if (items.length === 1) {
            renderNode(items[0], x, y, width, height, parentEl);
            return;
        }

        let bestSplitIndex = 0;
        let minDiff = Infinity;
        const targetValue = totalValue / 2;
        let cumulativeValue = 0;

        for (let i = 0; i < items.length - 1; i++) {
            cumulativeValue += items[i].value || 0;
            const diff = Math.abs(cumulativeValue - targetValue);
            if (diff < minDiff) {
                minDiff = diff;
                bestSplitIndex = i;
            }
        }

        const firstGroup = items.slice(0, bestSplitIndex + 1);
        const secondGroup = items.slice(bestSplitIndex + 1);
        const firstValue = firstGroup.reduce((s, item) => s + (item.value || 0), 0);
        
        const proportion = totalValue > 0 ? firstValue / totalValue : 0.5;
        const isHorizontal = width > height;

        if (isHorizontal) {
            const firstWidth = width * proportion;
            layout(firstGroup, x, y, firstWidth, height, parentEl);
            layout(secondGroup, x + firstWidth, y, width - firstWidth, height, parentEl);
        } else {
            const firstHeight = height * proportion;
            layout(firstGroup, x, y, width, firstHeight, parentEl);
            layout(secondGroup, x, y + firstHeight, width, height - firstHeight, parentEl);
        }
    }

    // 渲染单个节点（行业或股票）
    function renderNode(node, x, y, width, height, parentEl) {
        if (node.isSector) {
            const sectorEl = createSectorElement(node, x, y, width, height);
            parentEl.appendChild(sectorEl);
            const titleEl = sectorEl.querySelector('.treemap-title-link');
            const titleHeight = titleEl ? titleEl.offsetHeight : 31;
            const contentContainer = sectorEl.querySelector('.treemap-sector-content');
            layout(node.items, 0, 0, width, height - titleHeight, contentContainer);
        } else {
            const stockEl = createStockElement(node, width, height);
            stockEl.style.left = `${x}px`;
            stockEl.style.top = `${y}px`;
            parentEl.appendChild(stockEl);
        }
    }
    
    // 开始布局
    layout(itemsToLayout, 0, 0, totalWidth, totalHeight, container);
}

// 创建行业板块的DOM元素
function createSectorElement(sector, x, y, width, height) {
    const sectorEl = document.createElement('div');
    sectorEl.className = 'treemap-sector';
    sectorEl.style.left = `${x}px`; sectorEl.style.top = `${y}px`;
    sectorEl.style.width = `${width}px`; sectorEl.style.height = `${height}px`;
    
    const titleLink = document.createElement('a');
    titleLink.className = 'treemap-title-link';
    titleLink.href = `/?sector=${encodeURIComponent(sector.name)}`;
    titleLink.onclick = (e) => navigate(e, titleLink.href);
    titleLink.innerHTML = `<h2 class="treemap-title">${sector.name}</h2>`;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'treemap-sector-content';
    
    sectorEl.appendChild(titleLink);
    sectorEl.appendChild(contentDiv);
    return sectorEl;
}

// 创建单个股票的DOM元素
function createStockElement(stock, width, height) {
    const stockLink = document.createElement('a');
    stockLink.className = 'treemap-stock';
    stockLink.href = `/?page=stock&symbol=${stock.ticker}`;
    stockLink.onclick = (e) => navigate(e, stockLink.href);
    stockLink.style.width = `${width}px`; stockLink.style.height = `${height}px`;

    const stockDiv = document.createElement('div');
    const change = parseFloat(stock.change_percent || 0);
    stockDiv.className = `stock ${getColorClass(change)}`;
    
    const area = width * height;
    if (area > 10000) stockDiv.classList.add('detail-xl');
    else if (area > 4000) stockDiv.classList.add('detail-lg');
    else if (area > 1500) stockDiv.classList.add('detail-md');
    else if (area > 600) stockDiv.classList.add('detail-sm');
    else stockDiv.classList.add('detail-xs');
    
    stockDiv.innerHTML = `<span class="stock-ticker">${stock.ticker}</span><span class="stock-name-zh">${stock.name_zh}</span><span class="stock-change">${change >= 0 ? '+' : ''}${change.toFixed(2)}%</span>`;
    
    stockLink.appendChild(stockDiv);
    
    stockLink.addEventListener('mouseover', (e) => {
        if (!tooltip) return;
        const marketCap = stock.market_cap ? (stock.market_cap / 1000).toFixed(2) : 'N/A';
        const changeClass = change >= 0 ? 'gain' : 'loss';
        tooltip.innerHTML = `<div class="tooltip-header">${stock.ticker} - ${stock.name_zh}</div><div class="tooltip-row"><span class="tooltip-label">涨跌幅</span><span class="tooltip-value ${changeClass}">${change >= 0 ? '+' : ''}${change.toFixed(2)}%</span></div><div class="tooltip-row"><span class="tooltip-label">总市值</span><span class="tooltip-value">${marketCap}B</span></div><div class="tooltip-row"><span class="tooltip-label">所属行业</span><span class="tooltip-value">${stock.sector_zh || 'N/A'}</span></div>`;
        tooltip.style.display = 'block';
    });

    stockLink.addEventListener('mousemove', (e) => {
        if (!tooltip) return;
        tooltip.style.left = `${e.clientX + 15}px`;
        tooltip.style.top = `${e.clientY + 15}px`;
    });

    stockLink.addEventListener('mouseout', () => {
        if (!tooltip) return;
        tooltip.style.display = 'none';
    });

    return stockLink;
}

// 按行业分组数据
function groupDataBySector(data) {
    if (!data) return {};
    return data.reduce((acc, stock) => {
        const sector = stock.sector_zh || '其他';
        if (!acc[sector]) { acc[sector] = { stocks: [], total_market_cap: 0 }; }
        acc[sector].stocks.push(stock);
        acc[sector].total_market_cap += (stock.market_cap || 0);
        return acc;
    }, {});
}

// 根据涨跌幅获取颜色类
function getColorClass(change) {
    if (isNaN(change) || Math.abs(change) < 0.01) return 'flat';
    if (change >= 3) return 'gain-5'; if (change >= 2) return 'gain-4'; if (change >= 1) return 'gain-3';
    if (change >= 0.25) return 'gain-2'; if (change > 0) return 'gain-1';
    if (change <= -3) return 'loss-5'; if (change <= -2) return 'loss-4'; if (change <= -1) return 'loss-3';
    if (change <= -0.25) return 'loss-2'; return 'loss-1';
}

// SPA导航函数
function navigate(event, path) {
    event.preventDefault();
    window.history.pushState({}, '', path);
    router();
}

// 渲染股票详情页
async function renderStockDetailPage(symbol) {
    try {
        appContainer.innerHTML = `<div class="loading-indicator"><div class="spinner"></div><p>正在加载 ${symbol} 的详细数据...</p></div>`;
        const res = await fetch(`/api/stocks?ticker=${symbol}`);
        if (!res.ok) throw new Error('获取股票详情失败');
        const { profile, quote } = await res.json();
        
        const nameZh = profile.name_zh || ''; 
        const sectorZh = profile.sector_zh || profile.finnhubIndustry || 'N/A';
        const description = profile.description || '暂无公司简介。';
        const change = quote.dp || 0; 
        const changeAmount = quote.d || 0; 
        const changeClass = change >= 0 ? 'gain' : 'loss';
        const marketCapBillion = profile.marketCapitalization ? (profile.marketCapitalization / 1000).toFixed(2) : 'N/A';
        const shareBillion = profile.shareOutstanding ? (profile.shareOutstanding / 1000).toFixed(2) : 'N/A';
        const high = quote.h || 0; 
        const low = quote.l || 0; 
        const currentPrice = quote.c || 0; 
        const openPrice = quote.o || 0;

        document.title = `${nameZh} (${profile.ticker}) - 股票详情`;
        
        appContainer.innerHTML = `
            <header class="header">
                <h1>${nameZh} ${profile.name} (${profile.ticker})</h1>
                <a href="javascript:history.back()" class="back-link" onclick="navigate(event, document.referrer || '/')">← 返回上一页</a>
            </header>
            <div class="stock-detail-page">
                <main class="main-content">
                    <div class="card">
                        <div class="stock-header">
                            <div class="stock-identity">
                                <img src="${profile.logo}" alt="${profile.name} Logo" class="stock-logo" onerror="this.style.display='none'">
                                <div class="stock-name">
                                    <h1>${profile.name}</h1>
                                    <p>${profile.exchange}: ${profile.ticker}</p>
                                </div>
                            </div>
                            <div class="stock-price-info">
                                <div class="current-price">${currentPrice.toFixed(2)} <span class="price-change ${changeClass}">${change >= 0 ? '+' : ''}${changeAmount.toFixed(2)} (${change.toFixed(2)}%)</span></div>
                                <div class="market-status">数据来源: Finnhub</div>
                            </div>
                        </div>
                    </div>
                    <section class="chart-section">
                        <div class="chart-placeholder">K线图功能正在开发中...</div>
                    </section>
                </main>
                <aside class="right-sidebar">
                    <div class="card">
                        <h2 class="card-title">关于 ${nameZh}</h2>
                        <p class="company-info-text">${description}</p>
                        <div class="summary-item"><span class="label">市值</span><span class="value">${marketCapBillion}B USD</span></div>
                        <div class="summary-item"><span class="label">总股本</span><span class="value">${shareBillion}B</span></div>
                        <div class="summary-item"><span class="label">行业</span><span class="value">${sectorZh}</span></div>
                        <div class="summary-item"><span class="label">官网</span><span class="value"><a href="${profile.weburl}" target="_blank" rel="noopener noreferrer">${profile.weburl ? profile.weburl.replace(/^(https?:\/\/)?(www\.)?/, '') : 'N/A'}</a></span></div>
                    </div>
                    <div class="card">
                        <h2 class="card-title">关键数据</h2>
                        <div class="summary-item"><span class="label">开盘价</span><span class="value">${openPrice.toFixed(2)}</span></div>
                        <div class="summary-item"><span class="label">最高价</span><span class="value">${high.toFixed(2)}</span></div>
                        <div class="summary-item"><span class="label">最低价</span><span class="value">${low.toFixed(2)}</span></div>
                    </div>
                </aside>
            </div>
        `;
    } catch (error) {
        console.error('Error rendering stock detail page:', error);
        appContainer.innerHTML = `<div class="loading-indicator">${error.message}</div>`;
    }
}

// 当窗口大小改变时，重新渲染当前的视图
function rerenderCurrentView() {
    if (!fullMarketData) return; // 如果没有数据，则不执行任何操作
    const container = document.getElementById('heatmap-container-final');
    if (container) {
        const params = new URLSearchParams(window.location.search);
        const sector = params.get('sector');
        if (sector) {
            const dataToRender = fullMarketData.filter(stock => stock.sector_zh === decodeURIComponent(sector));
            generateTreemap(dataToRender, container, false);
        } else {
            generateTreemap(fullMarketData, container, true);
        }
    }
}