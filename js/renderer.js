import { GRID_SIZE } from './simulation.js';

export class Renderer {
    constructor(canvas, simulation, disasterManager) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.sim = simulation;
        this.disasters = disasterManager;

        // Camera State
        this.zoom = 1.0;
        this.offsetX = canvas.width / 2;
        this.offsetY = canvas.height / 3;
        
        // Grid geometry parameters
        this.tileW = 64; // Isometric tile width
        this.tileH = 32; // Isometric tile height
        this.halfW = 32;
        this.halfH = 16;
        
        // Overlay view state: 'normal', 'power', 'water', 'pollution', 'landvalue'
        this.overlayMode = 'normal';

        // Wind/Cloud particle animation
        this.clouds = [];
        this.initClouds();
    }

    initClouds() {
        for (let i = 0; i < 5; i++) {
            this.clouds.push({
                x: Math.random() * 800 - 400,
                y: Math.random() * 400 - 200,
                vx: Math.random() * 0.2 + 0.1,
                size: Math.random() * 60 + 40,
                opacity: Math.random() * 0.15 + 0.05
            });
        }
    }

    // --- Convert Screen coords to Grid indexes ---
    screenToGrid(screenX, screenY) {
        const xRel = screenX - this.offsetX;
        const yRel = screenY - this.offsetY;

        // Solve equations:
        // xRel = (gridX - gridY) * halfW
        // yRel = (gridX + gridY) * halfH
        const gridX = (xRel / this.halfW + yRel / this.halfH) / 2;
        const gridY = (yRel / this.halfH - xRel / this.halfW) / 2;

        return {
            x: Math.floor(gridX),
            y: Math.floor(gridY)
        };
    }

    // --- Convert Grid indexes to Screen coordinates (Center of Tile) ---
    gridToScreen(gridX, gridY) {
        const x = (gridX - gridY) * this.halfW;
        const y = (gridX + gridY) * this.halfH;
        return {
            x: x + this.offsetX,
            y: y + this.offsetY
        };
    }

    // --- Main Render Cycle ---
    draw() {
        // Clear canvas
        this.ctx.fillStyle = '#07080f'; // Dark space background
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Apply screen shake
        const shake = this.disasters.getShakeOffsets();

        this.ctx.save();
        this.ctx.translate(this.offsetX + shake.x, this.offsetY + shake.y);
        this.ctx.scale(this.zoom, this.zoom);

        // 1. Draw Grid Ground
        this.drawGround();

        // 2. Draw Pipes Grid underlay (Only in water overlay mode)
        if (this.overlayMode === 'water') {
            this.drawWaterPipesGrid();
        }

        // 3. Draw Buildings & Roads (Sorted Depth Order to prevent clipping)
        // Draw layers from back (sum = 0) to front (sum = 2 * (N-1))
        const maxIndex = GRID_SIZE - 1;
        for (let sum = 0; sum <= 2 * maxIndex; sum++) {
            for (let x = 0; x <= sum; x++) {
                const y = sum - x;
                if (x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE) {
                    this.drawTile(x, y);
                }
            }
        }

        // 4. Draw Particles (Smoke, Sparks, Explosions)
        this.drawParticles();

        // 5. Draw Flying Meteors
        this.drawMeteors();

        // 6. Draw Clouds
        this.drawClouds();

        this.ctx.restore();

        // 7. Apply Fullscreen Day/Night Shading Overlay
        this.drawDayNightOverlay();
    }

    // --- Draw Grid Terrain ---
    drawGround() {
        this.ctx.strokeStyle = 'rgba(0, 242, 254, 0.05)';
        this.ctx.lineWidth = 1;

        for (let x = 0; x < GRID_SIZE; x++) {
            for (let y = 0; y < GRID_SIZE; y++) {
                const px = (x - y) * this.halfW;
                const py = (x + y) * this.halfH;

                // Basic grid square outline
                this.ctx.beginPath();
                this.ctx.moveTo(px, py - this.halfH);
                this.ctx.lineTo(px + this.halfW, py);
                this.ctx.lineTo(px, py + this.halfH);
                this.ctx.lineTo(px - this.halfW, py);
                this.ctx.closePath();
                
                // Color ground by value/pollution overlays or standard
                if (this.overlayMode === 'pollution') {
                    const pol = this.sim.grid[x][y].pollution;
                    this.ctx.fillStyle = `rgba(255, 42, 95, ${pol / 150})`;
                } else if (this.overlayMode === 'landvalue') {
                    const val = this.sim.grid[x][y].landValue;
                    this.ctx.fillStyle = `rgba(57, 255, 20, ${val / 300})`;
                } else {
                    this.ctx.fillStyle = '#0a0d1e'; // Grid tile base color
                }
                
                this.ctx.fill();
                this.ctx.stroke();
            }
        }
    }

    // --- Draw Water Pipes Underlay ---
    drawWaterPipesGrid() {
        this.ctx.strokeStyle = 'rgba(0, 153, 255, 0.4)';
        this.ctx.lineWidth = 2;

        for (let x = 0; x < GRID_SIZE; x++) {
            for (let y = 0; y < GRID_SIZE; y++) {
                const tile = this.sim.grid[x][y];
                if (tile.type === 'waterpipe') {
                    const px = (x - y) * this.halfW;
                    const py = (x + y) * this.halfH;

                    // Draw vertical or horizontal line segments if adjacent pipes connect
                    const neighbors = this.sim.getNeighbors(x, y);
                    for (const n of neighbors) {
                        if (n.type === 'waterpipe' || n.type === 'watertower') {
                            const npx = (n.x - n.y) * this.halfW;
                            const npy = (n.x + n.y) * this.halfH;
                            this.ctx.beginPath();
                            this.ctx.moveTo(px, py);
                            this.ctx.lineTo(npx, npy);
                            this.ctx.stroke();
                        }
                    }
                }
            }
        }
    }

    // --- Render Individual Tile Assets & 3D Structures ---
    drawTile(x, y) {
        const tile = this.sim.grid[x][y];
        const px = (x - y) * this.halfW;
        const py = (x + y) * this.halfH;

        if (tile.type === 'empty' && !tile.rubble) return;

        // 1. Draw Rubble (Burnt down / collapsed ruins)
        if (tile.rubble) {
            this.drawIsometricBox(px, py, 4, 32, '#4a4a4a', '#363636', '#5c5c5c');
            // Draw some cross rods
            this.ctx.strokeStyle = '#222';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(px - 10, py - 4);
            this.ctx.lineTo(px + 10, py - 12);
            this.ctx.moveTo(px - 8, py - 10);
            this.ctx.lineTo(px + 6, py - 2);
            this.ctx.stroke();
            return;
        }

        // 2. Draw Road
        if (tile.type === 'road') {
            this.ctx.fillStyle = '#1c2033'; // Asphalt slate
            this.ctx.beginPath();
            this.ctx.moveTo(px, py - this.halfH + 1);
            this.ctx.lineTo(px + this.halfW - 1, py);
            this.ctx.lineTo(px, py + this.halfH - 1);
            this.ctx.lineTo(px - this.halfW + 1, py);
            this.ctx.closePath();
            this.ctx.fill();

            // Draw road lanes connections to neighbors
            this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            this.ctx.lineWidth = 1;
            const neighbors = this.sim.getNeighbors(x, y);
            for (const n of neighbors) {
                if (n.type === 'road') {
                    const npx = (n.x - n.y) * this.halfW;
                    const npy = (n.x + n.y) * this.halfH;
                    this.ctx.beginPath();
                    this.ctx.moveTo(px, py);
                    this.ctx.lineTo((px + npx) / 2, (py + npy) / 2);
                    this.ctx.stroke();
                }
            }
            return;
        }

        // 3. Draw Power Line
        if (tile.type === 'powerline') {
            // Draw pylon pole
            this.ctx.strokeStyle = '#718096';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(px, py);
            this.ctx.lineTo(px, py - 24);
            this.ctx.stroke();

            // Cross beam
            this.ctx.beginPath();
            this.ctx.moveTo(px - 8, py - 20);
            this.ctx.lineTo(px + 8, py - 20);
            this.ctx.stroke();

            // Draw glowing electricity line details if powered
            if (tile.powered && this.overlayMode === 'power') {
                this.ctx.strokeStyle = '#00f2fe';
                this.ctx.shadowBlur = 4;
                this.ctx.shadowColor = '#00f2fe';
                
                const neighbors = this.sim.getNeighbors(x, y);
                for (const n of neighbors) {
                    if (n.type === 'powerline' || n.type === 'powerplant') {
                        const npx = (n.x - n.y) * this.halfW;
                        const npy = (n.x + n.y) * this.halfH;
                        this.ctx.beginPath();
                        this.ctx.moveTo(px, py - 20);
                        this.ctx.lineTo(npx, npy - 20);
                        this.ctx.stroke();
                    }
                }
                this.ctx.shadowBlur = 0; // reset
            }
            return;
        }

        // 4. Draw Water Pipe (when inspected/water view)
        if (tile.type === 'waterpipe') {
            // Draw small valve marker above ground
            this.ctx.fillStyle = '#0099ff';
            this.ctx.beginPath();
            this.ctx.arc(px, py, 3, 0, Math.PI * 2);
            this.ctx.fill();
            return;
        }

        // 5. Draw Parks
        if (tile.type === 'park') {
            this.ctx.fillStyle = '#1e3a1e'; // Green base
            this.ctx.beginPath();
            this.ctx.moveTo(px, py - this.halfH);
            this.ctx.lineTo(px + this.halfW, py);
            this.ctx.lineTo(px, py + this.halfH);
            this.ctx.lineTo(px - this.halfW, py);
            this.ctx.closePath();
            this.ctx.fill();

            // Draw procedural trees
            this.ctx.fillStyle = '#10b981';
            this.ctx.beginPath();
            this.ctx.arc(px - 8, py - 4, 6, 0, Math.PI * 2);
            this.ctx.arc(px + 8, py - 2, 7, 0, Math.PI * 2);
            this.ctx.arc(px, py - 8, 8, 0, Math.PI * 2);
            this.ctx.fill();
            return;
        }

        // 6. Draw Power Plant (Coal/Burner style)
        if (tile.type === 'powerplant') {
            this.drawIsometricBox(px, py, 26, 44, '#334155', '#1e293b', '#475569');
            // Smoke stack stack
            this.drawIsometricBox(px + 10, py - 10, 36, 12, '#64748b', '#475569', '#94a3b8');
            // Glow indicator
            if (tile.powered) {
                this.ctx.fillStyle = '#ff7b00';
                this.ctx.shadowBlur = 8;
                this.ctx.shadowColor = '#ff7b00';
                this.ctx.beginPath();
                this.ctx.arc(px - 10, py - 15, 3, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.shadowBlur = 0;
            }
            return;
        }

        // 7. Draw Water Tower
        if (tile.type === 'watertower') {
            // Legs
            this.ctx.strokeStyle = '#94a3b8';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(px - 10, py);
            this.ctx.lineTo(px, py - 30);
            this.ctx.moveTo(px + 10, py);
            this.ctx.lineTo(px, py - 30);
            this.ctx.moveTo(px, py + 8);
            this.ctx.lineTo(px, py - 30);
            this.ctx.stroke();

            // Sphere tank
            const grad = this.ctx.createRadialGradient(px - 4, py - 34, 2, px, py - 30, 12);
            grad.addColorStop(0, '#00d2ff');
            grad.addColorStop(1, '#0066cc');
            this.ctx.fillStyle = grad;
            this.ctx.beginPath();
            this.ctx.arc(px, py - 30, 12, 0, Math.PI * 2);
            this.ctx.fill();
            return;
        }

        // 8. Draw Police Station
        if (tile.type === 'police') {
            this.drawIsometricBox(px, py, 24, 36, '#1e3a8a', '#172554', '#2563eb');
            // Red/blue siren flashing
            const flasher = (Date.now() % 500 < 250) ? '#ef4444' : '#3b82f6';
            this.ctx.fillStyle = flasher;
            this.ctx.beginPath();
            this.ctx.arc(px, py - 26, 4, 0, Math.PI * 2);
            this.ctx.fill();
            return;
        }

        // 9. Draw Fire Station
        if (tile.type === 'fire') {
            this.drawIsometricBox(px, py, 22, 36, '#991b1b', '#450a0a', '#dc2626');
            // Garage doors
            this.ctx.fillStyle = '#e2e8f0';
            this.ctx.beginPath();
            this.ctx.moveTo(px - 8, py - 5);
            this.ctx.lineTo(px - 2, py - 2);
            this.ctx.lineTo(px - 2, py - 12);
            this.ctx.lineTo(px - 8, py - 15);
            this.ctx.closePath();
            this.ctx.fill();
            return;
        }

        // 10. Draw Development Zones: Residential, Commercial, Industrial
        const isZone = ['residential', 'commercial', 'industrial'].includes(tile.type);
        if (isZone) {
            // Draw empty zones flat borders
            if (tile.density === 0) {
                let borderCol = 'rgba(57, 255, 20, 0.4)'; // green
                if (tile.type === 'commercial') borderCol = 'rgba(0, 153, 255, 0.4)'; // blue
                if (tile.type === 'industrial') borderCol = 'rgba(255, 183, 0, 0.4)'; // yellow
                if (tile.abandoned) borderCol = 'rgba(100, 100, 100, 0.3)';

                this.ctx.strokeStyle = borderCol;
                this.ctx.lineWidth = 2;
                this.ctx.beginPath();
                this.ctx.moveTo(px, py - this.halfH + 2);
                this.ctx.lineTo(px + this.halfW - 2, py);
                this.ctx.lineTo(px, py + this.halfH - 2);
                this.ctx.lineTo(px - this.halfW + 2, py);
                this.ctx.closePath();
                this.ctx.stroke();
                return;
            }

            // Draw Zoned Buildings of varied densities (Stage 1 to 4)
            let colorLeft = '', colorRight = '', colorTop = '';
            if (tile.abandoned) {
                colorLeft = '#475569'; colorRight = '#334155'; colorTop = '#1e293b';
            } else if (tile.type === 'residential') {
                const greens = [
                    ['#064e3b', '#022c22', '#059669'], // Low density
                    ['#047857', '#064e3b', '#10b981'],
                    ['#059669', '#047857', '#34d399'],
                    ['#10b981', '#059669', '#6ee7b7']  // Skyscraper
                ];
                [colorLeft, colorRight, colorTop] = greens[tile.density - 1];
            } else if (tile.type === 'commercial') {
                const blues = [
                    ['#1e3a8a', '#172554', '#2563eb'],
                    ['#1d4ed8', '#1e3a8a', '#3b82f6'],
                    ['#2563eb', '#1d4ed8', '#60a5fa'],
                    ['#3b82f6', '#2563eb', '#93c5fd']
                ];
                [colorLeft, colorRight, colorTop] = blues[tile.density - 1];
            } else if (tile.type === 'industrial') {
                const yellows = [
                    ['#78350f', '#451a03', '#d97706'],
                    ['#b45309', '#78350f', '#f59e0b'],
                    ['#d97706', '#b45309', '#fbbf24'],
                    ['#f59e0b', '#d97706', '#fcd34d']
                ];
                [colorLeft, colorRight, colorTop] = yellows[tile.density - 1];
            }

            // Set height based on density stages
            const h = tile.density * 14 + 10;
            const w = 26 - tile.density * 2; // Make taller buildings thinner for city layout look

            this.drawIsometricBox(px, py, h, w, colorLeft, colorRight, colorTop);

            // Draw window grids / night lights
            if (!tile.abandoned && tile.powered) {
                const isNight = this.sim.date.getHours() >= 20 || this.sim.date.getHours() < 5;
                if (isNight) {
                    this.ctx.fillStyle = '#fffb80'; // warm window glow
                    
                    // Render simple glowing window dots on building faces
                    const leftFaceCols = tile.density;
                    for (let fh = 8; fh < h - 4; fh += 12) {
                        for (let fw = -w/2 + 4; fw < 0; fw += 6) {
                            this.ctx.fillRect(px + fw, py - fh, 2, 2);
                        }
                        for (let fw = 4; fw < w/2 - 4; fw += 6) {
                            this.ctx.fillRect(px + fw, py - fh, 2, 2);
                        }
                    }
                }
            }
        }

        // 11. Draw Fire Particle Indicators
        if (tile.fireActive) {
            const timeVal = Date.now() % 400;
            this.ctx.fillStyle = timeVal < 200 ? '#ff3300' : '#ff9900';
            this.ctx.beginPath();
            this.ctx.arc(px, py - 15, 8 + Math.sin(Date.now() / 50) * 2, 0, Math.PI * 2);
            this.ctx.fill();
        }

        // 12. Utilities overlays overlaying buildings (glowing dots)
        if (this.overlayMode === 'power' && !tile.powered) {
            // Draw blinking NO POWER icon
            if (Date.now() % 1000 < 500) {
                this.ctx.fillStyle = '#ff2a5f';
                this.ctx.font = '10px Arial';
                this.ctx.fillText('⚡', px - 5, py - 30);
            }
        }
        if (this.overlayMode === 'water' && !tile.watered) {
            // Draw blinking NO WATER icon
            if (Date.now() % 1000 < 500) {
                this.ctx.fillStyle = '#0099ff';
                this.ctx.font = '10px Arial';
                this.ctx.fillText('💧', px - 5, py - 40);
            }
        }
    }

    // --- Draw Mathematical 3D Isometric Prism ---
    drawIsometricBox(cx, cy, h, w, colorLeft, colorRight, colorTop) {
        const halfw = w / 2;
        const halfh = w / 4;

        // Bottom Diamond Points
        const bBottom = { x: cx, y: cy };
        const bRight = { x: cx + halfw, y: cy - halfh };
        const bTop = { x: cx, y: cy - 2 * halfh };
        const bLeft = { x: cx - halfw, y: cy - halfh };

        // Top Diamond Points (Offset upwards by height 'h')
        const tBottom = { x: cx, y: cy - h };
        const tRight = { x: cx + halfw, y: cy - halfh - h };
        const tTop = { x: cx, y: cy - 2 * halfh - h };
        const tLeft = { x: cx - halfw, y: cy - halfh - h };

        // Draw Left Face
        this.ctx.fillStyle = colorLeft;
        this.ctx.beginPath();
        this.ctx.moveTo(bBottom.x, bBottom.y);
        this.ctx.lineTo(bLeft.x, bLeft.y);
        this.ctx.lineTo(tLeft.x, tLeft.y);
        this.ctx.lineTo(tBottom.x, tBottom.y);
        this.ctx.closePath();
        this.ctx.fill();

        // Draw Right Face
        this.ctx.fillStyle = colorRight;
        this.ctx.beginPath();
        this.ctx.moveTo(bBottom.x, bBottom.y);
        this.ctx.lineTo(bRight.x, bRight.y);
        this.ctx.lineTo(tRight.x, tRight.y);
        this.ctx.lineTo(tBottom.x, tBottom.y);
        this.ctx.closePath();
        this.ctx.fill();

        // Draw Top Face
        this.ctx.fillStyle = colorTop;
        this.ctx.beginPath();
        this.ctx.moveTo(tBottom.x, tBottom.y);
        this.ctx.lineTo(tRight.x, tRight.y);
        this.ctx.lineTo(tTop.x, tTop.y);
        this.ctx.lineTo(tLeft.x, tLeft.y);
        this.ctx.closePath();
        this.ctx.fill();
    }

    // --- Draw Particles ---
    drawParticles() {
        for (const p of this.disasters.particles) {
            this.ctx.fillStyle = p.color;
            this.ctx.globalAlpha = p.getAlpha();
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, Math.max(1, p.life / 6), 0, Math.PI * 2);
            this.ctx.fill();
        }
        this.ctx.globalAlpha = 1.0; // Reset
    }

    // --- Draw Meteors ---
    drawMeteors() {
        for (const m of this.disasters.activeMeteors) {
            this.ctx.fillStyle = '#ff6200';
            this.ctx.beginPath();
            this.ctx.arc(m.x, m.y, 8, 0, Math.PI * 2);
            this.ctx.fill();

            // Flare ring
            this.ctx.strokeStyle = '#ffcc00';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.arc(m.x, m.y, 14, 0, Math.PI * 2);
            this.ctx.stroke();
        }
    }

    // --- Draw Clouds ---
    drawClouds() {
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        for (const c of this.clouds) {
            // Update cloud horizontal drifting
            c.x += c.vx;
            if (c.x > 800) c.x = -800; // loop wrap

            this.ctx.fillStyle = `rgba(255, 255, 255, ${c.opacity})`;
            this.ctx.beginPath();
            this.ctx.arc(c.x, c.y, c.size, 0, Math.PI * 2);
            this.ctx.arc(c.x - c.size * 0.5, c.y + c.size * 0.1, c.size * 0.7, 0, Math.PI * 2);
            this.ctx.arc(c.x + c.size * 0.6, c.y + c.size * 0.1, c.size * 0.6, 0, Math.PI * 2);
            this.ctx.fill();
        }
    }

    // --- Day/Night Cycle Shading Overlay ---
    drawDayNightOverlay() {
        const hour = this.sim.date.getHours();
        const mins = this.sim.date.getMinutes();
        const totalHour = hour + mins / 60;

        let r = 0, g = 0, b = 0, alpha = 0;
        let mixMode = 'source-over';

        // 8 PM to 5 AM: Night overlay
        if (totalHour >= 20 || totalHour < 5) {
            r = 10; g = 15; b = 45;
            alpha = 0.50; // Moderate dark
            mixMode = 'multiply';
        }
        // 5 AM to 7 AM: Sunrise
        else if (totalHour >= 5 && totalHour < 7) {
            const factor = (totalHour - 5) / 2; // 0 to 1
            // Interpolate night to daylight values
            r = Math.round(10 + (235 - 10) * (1 - factor));
            g = Math.round(15 + (120 - 15) * (1 - factor));
            b = Math.round(45 + (80 - 45) * (1 - factor));
            alpha = 0.5 * (1 - factor);
            mixMode = 'source-over';
        }
        // 7 AM to 5 PM: Normal bright daylight
        else if (totalHour >= 7 && totalHour < 17) {
            alpha = 0;
        }
        // 5 PM to 8 PM: Sunset golden/pink
        else if (totalHour >= 17 && totalHour < 20) {
            const factor = (totalHour - 17) / 3; // 0 to 1
            r = Math.round(180 * factor);
            g = Math.round(60 * factor);
            b = Math.round(120 * factor);
            alpha = 0.3 * factor;
            mixMode = 'source-over';
        }

        if (alpha > 0) {
            this.ctx.save();
            this.ctx.globalCompositeOperation = mixMode;
            this.ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.restore();
        }
    }
}
