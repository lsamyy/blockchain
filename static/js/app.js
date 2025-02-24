// static/js/app.js

// ------------------------------
// Global Variables & Settings
// ------------------------------
let rawTxData = null;           // Full tx data from the API
let filteredTxData = null;      // Tx data after applying filters
let graphData = { nodes: [], links: [] }; // Aggregated flows
let tokenPrices = { ETH: 3000 }; // Default ETH price; ERC20 tokens added dynamically
let nicknames = {};             // Custom nicknames keyed by wallet address
let nodeColors = {};            // Custom colors keyed by wallet address
let hiddenNodes = new Set();    // Set of wallet addresses (lowercase) that are hidden

let timeExtent = [0, 0];        // [minTimestamp, maxTimestamp] from fetched txs
let currentTimeRange = null;    // Currently selected time window (ms)

let centralWallet = "";         // The input wallet (lowercase) that remains at the center
let globalAllNodes = [];        // All unique addresses from fetched txs

// Fixed positions: once computed, they never change.
let fixedPositions = {};        // Object mapping wallet id => { x, y }
let globalRadiusScale = null;   // Bubble sizing scale

let manualPositioning = false;


// Formatter for amounts (comma separated with two decimals)
const formatAmount = d3.format(",.2f");

// SVG dimensions for the circle layout
const svg = d3.select("#viz-svg");
const width = +svg.attr("width");
const height = +svg.attr("height");
const centerX = width / 2;
const centerY = height / 2;
const circleRadius = Math.min(width, height) / 3; // Radius for non-central nodes

// ------------------------------
// Setup Zoom Layers & Behavior
// ------------------------------
// Create a layer for zoomable graphics (nodes, links, arrowheads)
const zoomableLayer = svg.append("g").attr("class", "zoomable-layer");
// Create a separate layer for text that should NOT scale (node labels, arrow labels)
const nonScalingTextLayer = svg.append("g").attr("class", "non-scaling-text-layer");

// Within the zoomable layer, create groups for links and nodes
const linkGroup = zoomableLayer.append("g").attr("class", "links");
const nodeGroup = zoomableLayer.append("g").attr("class", "nodes");

// Setup d3.zoom on the SVG
const zoom = d3.zoom()
  .scaleExtent([0.5, 10])  // Adjust extents as needed
  .on("zoom", zoomed);
svg.call(zoom);

function zoomed(event) {
  const t = event.transform;
  // Apply the full transform to the zoomable graphics
  zoomableLayer.attr("transform", t);
  // Instead of applying an inverse scale to the entire text layer,
  // update the absolute positions of each text element so they remain constant.
  updateTextPositions(t);
  updateLinks(t);  // Ensure link lines and arrowheads update
}

function updateTextPositions(t) {
  // Update node labels: position each group so its origin is at the bubble center
  nonScalingTextLayer.selectAll("g.node-label")
    .attr("transform", d => {
      let pos = getFixedPos(d.id);
      return "translate(" + (t.x + t.k * pos.x) + "," + (t.y + t.k * pos.y) + ")";
    });
    
  // Update arrow labels as before.
  nonScalingTextLayer.selectAll("g.linkLabel")
    .attr("transform", function(d) {
      let p1 = getFixedPos(d.source);
      let p2 = getFixedPos(d.target);
      let dx = p2.x - p1.x, dy = p2.y - p1.y, L = Math.sqrt(dx * dx + dy * dy) || 1;
      let unit = { x: dx / L, y: dy / L };
      let unitPerp = { x: -dy / L, y: dx / L };
      let offset = d.tokenOffset;
      let p1_offset = { x: p1.x + offset * unitPerp.x, y: p1.y + offset * unitPerp.y };
      let p2_offset = { x: p2.x + offset * unitPerp.x, y: p2.y + offset * unitPerp.y };
      let sourceNode = graphData.nodes.find(n => n.id === d.source);
      let targetNode = graphData.nodes.find(n => n.id === d.target);
      let r1 = sourceNode ? globalRadiusScale(sourceNode.volume) : 20;
      let r2 = targetNode ? globalRadiusScale(targetNode.volume) : 20;
      const margin = 5;
      let newP1 = { x: p1_offset.x + unit.x * (r1 + margin), y: p1_offset.y + unit.y * (r1 + margin) };
      let newP2 = { x: p2_offset.x - unit.x * (r2 + margin), y: p2_offset.y - unit.y * (r2 + margin) };
      let midX = (newP1.x + newP2.x) / 2;
      let midY = (newP1.y + newP2.y) / 2;
      return "translate(" + (t.x + t.k * midX) + "," + (t.y + t.k * midY - 5) + ")";
    });
}

function updateLinks(t) {
  // Update link line positions
  linkGroup.selectAll("line")
    .attr("x1", d => {
      let p1 = getFixedPos(d.source);
      let p2 = getFixedPos(d.target);
      let dx = p2.x - p1.x, dy = p2.y - p1.y;
      let L = Math.sqrt(dx * dx + dy * dy) || 1;
      let unitPerp = { x: -dy / L, y: dx / L };
      let offset = d.tokenOffset;
      return p1.x + offset * unitPerp.x;
    })
    .attr("y1", d => {
      let p1 = getFixedPos(d.source);
      let p2 = getFixedPos(d.target);
      let dx = p2.x - p1.x, dy = p2.y - p1.y;
      let L = Math.sqrt(dx * dx + dy * dy) || 1;
      let unitPerp = { x: -dy / L, y: dx / L };
      let offset = d.tokenOffset;
      return p1.y + offset * unitPerp.y;
    })
    .attr("x2", d => {
      let p1 = getFixedPos(d.source);
      let p2 = getFixedPos(d.target);
      let dx = p2.x - p1.x, dy = p2.y - p1.y;
      let L = Math.sqrt(dx * dx + dy * dy) || 1;
      let unitPerp = { x: -dy / L, y: dx / L };
      let offset = d.tokenOffset;
      return p2.x + offset * unitPerp.x;
    })
    .attr("y2", d => {
      let p1 = getFixedPos(d.source);
      let p2 = getFixedPos(d.target);
      let dx = p2.x - p1.x, dy = p2.y - p1.y;
      let L = Math.sqrt(dx * dx + dy * dy) || 1;
      let unitPerp = { x: -dy / L, y: dx / L };
      let offset = d.tokenOffset;
      return p2.y + offset * unitPerp.y;
    });

  // Update arrowheads (paths)
  linkGroup.selectAll("path.arrow")
    .attr("d", d => {
      let p1 = getFixedPos(d.source);
      let p2 = getFixedPos(d.target);
      let dx = p2.x - p1.x, dy = p2.y - p1.y, L = Math.sqrt(dx * dx + dy * dy) || 1;
      let unitPerp = { x: -dy / L, y: dx / L };
      let offset = d.tokenOffset;
      let p1_offset = { x: p1.x + offset * unitPerp.x, y: p1.y + offset * unitPerp.y };
      let p2_offset = { x: p2.x + offset * unitPerp.x, y: p2.y + offset * unitPerp.y };
      let sourceNode = graphData.nodes.find(n => n.id === d.source);
      let targetNode = graphData.nodes.find(n => n.id === d.target);
      let r1 = sourceNode ? globalRadiusScale(sourceNode.volume) : 20;
      let r2 = targetNode ? globalRadiusScale(targetNode.volume) : 20;
      const margin = 5;
      return computeMidArrowPath(p1_offset, p2_offset, r1, r2, margin);
    });
}



// ------------------------------
// Arrow Marker Definition (fallback, if needed)
// ------------------------------
if (svg.select("defs").empty()) {
  const defs = svg.append("defs");
  defs.append("marker")
    .attr("id", "arrow")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 10)
    .attr("refY", 0)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-5L10,0L0,5")
    .attr("fill", "#999");
}

// ------------------------------
// ERC20 Token Checkbox Update
// ------------------------------
function updateERC20TokenCheckboxes() {
  console.log("Updating ERC20 token checkboxes");
  const tokens = Array.from(new Set(rawTxData.erc20.map(tx => tx.tokenSymbol)));
  const container = $("#erc20-token-checkboxes");
  container.empty();
  tokens.forEach(token => {
    container.append(`
      <label style="display:inline-block; margin-right:10px;">
        <input type="checkbox" class="erc20-token-checkbox" data-token="${token}" checked />
        ${token}
      </label>
    `);
  });
  $(".erc20-token-checkbox").on("change", function() {
    updateERC20PriceSettings();
    updateVisualization();
  });
}

// ------------------------------
// Time Slider Setup
// ------------------------------
const sliderSVG = d3.select("#time-slider");
const sliderWidth = +sliderSVG.attr("width") - 50;
const sliderHeight = +sliderSVG.attr("height");
const sliderMargin = { top: 20, right: 25, bottom: 20, left: 25 };
const sliderG = sliderSVG.append("g")
  .attr("transform", `translate(${sliderMargin.left},${sliderMargin.top})`);
let xSliderScale = d3.scaleTime().range([0, sliderWidth]);

const brush = d3.brushX()
  .extent([[0, 0], [sliderWidth, sliderHeight - 2 * sliderMargin.top]])
  .on("brush end", function({ selection }) {
    if (selection) {
      const newRange = selection.map(xSliderScale.invert);
      currentTimeRange = newRange.map(d => d.getTime());
      console.log("Brushed time range:", currentTimeRange);
      updateVisualization();
    }
  });

function initTimeSlider() {
  console.log("Initializing time slider...");
  xSliderScale.domain(timeExtent);
  sliderG.select(".x-axis")
      .attr("transform", `translate(0,${sliderHeight - sliderMargin.top - sliderMargin.bottom})`)
      .call(d3.axisBottom(xSliderScale).ticks(5));
  sliderG.selectAll(".brush").remove();
  sliderG.append("g")
      .attr("class", "brush")
      .call(brush)
      .call(brush.move, xSliderScale.range());
}

// ------------------------------
// Loading Message Functions
// ------------------------------
function showLoading(msg) {
  $("#loading-message").show().text(msg);
}
function hideLoading() {
  $("#loading-message").hide();
}

// ------------------------------
// Form Submission & Data Fetching
// ------------------------------
$("#fetch-form").on("submit", function(e) {
  e.preventDefault();
  const wallet = $("#wallet-address").val().trim();
  const startDate = $("#start-date").val().trim();
  const endDate = $("#end-date").val().trim();
  const network = $("#network-select").val();
  
  let apiKey = $("#api-key").val().trim();
  
  if (!wallet || !startDate || !endDate || !apiKey) {
    console.log("Missing input fields");
    return;
  }
  centralWallet = wallet.toLowerCase();
  showLoading("Fetching transactions...");
  
  $.ajax({
    url: "/api/transactions",
    data: { 
      wallet_address: wallet,
      start_date: startDate,
      end_date: endDate,
      network: network,
      api_key: apiKey
    },
    success: function(data) {
      console.log("Fetched transaction data:", data);
      hideLoading();
      rawTxData = data;
      processData();
      initTimeSlider();
      computeFixedPositions();
      updateVisualization();
      updateERC20TokenCheckboxes();
      updateERC20PriceSettings();
    },
    error: function(xhr) {
      console.error("Error fetching transactions:", xhr.responseJSON.error);
      hideLoading();
      alert("Error fetching transactions: " + xhr.responseJSON.error);
    }
  });
});

// ------------------------------
// Filter Controls
// ------------------------------
$(".tx-type, #erc20-token-select, #min-dollar, #eth-price").on("change", function() {
  console.log("Filter controls changed");
  updateTokenPrices();
  updateVisualization();
});

// ------------------------------
// Data Processing
// ------------------------------
function processData() {
  console.log("Processing raw transaction data...");
  const allTx = [
    ...rawTxData.normal,
    ...rawTxData.erc20,
    ...rawTxData.internal
  ].map(tx => {
    tx.timestamp = + (tx.timeStamp || tx.timestamp) * 1000;
    if (isNaN(tx.timestamp)) {
      console.warn("Transaction missing valid timestamp:", tx);
    }
    return tx;
  });
  console.log("Combined transaction count:", allTx.length);
  timeExtent = d3.extent(allTx, d => d.timestamp);
  console.log("Time extent:", timeExtent);
  currentTimeRange = timeExtent.slice();
  
  rawTxData.all = allTx;
  
  globalAllNodes = Array.from(new Set(
    allTx.flatMap(tx => [tx.from.toLowerCase(), tx.to.toLowerCase()])
  ));
  console.log("Global all nodes:", globalAllNodes);
}

// ------------------------------
// Fixed Positions Computation
// ------------------------------
function computeFixedPositions() {
  // Use the default circleRadius (computed as Math.min(width, height)/3)
  // but override with the slider value if edit mode is enabled.
  let radius = circleRadius;
  if ($("#toggle-edit-mode").is(":checked")) {
    radius = +$("#radius-slider").val();
  }
  const sorted = globalAllNodes.slice().sort();
  sorted.forEach((addr, i) => {
    if (addr === centralWallet) {
      fixedPositions[addr] = { x: centerX, y: centerY, angle: null };
    } else {
      // If a manual angle already exists for this bubble, use it; otherwise compute one.
      let computedAngle = (2 * Math.PI * i) / sorted.length;
      if (fixedPositions[addr] && fixedPositions[addr].angle != null) {
        computedAngle = fixedPositions[addr].angle;
      }
      fixedPositions[addr] = {
        x: centerX + radius * Math.cos(computedAngle),
        y: centerY + radius * Math.sin(computedAngle),
        angle: computedAngle
      };
    }
  });
  console.log("Fixed positions computed with radius:", radius, fixedPositions);
}



function getFixedPos(id) {
  if (!fixedPositions[id]) {
    fixedPositions[id] = { x: centerX, y: centerY };
    console.warn("Fixed position missing for", id, "; assigning fallback.");
  }
  return fixedPositions[id];
}

// ------------------------------
// Visualization Update & Fixed Circle Layout
// ------------------------------
function updateVisualization() {
  console.log("Updating visualization with current filters...");
  const threshold = +$("#min-dollar").val() || 0;
  console.log("Minimum Dollar Threshold (aggregated):", threshold);
  
  const selectedTypes = new Set();
  $(".tx-type:checked").each(function() {
    selectedTypes.add($(this).val());
  });
  filteredTxData = rawTxData.all.filter(tx => {
    if (!selectedTypes.has(tx.tx_type)) return false;
    if (tx.tx_type === "erc20") {
      if (!$(`.erc20-token-checkbox[data-token="${tx.tokenSymbol}"]`).is(":checked")) {
        return false;
      }
    }
    if (tx.timestamp < currentTimeRange[0] || tx.timestamp > currentTimeRange[1]) return false;
    
    let rawAmount = +tx.value;
    let amount = rawAmount;
    if (tx.tx_type === "normal" || tx.tx_type === "internal") {
      amount = rawAmount / 1e18;
    } else if (tx.tx_type === "erc20") {
      const decimals = tx.tokenDecimal ? +tx.tokenDecimal : 18;
      amount = rawAmount / Math.pow(10, decimals);
    }
    tx.convertedValue = amount;
    let price = (tx.tx_type === "erc20") ? (tokenPrices[tx.tokenSymbol] || 1) : tokenPrices.ETH;
    tx.dollarValue = amount * price;
    return true;
  });
  console.log("Filtered transaction count:", filteredTxData.length);
  
  const nodeMap = new Map();
  const linkMap = new Map();
  filteredTxData.forEach(tx => {
    const src = tx.from.toLowerCase();
    const tgt = tx.to.toLowerCase();
    if (!nodeMap.has(src)) nodeMap.set(src, { id: src, inflow: 0, outflow: 0 });
    if (!nodeMap.has(tgt)) nodeMap.set(tgt, { id: tgt, inflow: 0, outflow: 0 });
    const token = (tx.tx_type === "erc20") ? tx.tokenSymbol : "ETH";
    const key = `${src}|${tgt}|${token}`;
    if (!linkMap.has(key)) {
      linkMap.set(key, { source: src, target: tgt, token, amount: 0, dollarValue: 0 });
    }
    const link = linkMap.get(key);
    link.amount += tx.convertedValue;
    link.dollarValue += tx.dollarValue;
    nodeMap.get(src).outflow += tx.dollarValue;
    nodeMap.get(tgt).inflow += tx.dollarValue;
  });
  
  nodeMap.forEach(n => {
    n.net = n.inflow - n.outflow;
    n.volume = n.inflow;
  });
  
  const filteredLinks = Array.from(linkMap.values()).filter(l => Math.abs(l.dollarValue) >= threshold);
  nodeMap.forEach((n, id) => {
    if (id !== centralWallet && Math.abs(n.net) < threshold) {
      nodeMap.delete(id);
    }
  });
  
  const allNodes = Array.from(nodeMap.values());
  const visibleNodes = allNodes.filter(n => (n.id === centralWallet) || (!hiddenNodes.has(n.id)));
  const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
  const visibleLinks = filteredLinks.filter(l => visibleNodeIds.has(l.source) && visibleNodeIds.has(l.target));
  
  graphData = { nodes: visibleNodes, links: visibleLinks };
  console.log("Graph data built:", graphData);
  
  updateAddressList(nodeMap);
  
  graphData.nodes.forEach(n => {
    const pos = getFixedPos(n.id);
    n.x = pos.x;
    n.y = pos.y;
  });
  
  graphData.links.forEach(link => {
    let hash = 0;
    for (let i = 0; i < (link.token || "").length; i++) {
      hash += link.token.charCodeAt(i);
    }
    link.tokenOffset = (hash % 20) - 10;
  });
  
  const minInflow = d3.min(graphData.nodes, d => d.volume);
  const maxInflow = d3.max(graphData.nodes, d => d.volume);
  const minRadius = 15, maxRadius = 40;
  if (minInflow === maxInflow) {
    globalRadiusScale = () => 20;
  } else {
    globalRadiusScale = d3.scaleLinear().domain([minInflow, maxInflow]).range([minRadius, maxRadius]);
  }
  
  renderCircleGraph();
  // Immediately update text positions using the current zoom transform.
  const currentTransform = d3.zoomTransform(svg.node());
  updateTextPositions(currentTransform);
}

// ------------------------------
// Helper: Compute Midpoint Arrow Path
// ------------------------------
function computeMidArrowPath(p1, p2, r1, r2, margin) {
  let dx = p2.x - p1.x, dy = p2.y - p1.y;
  let L = Math.sqrt(dx * dx + dy * dy) || 1;
  let newP1 = { x: p1.x + (r1 + margin) * (dx / L), y: p1.y + (r1 + margin) * (dy / L) };
  let newP2 = { x: p2.x - (r2 + margin) * (dx / L), y: p2.y - (r2 + margin) * (dy / L) };
  let mid = { x: (newP1.x + newP2.x) / 2, y: (newP1.y + newP2.y) / 2 };
  const arrowLength = 10, arrowWidth = 6;
  let unit = { x: dx / L, y: dy / L };
  let perp = { x: -unit.y, y: unit.x };
  let tip = { x: mid.x + (arrowLength / 2) * unit.x, y: mid.y + (arrowLength / 2) * unit.y };
  let baseCenter = { x: mid.x - (arrowLength / 2) * unit.x, y: mid.y - (arrowLength / 2) * unit.y };
  let left = { x: baseCenter.x + (arrowWidth / 2) * perp.x, y: baseCenter.y + (arrowWidth / 2) * perp.y };
  let right = { x: baseCenter.x - (arrowWidth / 2) * perp.x, y: baseCenter.y - (arrowWidth / 2) * perp.y };
  return `M${tip.x},${tip.y} L${left.x},${left.y} L${right.x},${right.y} Z`;
}

// ------------------------------
// Render Circle Graph: Nodes, Links, Arrowheads & Labels
// ------------------------------
function renderCircleGraph() {
  console.log("Rendering circle graph...");

  // Clear previous renderings from all layers.
  nodeGroup.selectAll("*").remove();
  linkGroup.selectAll("*").remove();
  nonScalingTextLayer.selectAll("*").remove();

  // Disable pointer events on the non-scaling text layer so that text doesn't block clicks on bubbles.
  nonScalingTextLayer.style("pointer-events", "none");

  // ------------------------------
  // Draw Links (Lines)
  // ------------------------------
  linkGroup.selectAll("line")
    .data(graphData.links)
    .enter()
    .append("line")
    .attr("stroke", "#999")
    .attr("stroke-width", d => {
      const linkExtent = d3.extent(graphData.links, d => d.dollarValue);
      const thicknessScale = d3.scaleLinear().domain(linkExtent).range([1, 8]);
      return thicknessScale(d.dollarValue);
    })
    .attr("x1", d => {
      let p1 = getFixedPos(d.source);
      let p2 = getFixedPos(d.target);
      let dx = p2.x - p1.x, dy = p2.y - p1.y;
      let L = Math.sqrt(dx * dx + dy * dy) || 1;
      let unitPerp = { x: -dy / L, y: dx / L };
      let offset = d.tokenOffset;
      return p1.x + offset * unitPerp.x;
    })
    .attr("y1", d => {
      let p1 = getFixedPos(d.source);
      let p2 = getFixedPos(d.target);
      let dx = p2.x - p1.x, dy = p2.y - p1.y;
      let L = Math.sqrt(dx * dx + dy * dy) || 1;
      let unitPerp = { x: -dy / L, y: dx / L };
      let offset = d.tokenOffset;
      return p1.y + offset * unitPerp.y;
    })
    .attr("x2", d => {
      let p1 = getFixedPos(d.source);
      let p2 = getFixedPos(d.target);
      let dx = p2.x - p1.x, dy = p2.y - p1.y;
      let L = Math.sqrt(dx * dx + dy * dy) || 1;
      let unitPerp = { x: -dy / L, y: dx / L };
      let offset = d.tokenOffset;
      return p2.x + offset * unitPerp.x;
    })
    .attr("y2", d => {
      let p1 = getFixedPos(d.source);
      let p2 = getFixedPos(d.target);
      let dx = p2.x - p1.x, dy = p2.y - p1.y;
      let L = Math.sqrt(dx * dx + dy * dy) || 1;
      let unitPerp = { x: -dy / L, y: dx / L };
      let offset = d.tokenOffset;
      return p2.y + offset * unitPerp.y;
    });

  // ------------------------------
  // Draw Arrowheads (Paths)
  // ------------------------------
  linkGroup.selectAll("path.arrow")
    .data(graphData.links)
    .enter()
    .append("path")
    .attr("class", "arrow")
    .attr("fill", "#999")
    .attr("d", d => {
      let p1 = getFixedPos(d.source);
      let p2 = getFixedPos(d.target);
      let dx = p2.x - p1.x, dy = p2.y - p1.y;
      let L = Math.sqrt(dx * dx + dy * dy) || 1;
      let unitPerp = { x: -dy / L, y: dx / L };
      let offset = d.tokenOffset;
      let p1_offset = { x: p1.x + offset * unitPerp.x, y: p1.y + offset * unitPerp.y };
      let p2_offset = { x: p2.x + offset * unitPerp.x, y: p2.y + offset * unitPerp.y };
      let sourceNode = graphData.nodes.find(n => n.id === d.source);
      let targetNode = graphData.nodes.find(n => n.id === d.target);
      let r1 = sourceNode ? globalRadiusScale(sourceNode.volume) : 20;
      let r2 = targetNode ? globalRadiusScale(targetNode.volume) : 20;
      const margin = 5;
      return computeMidArrowPath(p1_offset, p2_offset, r1, r2, margin);
    });

  // ------------------------------
  // Draw Arrow Labels (Non-Scaling Text Layer)
  // ------------------------------
  let linkLabels = nonScalingTextLayer.selectAll("g.linkLabel")
    .data(graphData.links)
    .enter()
    .append("g")
    .attr("class", "linkLabel")
    .attr("transform", d => {
      let p1 = getFixedPos(d.source);
      let p2 = getFixedPos(d.target);
      let dx = p2.x - p1.x, dy = p2.y - p1.y;
      let L = Math.sqrt(dx * dx + dy * dy) || 1;
      let unit = { x: dx / L, y: dy / L };
      let unitPerp = { x: -dy / L, y: dx / L };
      let offset = d.tokenOffset;
      let p1_offset = { x: p1.x + offset * unitPerp.x, y: p1.y + offset * unitPerp.y };
      let p2_offset = { x: p2.x + offset * unitPerp.x, y: p2.y + offset * unitPerp.y };
      let sourceNode = graphData.nodes.find(n => n.id === d.source);
      let targetNode = graphData.nodes.find(n => n.id === d.target);
      let r1 = sourceNode ? globalRadiusScale(sourceNode.volume) : 20;
      let r2 = targetNode ? globalRadiusScale(targetNode.volume) : 20;
      const margin = 5;
      let newP1 = { x: p1_offset.x + unit.x * (r1 + margin), y: p1_offset.y + unit.y * (r1 + margin) };
      let newP2 = { x: p2_offset.x - unit.x * (r2 + margin), y: p2_offset.y - unit.y * (r2 + margin) };
      let midX = (newP1.x + newP2.x) / 2;
      let midY = (newP1.y + newP2.y) / 2;
      return `translate(${midX},${midY - 5})`;
    });
  linkLabels.append("text")
    .attr("text-anchor", "middle")
    .attr("fill", "#333")
    .attr("font-size", "15px")
    .text(d => d.token + ": " + formatAmount(d.amount) + " ($" + formatAmount(d.dollarValue) + ")");

  // ------------------------------
  // Draw Nodes (Bubbles)
  // ------------------------------
  const bubbles = nodeGroup.selectAll("circle")
    .data(graphData.nodes, d => d.id)
    .enter()
    .append("circle")
    .attr("r", d => globalRadiusScale(d.volume))
    .attr("fill", d => nodeColor(d.id))
    .attr("cx", d => getFixedPos(d.id).x)
    .attr("cy", d => getFixedPos(d.id).y)
    .style("opacity", d => hiddenNodes.has(d.id) ? 0.2 : 1);

  // ------------------------------
  // Conditional Binding for Bubble Events
  // ------------------------------
  if (!manualPositioning) {
    // Normal mode: attach click event to open node details modal.
    bubbles.on("click", (event, d) => {
      openNodeModal(event, d);
    });
  } else {
    // Manual mode: disable click and attach drag behavior.
    bubbles.on("click", null);
    bubbles.call(d3.drag()
      .on("drag", function(event, d) {
        let [mx, my] = d3.pointer(event, svg.node());
        let newAngle = Math.atan2(my - centerY, mx - centerX);
        let currentRadius = circleRadius;
        if ($("#toggle-edit-mode").is(":checked")) {
          currentRadius = +$("#radius-slider").val();
        }
        fixedPositions[d.id] = {
          x: centerX + currentRadius * Math.cos(newAngle),
          y: centerY + currentRadius * Math.sin(newAngle),
          angle: newAngle
        };
        d.x = fixedPositions[d.id].x;
        d.y = fixedPositions[d.id].y;
        d3.select(this)
          .attr("cx", d.x)
          .attr("cy", d.y);
        const currentTransform = d3.zoomTransform(svg.node());
        updateTextPositions(currentTransform);
        updateLinks(currentTransform);
      })
    );
  }

  // ------------------------------
  // Draw Node Labels (Non-Scaling Text Layer)
  // ------------------------------
  const nodeLabelGroups = nonScalingTextLayer.selectAll("g.node-label")
    .data(graphData.nodes, d => d.id)
    .enter()
    .append("g")
    .attr("class", "node-label");

  nodeLabelGroups.append("text")
    .attr("class", "address-label")
    .attr("text-anchor", "middle")
    .attr("dy", "-0.3em")
    .text(d => nicknames[d.id] || d.id.substr(0, 6) + "…" + d.id.substr(-4))
    .style("stroke", "white")
    .style("stroke-width", "2px")
    .style("paint-order", "stroke");

  nodeLabelGroups.append("text")
    .attr("class", "net-label")
    .attr("text-anchor", "middle")
    .attr("dy", "1.2em")
    .text(d => "Net: $" + formatAmount(d.net))
    .style("fill", "yellow")
    .style("stroke", "black")
    .style("stroke-width", "0.5px")
    .style("paint-order", "stroke");

  console.log("Circle graph rendered.");
}



// ------------------------------
// Utility: Node Color
// ------------------------------
function nodeColor(id) {
  return nodeColors[id] || "#69b3a2";
}

// ------------------------------
// ERC20 Token Dropdown & Price Settings
// ------------------------------
function updateERC20TokenDropdown() {
  console.log("Updating ERC20 token dropdown");
  const tokens = Array.from(new Set(rawTxData.erc20.map(tx => tx.tokenSymbol)));
  const select = $("#erc20-token-select");
  select.empty();
  select.append(`<option value="all">All</option>`);
  tokens.forEach(token => {
    select.append(`<option value="${token}">${token}</option>`);
  });
}

function updateERC20PriceSettings() {
  console.log("Updating ERC20 price settings");
  const tokens = Array.from(new Set(rawTxData.erc20.map(tx => tx.tokenSymbol)));
  const container = $("#erc20-prices");
  container.empty();
  tokens.forEach(token => {
    const isChecked = $(`.erc20-token-checkbox[data-token="${token}"]`).is(":checked");
    if (isChecked) {
      if (!tokenPrices[token]) tokenPrices[token] = 1;
      container.append(`
        <label>
          ERC20 Token ${token} Price ($):
          <input type="number" class="token-price" data-token="${token}" value="${tokenPrices[token]}" step="0.01" />
        </label>
      `);
    }
  });
  $(".token-price").on("change", function() {
    const token = $(this).data("token");
    tokenPrices[token] = +$(this).val();
    console.log("Token price updated:", token, tokenPrices[token]);
    updateVisualization();
  });
}

function updateTokenPrices() {
  tokenPrices.ETH = +$("#eth-price").val() || 3000;
  console.log("ETH price updated:", tokenPrices.ETH);
}

// ------------------------------
// Node Modal: Detailed Flows
// ------------------------------
function openNodeModal(event, d) {
  console.log("Node clicked:", d);
  $("#modal-address").text("Address: " + d.id);
  $("#node-nickname").val(nicknames[d.id] || "");
  $("#node-color").val(nodeColors[d.id] || "#ffcc00");
  
  let inflows = {}, outflows = {};
  filteredTxData.forEach(tx => {
    const src = tx.from.toLowerCase();
    const tgt = tx.to.toLowerCase();
    if (tgt === d.id) {
      inflows[tx.tokenSymbol || "ETH"] = (inflows[tx.tokenSymbol || "ETH"] || 0) + tx.convertedValue;
    }
    if (src === d.id) {
      outflows[tx.tokenSymbol || "ETH"] = (outflows[tx.tokenSymbol || "ETH"] || 0) + tx.convertedValue;
    }
  });
  let flowHtml = "<h4>Inflows:</h4><ul>";
  for (let token in inflows) {
    flowHtml += `<li>${token}: ${formatAmount(inflows[token])} ($${formatAmount(inflows[token] * (token==="ETH" ? tokenPrices.ETH : (tokenPrices[token]||1)))})</li>`;
  }
  flowHtml += "</ul><h4>Outflows:</h4><ul>";
  for (let token in outflows) {
    flowHtml += `<li>${token}: ${formatAmount(outflows[token])} ($${formatAmount(outflows[token] * (token==="ETH" ? tokenPrices.ETH : (tokenPrices[token]||1)))})</li>`;
  }
  flowHtml += "</ul>";
  $("#node-summary").html(flowHtml);
  $("#node-modal").css("display", "block").addClass("show").attr("data-node-id", d.id);
}

$(".close-button").on("click", function() {
  console.log("Closing modal");
  $("#node-modal").removeClass("show").css("display", "none");
});

$("#hide-node-button").on("click", function() {
  const nodeId = $("#node-modal").attr("data-node-id");
  console.log("Toggling hide for node:", nodeId);
  if (hiddenNodes.has(nodeId)) {
    hiddenNodes.delete(nodeId);
  } else {
    hiddenNodes.add(nodeId);
  }
  $("#node-modal").css("display", "none");
  updateVisualization();
});

$("#node-nickname, #node-color").on("change", function() {
  const nodeId = $("#node-modal").attr("data-node-id");
  const newNick = $("#node-nickname").val().trim();
  if (newNick) {
    nicknames[nodeId] = newNick;
    console.log("Nickname set for", nodeId, "->", newNick);
  }
  nodeColors[nodeId] = $("#node-color").val();
  updateVisualization();
});

// ------------------------------
// Address List Side Panel (Persistent)
// ------------------------------
function updateAddressList(nodeMap) {
  console.log("Updating address list...");
  const addressVolumes = {};
  globalAllNodes.forEach(addr => { addressVolumes[addr] = 0; });
  Array.from(nodeMap.values()).forEach(n => {
    addressVolumes[n.id] = n.inflow + n.outflow;
  });
  const addresses = globalAllNodes.map(addr => ({
    id: addr,
    volume: addressVolumes[addr] || 0,
    hidden: hiddenNodes.has(addr),
    color: nodeColor(addr)
  }));
  addresses.sort((a, b) => b.volume - a.volume);
  
  const ul = d3.select("#address-ul");
  ul.selectAll("li").remove();
  addresses.forEach(addr => {
    ul.append("li")
      .html(`<span style="display:inline-block; width:12px; height:12px; background:${addr.color}; margin-right:5px;"></span> ${addr.id.substr(0,6)}…${addr.id.substr(-4)} - Vol: $${formatAmount(addr.volume)} - [${addr.hidden ? "Hidden" : "Shown"}]`)
      .style("cursor", "pointer")
      .on("click", function() {
         if (hiddenNodes.has(addr.id)) {
           hiddenNodes.delete(addr.id);
         } else {
           hiddenNodes.add(addr.id);
         }
         updateVisualization();
         updateAddressList(nodeMap);
      });
  });
}

// When the radius slider value changes, update the displayed value and re-layout the bubbles.
$("#radius-slider").on("input", function() {
  $("#radius-value").text($(this).val());
  if ($("#toggle-edit-mode").is(":checked")) {
    computeFixedPositions();
    updateVisualization();
  }
});

// When the edit mode toggle is changed, re-calc positions immediately.
$("#toggle-edit-mode").on("change", function() {
  computeFixedPositions();
  updateVisualization();
});

$("#toggle-positioning").on("click", function() {
  manualPositioning = !manualPositioning;
  if (manualPositioning) {
    // Enter manual mode: change button text and color.
    $(this).text("Save Positioning").css("background-color", "green");
  } else {
    // Exit manual mode: change text back and clear styling.
    $(this).text("Edit Bubble Positions").css("background-color", "");
  }
  updateVisualization();
});


// When the "Reset Positioning" button is clicked, recalc positions from scratch.
$("#reset-positioning").on("click", function() {
  // Clear manual angle data by resetting fixedPositions
  fixedPositions = {};
  computeFixedPositions();
  updateVisualization();
});
