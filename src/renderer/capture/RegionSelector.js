// Runs inside the transparent selector BrowserWindow
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

let startX = 0, startY = 0, endX = 0, endY = 0;
let dragging = false;

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  draw();
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Dark overlay
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!dragging) return;

  const x = Math.min(startX, endX);
  const y = Math.min(startY, endY);
  const w = Math.abs(endX - startX);
  const h = Math.abs(endY - startY);

  if (w < 4 || h < 4) return;

  // Cut out selection
  ctx.clearRect(x, y, w, h);

  // Border
  ctx.strokeStyle = '#00d4ff';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

  // Dimensions label
  ctx.fillStyle = '#00d4ff';
  ctx.font = '12px system-ui, monospace';
  const label = `${w} × ${h}`;
  const lx = x + w / 2 - ctx.measureText(label).width / 2;
  const ly = y > 24 ? y - 8 : y + h + 18;
  ctx.fillText(label, lx, ly);
}

canvas.addEventListener('mousedown', (e) => {
  startX = e.clientX;
  startY = e.clientY;
  endX = e.clientX;
  endY = e.clientY;
  dragging = true;
  draw();
});

canvas.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  endX = e.clientX;
  endY = e.clientY;
  draw();
});

canvas.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;

  const x = Math.min(startX, endX);
  const y = Math.min(startY, endY);
  const w = Math.abs(endX - startX);
  const h = Math.abs(endY - startY);

  if (w < 4 || h < 4) {
    window.screenScope && window.screenScope.cancelRegionSelect?.();
    return;
  }

  const region = {
    x: x / canvas.width,
    y: y / canvas.height,
    width: w / canvas.width,
    height: h / canvas.height,
  };

  // Send result to main process via IPC (exposed through preload)
  if (window.screenScope) {
    window.screenScope.confirmRegion(region);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (window.screenScope) window.screenScope.cancelRegionSelect?.();
  }
});

window.addEventListener('resize', resize);
resize();
