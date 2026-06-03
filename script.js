let data     = [];
let filtered = [];
let years    = [];

let currentYearIndex = 0;
let isPlaying        = false;
let playTimer        = null;

const tooltip = d3.select("#tooltip");

const slider  = document.getElementById("yearSlider");
const playBtn = document.getElementById("playBtn");

/* stanje karte — inicijalizira se jednom */
let mapSvg, mapG, mapProjection, mapZoom;
let mapPointsAll = [];
let mapPointsCur = [];
let mapReady     = false;

/* zajedničke dimenzije grafikona */
const W = 400, H = 300;
const ML = 165, MR = 40, MT = 15, MB = 15;

/* =============================================================
   INIT
   ============================================================= */
async function init() {

    data = await d3.csv("data/terrorism_clean.csv", d => ({
        year:         +d.year,
        country:      d.country,
        region:       d.region,
        city:         d.city,
        lat:          +d.lat,
        lon:          +d.lon,
        attackType:   d.attackType,
        kills:        +d.kills  || 0,
        wounded:      +d.wounded || 0,
        organization: d.organization
    }));

    years = [...new Set(data.map(d => d.year))].sort((a, b) => a - b);

    slider.max   = years.length - 1;
    
    // Postavi 1970. kao zadanu godinu pri učitavanju (ako postoji)
    const defaultYearIndex = years.indexOf(1970) !== -1 ? years.indexOf(1970) : 0;
    slider.value = defaultYearIndex;
    currentYearIndex = defaultYearIndex;

    initFilters();
    
    // Inicijalno bez filtera (prikaži sve podatke)
    filtered = data;

    updateCards(filtered);
    drawCharts(filtered);
    await initMap(filtered);
}

init();

/* =============================================================
   FILTERS
   ============================================================= */
function initFilters() {
    const yrs     = [...new Set(data.map(d => d.year))].sort();
    const regions = [...new Set(data.map(d => d.region))].sort();
    const attacks = [...new Set(data.map(d => d.attackType))].sort();
    fill("yearFilter",   yrs);
    fill("regionFilter", regions);
    fill("attackFilter", attacks);
}

function fill(id, values) {
    const el = document.getElementById(id);
    el.innerHTML = `<option value="all">Sve</option>` +
        values.map(v => `<option value="${v}">${v}</option>`).join("");
}

function applyFilters() {
    const year   = document.getElementById("yearFilter").value;
    const region = document.getElementById("regionFilter").value;
    const attack = document.getElementById("attackFilter").value;

    filtered = data.filter(d =>
        (year   === "all" || d.year       == year)   &&
        (region === "all" || d.region     === region) &&
        (attack === "all" || d.attackType === attack)
    );

    updateCards(filtered);
    drawCharts(filtered);
    mapPointsCur = projectPoints(filtered);
    renderClusters(mapPointsCur, true); // Omogućena tranzicija i pri filtriranju
}

/* =============================================================
   CARDS
   ============================================================= */
function updateCards(d) {
    document.getElementById("totalAttacks").innerText   = d.length.toLocaleString();
    document.getElementById("totalKilled").innerText    = d3.sum(d, x => x.kills).toLocaleString();
    document.getElementById("totalWounded").innerText   = d3.sum(d, x => x.wounded).toLocaleString();
    document.getElementById("totalCountries").innerText = new Set(d.map(x => x.country)).size;
}

/* =============================================================
   CHARTS — Sačuvan kontekst elemenata bez brisanja (selectAll.remove)
   ============================================================= */
function drawCharts(d) {
    drawLine(d);
    drawBar(d);
    drawPie(d);
    drawOrganization(d);
}

/* ── LINE CHART (Tranzicija linije i točaka) ── */
function drawLine(d) {
    const svg = d3.select("#lineChart");
    svg.attr("viewBox", `0 0 ${W} ${H}`);

    const margin = { top: 20, right: 20, bottom: 40, left: 55 };

    const grouped = d3.rollups(d, v => v.length, x => x.year)
        .sort((a, b) => a[0] - b[0]);
    if (!grouped.length) return;

    const x = d3.scaleLinear()
        .domain(d3.extent(grouped, d => d[0]))
        .range([margin.left, W - margin.right]);
    const y = d3.scaleLinear()
        .domain([0, d3.max(grouped, d => d[1])]).nice()
        .range([H - margin.bottom, margin.top]);

    // Linijski put (Path)
    let path = svg.select("path.line-path");
    if (path.empty()) {
        path = svg.append("path").attr("class", "line-path").attr("fill", "none").attr("stroke", "#ff4d5a").attr("stroke-width", 2.5);
    }
    
    path.datum(grouped)
        .transition().duration(500)
        .attr("d", d3.line().x(d => x(d[0])).y(d => y(d[1])).curve(d3.curveMonotoneX));

    // Točke na liniji (Dots) - Enter, Update, Exit
    const dots = svg.selectAll("circle.dot")
        .data(grouped, d => d[0]);

    dots.exit().transition().duration(300).attr("opacity", 0).remove();

    dots.enter().append("circle").attr("class", "dot")
        .attr("r", 4).attr("fill", "#ff4d5a").attr("opacity", 0).style("cursor", "pointer")
        .on("mouseover", function(e, d) {
            d3.select(this).attr("opacity", 1).attr("r", 6);
            showTip(e, `<strong>Godina:</strong> ${d[0]}<br/><strong>Napadi:</strong> ${d[1]}`);
        })
        .on("mousemove", moveTip)
        .on("mouseout",  function() { d3.select(this).attr("opacity", 0).attr("r", 4); hideTip(); })
        .merge(dots)
        .transition().duration(500)
        .attr("cx", d => x(d[0]))
        .attr("cy", d => y(d[1]));

    // Dinamičke osi
    let xAxisG = svg.select("g.x-axis");
    if (xAxisG.empty()) xAxisG = svg.append("g").attr("class", "x-axis").attr("transform", `translate(0,${H - margin.bottom})`);
    xAxisG.transition().duration(500).call(d3.axisBottom(x).tickFormat(d3.format("d")).ticks(6)).attr("color", "#aaa");

    let yAxisG = svg.select("g.y-axis");
    if (yAxisG.empty()) yAxisG = svg.append("g").attr("class", "y-axis").attr("transform", `translate(${margin.left},0)`);
    yAxisG.transition().duration(500).call(d3.axisLeft(y).ticks(5)).attr("color", "#aaa");

    // Statične oznake
    if (svg.select("text.x-label").empty()) {
        svg.append("text").attr("class", "x-label").attr("x", W / 2).attr("y", H - 5).attr("text-anchor", "middle").style("fill", "#aaa").style("font-size", "11px").text("Godina");
        svg.append("text").attr("class", "y-label").attr("transform", "rotate(-90)").attr("x", -H / 2).attr("y", 13).attr("text-anchor", "middle").style("fill", "#aaa").style("font-size", "11px").text("Broj napada");
    }
}

/* ── BAR CHART (Top države — Red) ── */
function drawBar(d) {
    const svg = d3.select("#barChart");
    svg.attr("viewBox", `0 0 ${W} ${H}`);

    const grouped = d3.rollups(d, v => v.length, x => x.country)
        .sort((a, b) => b[1] - a[1]).slice(0, 10);

    const y = d3.scaleBand().domain(grouped.map(d => d[0])).range([MT, H - MB]).padding(0.3);
    const x = d3.scaleLinear().domain([0, d3.max(grouped, d => d[1]) || 1]).range([ML, W - MR]);

    // STUPCI
    const bars = svg.selectAll("rect.bar").data(grouped, d => d[0]);
    
    bars.exit().transition().duration(300).attr("width", 0).remove();
    
    bars.enter().append("rect").attr("class", "bar").attr("fill", "#ff4d5a").attr("rx", 2)
        .attr("x", ML).attr("width", 0).attr("y", d => y(d[0])).attr("height", y.bandwidth())
        .merge(bars)
        .transition().duration(500)
        .attr("y", d => y(d[0]))
        .attr("height", y.bandwidth())
        .attr("width", d => x(d[1]) - ML);

    // TEKST - Nazivi država
    const names = svg.selectAll("text.bar-name").data(grouped, d => d[0]);
    names.exit().transition().duration(300).attr("opacity", 0).remove();
    names.enter().append("text").attr("class", "bar-name").attr("x", ML - 8).attr("text-anchor", "end").attr("fill", "white").style("font-size", "11px").attr("opacity", 0)
        .merge(names)
        .text(d => d[0].length > 20 ? d[0].slice(0, 20) + "…" : d[0])
        .transition().duration(500)
        .attr("y", d => y(d[0]) + y.bandwidth() / 2 + 4)
        .attr("opacity", 1);

    // TEKST - Vrijednosti broja napada
    const vals = svg.selectAll("text.bar-val").data(grouped, d => d[0]);
    vals.exit().transition().duration(300).attr("opacity", 0).remove();
    vals.enter().append("text").attr("class", "bar-val").attr("fill", "white").style("font-size", "11px").attr("opacity", 0).attr("x", ML)
        .merge(vals)
        .text(d => d[1])
        .transition().duration(500)
        .attr("x", d => x(d[1]) + 5)
        .attr("y", d => y(d[0]) + y.bandwidth() / 2 + 4)
        .attr("opacity", 1);
}

/* ── PIE CHART (Vrste napada s interpolacijom kutova) ── */
function drawPie(d) {
    const svg = d3.select("#pieChart");
    svg.attr("viewBox", `0 0 ${W} ${H}`);

    const grouped = d3.rollups(d, v => v.length, x => x.attackType).sort((a, b) => b[1] - a[1]);

    const color = d3.scaleOrdinal().domain(grouped.map(d => d[0])).range(d3.schemeCategory10);
    const pie   = d3.pie().value(d => d[1]).sort(null);
    const arc   = d3.arc().innerRadius(45).outerRadius(105);
    const arcH  = d3.arc().innerRadius(45).outerRadius(112);

    let g = svg.select("g.pie-group");
    if (g.empty()) g = svg.append("g").attr("class", "pie-group").attr("transform", `translate(130,${H / 2})`);

    const slices = g.selectAll("path.slice").data(pie(grouped), d => d.data[0]);

    // Funkcija za glatku interpolaciju kutova (Pie Tweening)
    function arcTween(a) {
        const i = d3.interpolate(this._current, a);
        this._current = i(0);
        return function(t) { return arc(i(t)); };
    }

    slices.exit()
        .transition().duration(400)
        .attrTween("d", function(d) {
            const endAn = d.startAngle;
            const i = d3.interpolate(this._current, { startAngle: endAn, endAngle: endAn, value: 0 });
            return function(t) { return arc(i(t)); };
        }).remove();

    slices.enter().append("path").attr("class", "slice")
        .attr("fill", d => color(d.data[0])).attr("stroke", "#07111f").style("stroke-width", "2px")
        .each(function(d) { this._current = { startAngle: d.startAngle, endAngle: d.startAngle, value: 0 }; })
        .on("mouseover", function(e, d) {
            d3.select(this).transition().duration(200).attr("d", arcH);
            showTip(e, `<strong>${d.data[0]}</strong><br/>Napadi: ${d.data[1]}`);
        })
        .on("mousemove", moveTip)
        .on("mouseout",  function(e, d) { d3.select(this).transition().duration(200).attr("d", arc(d)); hideTip(); })
        .merge(slices)
        .transition().duration(500)
        .attrTween("d", arcTween);

    // LEGENDA - Enter, Update, Exit struktura
    let legG = svg.select("g.legend-group");
    if (legG.empty()) legG = svg.append("g").attr("class", "legend-group");
    legG.transition().duration(500).attr("transform", `translate(250,${H / 2 - grouped.length * 8})`);

    const legItems = legG.selectAll("g.legend-item").data(grouped, d => d[0]);
    legItems.exit().transition().duration(300).attr("opacity", 0).remove();

    const legEnter = legItems.enter().append("g").attr("class", "legend-item").attr("opacity", 0);
    legEnter.append("rect").attr("width", 10).attr("height", 10).attr("rx", 2);
    legEnter.append("text").attr("x", 14).attr("y", 9).style("font-size", "10px").attr("fill", "#ccc");

    const legMerged = legEnter.merge(legItems);
    legMerged.transition().duration(500).attr("transform", (d, i) => `translate(0,${i * 17})`).attr("opacity", 1);
    legMerged.select("rect").attr("fill", d => color(d[0]));
    legMerged.select("text").text(d => d[0].length > 16 ? d[0].slice(0, 16) + "…" : d[0]);
}

/* ── ORGANIZATION CHART (Identična struktura kao Bar Chart — Green) ── */
function drawOrganization(d) {
    const svg = d3.select("#orgChart");
    svg.attr("viewBox", `0 0 ${W} ${H}`);

    const grouped = d3.rollups(
        d.filter(x => x.organization && x.organization !== "Unknown" && x.organization !== ""),
        v => v.length, x => x.organization
    ).sort((a, b) => b[1] - a[1]).slice(0, 10);

    const y = d3.scaleBand().domain(grouped.map(d => d[0])).range([MT, H - MB]).padding(0.3);
    const x = d3.scaleLinear().domain([0, d3.max(grouped, d => d[1]) || 1]).range([ML, W - MR]);

    // STUPCI
    const bars = svg.selectAll("rect.org-bar").data(grouped, d => d[0]);
    bars.exit().transition().duration(300).attr("width", 0).remove();
    bars.enter().append("rect").attr("class", "org-bar").attr("fill", "#00c896").attr("rx", 2)
        .attr("x", ML).attr("width", 0).attr("y", d => y(d[0])).attr("height", y.bandwidth())
        .merge(bars)
        .transition().duration(500)
        .attr("y", d => y(d[0]))
        .attr("height", y.bandwidth())
        .attr("width", d => x(d[1]) - ML);

    // TEKST - Nazivi organizacija
    const names = svg.selectAll("text.org-name").data(grouped, d => d[0]);
    names.exit().transition().duration(300).attr("opacity", 0).remove();
    names.enter().append("text").attr("class", "org-name").attr("x", ML - 8).attr("text-anchor", "end").attr("fill", "white").style("font-size", "11px").attr("opacity", 0)
        .merge(names)
        .text(d => d[0].length > 20 ? d[0].slice(0, 20) + "…" : d[0])
        .transition().duration(500)
        .attr("y", d => y(d[0]) + y.bandwidth() / 2 + 4)
        .attr("opacity", 1);

    // TEKST - Vrijednosti broja napada
    const vals = svg.selectAll("text.org-val").data(grouped, d => d[0]);
    vals.exit().transition().duration(300).attr("opacity", 0).remove();
    vals.enter().append("text").attr("class", "org-val").attr("fill", "white").style("font-size", "11px").attr("opacity", 0).attr("x", ML)
        .merge(vals)
        .text(d => d[1])
        .transition().duration(500)
        .attr("x", d => x(d[1]) + 5)
        .attr("y", d => y(d[0]) + y.bandwidth() / 2 + 4)
        .attr("opacity", 1);
}

/* =============================================================
   MAP — Fluidne tranzicije bez treperenja basemapa
   ============================================================= */
function projectPoints(d) {
    return d.filter(p => p.lat && p.lon).map(p => {
        const [px, py] = mapProjection([p.lon, p.lat]);
        return { ...p, px, py };
    });
}

function buildClusters(points, zoomK) {
    const cellSize = Math.max(4, 50 / Math.pow(zoomK, 1.2));
    const grid = new Map();
    for (const p of points) {
        const key = `${Math.floor(p.px / cellSize)}_${Math.floor(p.py / cellSize)}`;
        if (!grid.has(key)) grid.set(key, { sx: 0, sy: 0, count: 0, items: [], cellSize });
        const c = grid.get(key);
        c.sx += p.px; c.sy += p.py; c.count++; c.items.push(p);
    }
    return Array.from(grid.values()).map(c => ({
        x: c.sx / c.count, y: c.sy / c.count,
        count: c.count, items: c.items, cellSize: c.cellSize
    }));
}

function clusterRadius(count, cellSize) {
    const maxR = (cellSize / 2) * 0.85;
    return Math.min(d3.scaleSqrt().domain([1, 500]).range([3, maxR])(count), maxR);
}

function topN(items, accessor) {
    const freq = {};
    for (const d of items) { const k = accessor(d) || "Unknown"; freq[k] = (freq[k] || 0) + 1; }
    return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([k, v]) => `${k} (${v})`).join("<br/>");
}

function renderClusters(points, useTransition = true) {
    if (!mapReady) return;

    const zoomK    = (mapSvg.property("__zoom") || d3.zoomIdentity).k;
    const clusters = buildClusters(points, zoomK);
    const hasData  = clusters.length > 0;

    if (hasData) {
        mapSvg.call(mapZoom);
    } else {
        mapSvg.on(".zoom", null);
    }

    const circles = mapG.selectAll("circle.cluster")
        .data(clusters, d => `${Math.round(d.x)}_${Math.round(d.y)}`);

    // EXIT — Sakrij klastere koji nestaju glatkim blijeđenjem
    circles.exit()
        .transition()
        .duration(useTransition ? 400 : 0)
        .attr("opacity", 0)
        .remove();

    // ENTER — Počni od radijusa 0 i nevidljivosti pa ih proširi
    const enterCircles = circles.enter().append("circle").attr("class", "cluster")
        .attr("stroke", "#111").attr("stroke-width", 1)
        .attr("cx", d => d.x)
        .attr("cy", d => d.y)
        .attr("r", 0)
        .attr("opacity", 0)
        .style("cursor", "pointer")
        .on("mouseover", function(e, d) {
            d3.select(this).attr("stroke", "white").attr("stroke-width", 2);
            showTip(e, `
                <strong>Napadi:</strong> ${d.count}<br/><br/>
                <strong>Top države:</strong><br/>${topN(d.items, x => x.country)}<br/><br/>
                <strong>Top organizacije:</strong><br/>${topN(d.items, x => x.organization)}
            `);
        })
        .on("mousemove", moveTip)
        .on("mouseout",  function() {
            d3.select(this).attr("stroke", "#111").attr("stroke-width", 1);
            hideTip();
        });

    // MERGE & UPDATE — Glatko pomicanje bez treperenja baze karte
    const merged = enterCircles.merge(circles);
    
    (useTransition ? merged.transition().duration(500) : merged)
        .attr("cx", d => d.x)
        .attr("cy", d => d.y)
        .attr("r", d => clusterRadius(d.count, d.cellSize))
        .attr("opacity", 0.82)
        .attr("fill", d => {
            if (d.count > 50) return "#ff2d2d";
            if (d.count > 20) return "#ff7a00";
            if (d.count > 5)  return "#ffd000";
            return "#66ccff";
        });
}

async function initMap(d) {
    const W_MAP = 900, H_MAP = 500;

    d3.select("#map").html("");

    mapSvg = d3.select("#map").append("svg")
        .attr("width",   "100%")
        .attr("height",  H_MAP)
        .attr("viewBox", `0 0 ${W_MAP} ${H_MAP}`);

    mapG = mapSvg.append("g");

    mapProjection = d3.geoMercator()
        .scale(130).translate([W_MAP / 2, H_MAP / 1.5]);

    const mapPath = d3.geoPath().projection(mapProjection);

    const world = await d3.json(
        "https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson"
    );

    mapG.selectAll("path.country")
        .data(world.features).enter().append("path").attr("class", "country")
        .attr("d", mapPath)
        .attr("fill", "#452a7a").attr("stroke", "#6a4a9a").attr("stroke-width", 0.5);

    mapZoom = d3.zoom()
        .scaleExtent([1, 10])
        .translateExtent([[0, 0], [W_MAP, H_MAP]])
        .on("zoom", e => {
            mapG.attr("transform", e.transform);
            renderClusters(mapPointsCur.length ? mapPointsCur : mapPointsAll, false);
        });

    mapPointsAll = projectPoints(d);
    mapPointsCur = mapPointsAll;
    mapReady     = true;

    renderClusters(mapPointsAll, false);
    mapSvg.call(mapZoom);
}

/* =============================================================
   PLAY ANIMATION 
   ============================================================= */
slider.addEventListener("input", e => {
    if (isPlaying) stopPlay();
    setYear(+e.target.value);
});

playBtn.addEventListener("click", () => {
    isPlaying ? stopPlay() : startPlay();
});

function startPlay() {
    isPlaying = true;
    playBtn.innerText = "⏸ Pause";
    
    if (currentYearIndex >= years.length - 1) {
        const defaultYearIndex = years.indexOf(1970) !== -1 ? years.indexOf(1970) : 0;
        setYear(defaultYearIndex);
    }
    
    playTimer = setInterval(() => {
        const next = (currentYearIndex + 1) % years.length;
        setYear(next);
        if (next === 0) stopPlay();
    }, 800); 
}

function stopPlay() {
    isPlaying = false;
    clearInterval(playTimer);
    playBtn.innerText = "▶ Play";
}

function setYear(index) {
    currentYearIndex = index;
    slider.value     = index;

    const yr = years[index];
    const d  = data.filter(x => x.year === yr);

    updateCards(d);
    drawCharts(d);

    mapPointsCur = projectPoints(d);
    renderClusters(mapPointsCur, true);
}

/* =============================================================
   TOOLTIP
   ============================================================= */
function showTip(event, html) {
    tooltip.style("opacity", 1).html(html)
        .style("left", (event.pageX + 12) + "px")
        .style("top",  (event.pageY - 12) + "px");
}
function moveTip(event) {
    tooltip.style("left", (event.pageX + 12) + "px")
           .style("top",  (event.pageY - 12) + "px");
}
function hideTip() { tooltip.style("opacity", 0); }