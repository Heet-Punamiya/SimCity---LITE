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

        // Hover & Preview state
        this.hoverX = null;
        this.hoverY = null;
        this.selectedTool = 'select';
        this.selectedCost = 0;

        // Wind/Cloud particle animation
        this.clouds = [];
        this.initClouds();
    }

    initClouds() {
        for (let i = 0; i < 6; i++) {
            this.clouds.push({
                x: Math.random() * 1200 - 600,
                y: Math.random() * 600 - 300,
                vx: Math.random() * 0.15 + 0.08,
                size: Math.random() * 70 + 40,
                opacity: Math.random() * 0.12 + 0.04
            });
        }
    }

    // --- Convert Screen coords to Grid indexes ---
    screenToGrid(screenX, screenY) {
        const xRel = screenX - this.offsetX;
        const yRel = screenY - this.offsetY;

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
        // Clear canvas with deep tech background
        this.ctx.fillStyle = '#090b16'; 
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Apply screen shake
        const shake = this.disasters.getShakeOffsets();

        this.ctx.save();
        this.ctx.translate(this.offsetX + shake.x, this.offsetY + shake.y);
        this.ctx.scale(this.zoom, this.zoom);

        // 1. Draw Grid Ground and Outline
        this.drawGround();

        // 2. Draw Pipes Grid underlay (Only in water overlay mode)
        if (this.overlayMode === 'water') {
            this.drawWaterPipesGrid();
        }

        // 3. Draw Buildings & Roads (Sorted Depth Order to prevent clipping)
        const maxIndex = GRID_SIZE - 1;
        for (let sum = 0; sum <= 2 * maxIndex; sum++) {
            for (let x = 0; x <= sum; x++) {
                const y = sum - x;
                if (x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE) {
                    this.drawTile(x, y);
                }
            }
        }

        // 4. Draw Build Preview and Hover Highlight
        this.drawHoverPreview();

        // 5. Draw Particles (Smoke, Sparks, Explosions)
        this.drawParticles();

        // 6. Draw Flying Meteors
        this.drawMeteors();

        // 7. Draw Clouds
        this.drawClouds();

        this.ctx.restore();

        // 8. Apply Fullscreen Day/Night Shading Overlay
        this.drawDayNightOverlay();
    }

    // --- Draw Terrain Ground ---
    drawGround() {
        // High visibility grid line styling
        this.ctx.strokeStyle = 'rgba(0, 242, 254, 0.15)'; 
        this.ctx.lineWidth = 1;

        // Draw active building tiles
        for (let x = 0; x < GRID_SIZE; x++) {
            for (let y = 0; y < GRID_SIZE; y++) {
                const px = (x - y) * this.halfW;
                const py = (x + y) * this.halfH;

                this.ctx.beginPath();
                this.ctx.moveTo(px, py - this.halfH);
                this.ctx.lineTo(px + this.halfW, py);
                this.ctx.lineTo(px, py + this.halfH);
                this.ctx.lineTo(px - this.halfW, py);
                this.ctx.closePath();
                
                // Color ground by value/pollution overlays or standard
                if (this.overlayMode === 'pollution') {
                    const pol = this.sim.grid[x][y].pollution;
                    this.ctx.fillStyle = `rgba(255, 42, 95, ${pol / 130})`;
                } else if (this.overlayMode === 'landvalue') {
                    const val = this.sim.grid[x][y].landValue;
                    this.ctx.fillStyle = `rgba(57, 255, 20, ${val / 220})`;
                } else {
                    this.ctx.fillStyle = '#0f132a'; // Slightly lighter base slate for visibility
                }
                
                this.ctx.fill();
                this.ctx.stroke();
            }
        }

        // Draw prominent neon border around the entire 20x20 grid
        this.ctx.strokeStyle = 'rgba(0, 242, 254, 0.4)';
        this.ctx.lineWidth = 3;
        this.ctx.beginPath();
        this.ctx.moveTo(0, -this.halfH); // top
        this.ctx.lineTo(GRID_SIZE * this.halfW, (GRID_SIZE - 1) * this.halfH); // right
        this.ctx.lineTo(0, (2 * GRID_SIZE - 1) * this.halfH); // bottom
        this.ctx.lineTo(-GRID_SIZE * this.halfW, (GRID_SIZE - 1) * this.halfH); // left
        this.ctx.closePath();
        this.ctx.stroke();
    }

    // --- Draw Real-life 3D Utility Pipes ---
    drawWaterPipesGrid() {
        for (let x = 0; x < GRID_SIZE; x++) {
            for (let y = 0; y < GRID_SIZE; y++) {
                const tile = this.sim.grid[x][y];
                if (tile.type === 'waterpipe') {
                    const px = (x - y) * this.halfW;
                    const py = (x + y) * this.halfH;

                    const neighbors = this.sim.getNeighbors(x, y);
                    for (const n of neighbors) {
                        if (n.type === 'waterpipe' || n.type === 'watertower') {
                            const npx = (n.x - n.y) * this.halfW;
                            const npy = (n.x + n.y) * this.halfH;
                            
                            // Draw 3D glowing blue cylinder pipe
                            this.ctx.save();
                            const grad = this.ctx.createLinearGradient(px, py - 3, npx, npy + 3);
                            grad.addColorStop(0, '#00d2ff');
                            grad.addColorStop(0.5, '#00f2fe');
                            grad.addColorStop(1, '#0055bb');
                            
                            this.ctx.strokeStyle = grad;
                            this.ctx.lineWidth = 4;
                            this.ctx.shadowBlur = 6;
                            this.ctx.shadowColor = '#00f2fe';
                            
                            this.ctx.beginPath();
                            this.ctx.moveTo(px, py);
                            this.ctx.lineTo(npx, npy);
                            this.ctx.stroke();
                            
                            // Core white flow line
                            this.ctx.strokeStyle = '#ffffff';
                            this.ctx.lineWidth = 1;
                            this.ctx.shadowBlur = 0;
                            this.ctx.beginPath();
                            this.ctx.moveTo(px, py);
                            this.ctx.lineTo(npx, npy);
                            this.ctx.stroke();
                            
                            this.ctx.restore();
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

        // 1. Draw Rubble
        if (tile.rubble) {
            this.drawIsometricBox(px, py, 5, 28, '#3d4049', '#2a2c33', '#4e515d');
            // Rebars sticking out
            this.ctx.strokeStyle = '#555';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(px - 6, py - 3);
            this.ctx.lineTo(px - 14, py - 12);
            this.ctx.moveTo(px + 4, py - 4);
            this.ctx.lineTo(px + 10, py - 16);
            this.ctx.stroke();
            return;
        }

        // 2. Draw Realistic Roads (Auto-connecting asphalt slabs with yellow stripes)
        if (tile.type === 'road') {
            // Draw base asphalt slab
            this.ctx.fillStyle = '#1e212d'; 
            this.ctx.beginPath();
            this.ctx.moveTo(px, py - this.halfH + 1);
            this.ctx.lineTo(px + this.halfW - 1, py);
            this.ctx.lineTo(px, py + this.halfH - 1);
            this.ctx.lineTo(px - this.halfW + 1, py);
            this.ctx.closePath();
            this.ctx.fill();

            // Concrete side curbs
            this.ctx.strokeStyle = '#5c6479';
            this.ctx.lineWidth = 1.5;
            this.ctx.beginPath();
            this.ctx.moveTo(px - this.halfW + 1, py);
            this.ctx.lineTo(px, py - this.halfH + 1);
            this.ctx.lineTo(px + this.halfW - 1, py);
            this.ctx.moveTo(px - this.halfW + 1, py);
            this.ctx.lineTo(px, py + this.halfH - 1);
            this.ctx.lineTo(px + this.halfW - 1, py);
            this.ctx.stroke();

            // Tiling connections
            const nRoad = (x > 0 && ['road', 'powerplant', 'watertower', 'police', 'fire'].includes(this.sim.grid[x-1][y].type));
            const sRoad = (x < GRID_SIZE - 1 && ['road', 'powerplant', 'watertower', 'police', 'fire'].includes(this.sim.grid[x+1][y].type));
            const eRoad = (y > 0 && ['road', 'powerplant', 'watertower', 'police', 'fire'].includes(this.sim.grid[x][y-1].type));
            const wRoad = (y < GRID_SIZE - 1 && ['road', 'powerplant', 'watertower', 'police', 'fire'].includes(this.sim.grid[x][y+1].type));

            this.ctx.strokeStyle = '#f59e0b'; // Double yellow center line
            this.ctx.lineWidth = 1;
            
            // Draw lanes matching connections
            if (nRoad) {
                this.ctx.beginPath(); this.ctx.moveTo(px, py); this.ctx.lineTo(px - this.halfW / 2, py - this.halfH / 2); this.ctx.stroke();
            }
            if (sRoad) {
                this.ctx.beginPath(); this.ctx.moveTo(px, py); this.ctx.lineTo(px + this.halfW / 2, py + this.halfH / 2); this.ctx.stroke();
            }
            if (eRoad) {
                this.ctx.beginPath(); this.ctx.moveTo(px, py); this.ctx.lineTo(px + this.halfW / 2, py - this.halfH / 2); this.ctx.stroke();
            }
            if (wRoad) {
                this.ctx.beginPath(); this.ctx.moveTo(px, py); this.ctx.lineTo(px - this.halfW / 2, py + this.halfH / 2); this.ctx.stroke();
            }
            return;
        }

        // 3. Draw Realistic Power Lines with Sagging Cables
        if (tile.type === 'powerline') {
            // Draw steel lattice structure
            this.ctx.strokeStyle = '#4a5568';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            // Pylon base legs
            this.ctx.moveTo(px - 6, py); this.ctx.lineTo(px, py - 26);
            this.ctx.moveTo(px + 6, py); this.ctx.lineTo(px, py - 26);
            this.ctx.moveTo(px, py + 3); this.ctx.lineTo(px, py - 26);
            this.ctx.stroke();

            // Double crossarms
            this.ctx.lineWidth = 1.5;
            this.ctx.beginPath();
            this.ctx.moveTo(px - 12, py - 22); this.ctx.lineTo(px + 12, py - 22);
            this.ctx.moveTo(px - 8, py - 14); this.ctx.lineTo(px + 8, py - 14);
            this.ctx.stroke();

            // Draw glowing electrical lines with catenary curves
            if (tile.powered && this.overlayMode === 'power') {
                this.ctx.strokeStyle = '#00f2fe';
                this.ctx.shadowBlur = 6;
                this.ctx.shadowColor = '#00f2fe';
                this.ctx.lineWidth = 1;
                
                const neighbors = this.sim.getNeighbors(x, y);
                for (const n of neighbors) {
                    if (n.type === 'powerline' || n.type === 'powerplant') {
                        const npx = (n.x - n.y) * this.halfW;
                        const npy = (n.x + n.y) * this.halfH;
                        
                        // Sag curve calculations
                        const midX = (px + npx) / 2;
                        const midY = (py - 22 + npy - 22) / 2 + 5; // Sag downward offset

                        this.ctx.beginPath();
                        this.ctx.moveTo(px, py - 22);
                        this.ctx.quadraticCurveTo(midX, midY, npx, npy - 22);
                        this.ctx.stroke();
                    }
                }
                this.ctx.shadowBlur = 0; 
            }
            return;
        }

        // 4. Draw Water Pipe Valve above ground
        if (tile.type === 'waterpipe') {
            this.ctx.fillStyle = '#00f2fe';
            this.ctx.shadowBlur = 4;
            this.ctx.shadowColor = '#00f2fe';
            this.ctx.beginPath();
            this.ctx.arc(px, py, 4, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.shadowBlur = 0;
            return;
        }

        // 5. Draw Parks
        if (tile.type === 'park') {
            // Dark lawn grass base
            this.ctx.fillStyle = '#223d24'; 
            this.ctx.beginPath();
            this.ctx.moveTo(px, py - this.halfH);
            this.ctx.lineTo(px + this.halfW, py);
            this.ctx.lineTo(px, py + this.halfH);
            this.ctx.lineTo(px - this.halfW, py);
            this.ctx.closePath();
            this.ctx.fill();

            // Concrete walk lines
            this.ctx.strokeStyle = '#4a5568';
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.moveTo(px - this.halfW, py);
            this.ctx.lineTo(px + this.halfW, py);
            this.ctx.moveTo(px, py - this.halfH);
            this.ctx.lineTo(px, py + this.halfH);
            this.ctx.stroke();

            // Trees
            this.ctx.fillStyle = '#059669';
            this.ctx.beginPath();
            this.ctx.arc(px - 10, py - 2, 5, 0, Math.PI * 2);
            this.ctx.arc(px + 10, py - 4, 6, 0, Math.PI * 2);
            this.ctx.arc(px, py - 10, 7, 0, Math.PI * 2);
            this.ctx.fill();
            return;
        }

        // 6. Draw Power Plant (Coal/Burner style)
        if (tile.type === 'powerplant') {
            // Main structure
            this.drawIsometricBox(px, py, 26, 44, '#334155', '#1e293b', '#475569');
            
            // Cooling chimney with structural grid lines
            this.drawIsometricBox(px + 10, py - 10, 36, 14, '#475569', '#334155', '#64748b');
            
            // Top rim of the chimney
            this.ctx.fillStyle = '#b91c1c'; // Red paint rim
            this.ctx.beginPath();
            this.ctx.ellipse(px + 10, py - 46, 7, 3.5, 0, 0, Math.PI * 2);
            this.ctx.fill();

            // Generator exhaust boxes
            this.drawIsometricBox(px - 12, py + 4, 12, 14, '#2d3748', '#1a202c', '#4a5568');

            if (tile.powered) {
                // Glow indicator lamp
                this.ctx.fillStyle = '#10b981'; // Green active light
                this.ctx.shadowBlur = 8;
                this.ctx.shadowColor = '#10b981';
                this.ctx.beginPath();
                this.ctx.arc(px - 12, py - 4, 3, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.shadowBlur = 0;
            }
            return;
        }

        // 7. Draw Water Tower
        if (tile.type === 'watertower') {
            // Metal framework legs
            this.ctx.strokeStyle = '#5c6b80';
            this.ctx.lineWidth = 2.5;
            this.ctx.beginPath();
            this.ctx.moveTo(px - 8, py); this.ctx.lineTo(px, py - 30);
            this.ctx.moveTo(px + 8, py); this.ctx.lineTo(px, py - 30);
            this.ctx.moveTo(px, py + 6); this.ctx.lineTo(px, py - 30);
            this.ctx.stroke();

            // Spherical tank structure
            const grad = this.ctx.createRadialGradient(px - 4, py - 33, 2, px, py - 30, 11);
            grad.addColorStop(0, '#00f2fe');
            grad.addColorStop(1, '#0044aa');
            this.ctx.fillStyle = grad;
            this.ctx.beginPath();
            this.ctx.arc(px, py - 30, 11, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Top beacon lamp
            this.ctx.fillStyle = '#ef4444';
            this.ctx.beginPath();
            this.ctx.arc(px, py - 41, 2, 0, Math.PI * 2);
            this.ctx.fill();
            return;
        }

        // 8. Draw Police Station
        if (tile.type === 'police') {
            this.drawIsometricBox(px, py, 25, 36, '#1e3a8a', '#172554', '#2563eb');
            // Blue/red glowing stripes
            this.ctx.fillStyle = '#1d4ed8';
            this.ctx.fillRect(px - 16, py - 18, 4, 8);
            this.ctx.fillStyle = '#3b82f6';
            this.ctx.fillRect(px + 12, py - 15, 4, 8);

            // Flasher
            const flasher = (Date.now() % 400 < 200) ? '#3b82f6' : '#ef4444';
            this.ctx.fillStyle = flasher;
            this.ctx.shadowBlur = 6;
            this.ctx.shadowColor = flasher;
            this.ctx.beginPath();
            this.ctx.arc(px, py - 27, 4, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.shadowBlur = 0;
            return;
        }

        // 9. Draw Fire Station
        if (tile.type === 'fire') {
            this.drawIsometricBox(px, py, 24, 38, '#7f1d1d', '#450a0a', '#b91c1c');
            // Garage roller doors
            this.ctx.fillStyle = '#475569';
            this.ctx.beginPath();
            this.ctx.moveTo(px - 10, py - 4);
            this.ctx.lineTo(px - 2, py - 1);
            this.ctx.lineTo(px - 2, py - 14);
            this.ctx.lineTo(px - 10, py - 17);
            this.ctx.closePath();
            this.ctx.fill();
            return;
        }

        // 10. Draw Development Zones
        const isZone = ['residential', 'commercial', 'industrial'].includes(tile.type);
        if (isZone) {
            // Draw empty zones flat borders
            if (tile.density === 0) {
                let borderCol = 'rgba(57, 255, 20, 0.6)'; // green
                if (tile.type === 'commercial') borderCol = 'rgba(0, 153, 255, 0.6)'; // blue
                if (tile.type === 'industrial') borderCol = 'rgba(245, 158, 11, 0.6)'; // yellow
                if (tile.abandoned) borderCol = 'rgba(120, 120, 120, 0.4)';

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
            const h = tile.density * 16 + 10;
            const w = 26 - tile.density * 2;

            this.drawIsometricBox(px, py, h, w, colorLeft, colorRight, colorTop);

            // Draw window grids / night lights
            if (!tile.abandoned && tile.powered) {
                const isNight = this.sim.date.getHours() >= 20 || this.sim.date.getHours() < 5;
                if (isNight) {
                    this.ctx.fillStyle = '#fffb80'; // warm window glow
                    
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
            this.ctx.fillStyle = timeVal < 200 ? '#ef4444' : '#f59e0b';
            this.ctx.beginPath();
            this.ctx.arc(px, py - 15, 8 + Math.sin(Date.now() / 40) * 3, 0, Math.PI * 2);
            this.ctx.fill();
        }

        // 12. Utilities overlays overlaying buildings (glowing dots)
        if (this.overlayMode === 'power' && !tile.powered) {
            if (Date.now() % 1000 < 500) {
                this.ctx.fillStyle = '#ff2a5f';
                this.ctx.font = '10px Arial';
                this.ctx.fillText('⚡', px - 5, py - 30);
            }
        }
        if (this.overlayMode === 'water' && !tile.watered) {
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

        // Top Diamond Points
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

    // --- Draw Transparent Hover Preview Outline ---
    drawHoverPreview() {
        if (this.hoverX === null || this.hoverY === null) return;
        if (this.hoverX < 0 || this.hoverX >= GRID_SIZE || this.hoverY < 0 || this.hoverY >= GRID_SIZE) return;

        const px = (this.hoverX - this.hoverY) * this.halfW;
        const py = (this.hoverX + this.hoverY) * this.halfH;

        const tile = this.sim.grid[this.hoverX][this.hoverY];

        // Determine if build action is possible
        let canBuild = true;
        if (this.selectedTool !== 'select' && this.selectedTool !== 'bulldoze') {
            if (tile.type !== 'empty' || tile.rubble || tile.fireActive || this.sim.funds < this.selectedCost) {
                canBuild = false;
            }
        } else if (this.selectedTool === 'bulldoze') {
            if (tile.type === 'empty' && !tile.rubble && !tile.fireActive) {
                canBuild = false; // nothing to bulldoze
            }
        }

        // Draw glowing bounding hover diamond
        this.ctx.save();
        this.ctx.strokeStyle = canBuild ? 'var(--neon-cyan)' : 'var(--neon-danger)';
        this.ctx.lineWidth = 2;
        this.ctx.shadowBlur = 10;
        this.ctx.shadowColor = canBuild ? 'var(--neon-cyan)' : 'var(--neon-danger)';
        this.ctx.fillStyle = canBuild ? 'rgba(0, 242, 254, 0.25)' : 'rgba(255, 42, 95, 0.25)';

        this.ctx.beginPath();
        this.ctx.moveTo(px, py - this.halfH);
        this.ctx.lineTo(px + this.halfW, py);
        this.ctx.lineTo(px, py + this.halfH);
        this.ctx.lineTo(px - this.halfW, py);
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.stroke();
        this.ctx.restore();

        // Draw structural wireframe preview
        if (canBuild && this.selectedTool !== 'select' && this.selectedTool !== 'bulldoze') {
            this.ctx.globalAlpha = 0.45;
            
            // Draw temporary mock asset
            if (this.selectedTool === 'road') {
                this.ctx.fillStyle = '#2d3748';
                this.ctx.beginPath();
                this.ctx.moveTo(px, py - this.halfH + 1);
                this.ctx.lineTo(px + this.halfW - 1, py);
                this.ctx.lineTo(px, py + this.halfH - 1);
                this.ctx.lineTo(px - this.halfW + 1, py);
                this.ctx.closePath();
                this.ctx.fill();
            } else if (this.selectedTool === 'powerplant') {
                this.drawIsometricBox(px, py, 26, 44, '#3182ce', '#2b6cb0', '#63b3ed');
            } else if (this.selectedTool === 'watertower') {
                this.ctx.strokeStyle = '#90cdf4';
                this.ctx.lineWidth = 2;
                this.ctx.beginPath();
                this.ctx.moveTo(px - 8, py); this.ctx.lineTo(px, py - 30);
                this.ctx.moveTo(px + 8, py); this.ctx.lineTo(px, py - 30);
                this.ctx.stroke();
                this.ctx.fillStyle = '#4299e1';
                this.ctx.beginPath();
                this.ctx.arc(px, py - 30, 11, 0, Math.PI * 2);
                this.ctx.fill();
            } else if (['residential', 'commercial', 'industrial'].includes(this.selectedTool)) {
                let col = '#48bb78';
                if (this.selectedTool === 'commercial') col = '#4299e1';
                if (this.selectedTool === 'industrial') col = '#ecc94b';
                
                this.ctx.strokeStyle = col;
                this.ctx.lineWidth = 1.5;
                this.ctx.beginPath();
                this.ctx.moveTo(px, py - this.halfH + 2);
                this.ctx.lineTo(px + this.halfW - 2, py);
                this.ctx.lineTo(px, py + this.halfH - 2);
                this.ctx.lineTo(px - this.halfW + 2, py);
                this.ctx.closePath();
                this.ctx.stroke();
            }
            
            this.ctx.globalAlpha = 1.0;
        }
    }

    // --- Draw Particles ---
    drawParticles() {
        for (const p of this.disasters.particles) {
            this.ctx.fillStyle = p.color;
            this.ctx.globalAlpha = p.getAlpha();
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, Math.max(1.5, p.life / 5), 0, Math.PI * 2);
            this.ctx.fill();
        }
        this.ctx.globalAlpha = 1.0;
    }

    // --- Draw Meteors ---
    drawMeteors() {
        for (const m of this.disasters.activeMeteors) {
            this.ctx.fillStyle = '#ff4500';
            this.ctx.beginPath();
            this.ctx.arc(m.x, m.y, 10, 0, Math.PI * 2);
            this.ctx.fill();

            this.ctx.strokeStyle = '#ffaa00';
            this.ctx.lineWidth = 3;
            this.ctx.beginPath();
            this.ctx.arc(m.x, m.y, 16, 0, Math.PI * 2);
            this.ctx.stroke();
        }
    }

    // --- Draw Clouds ---
    drawClouds() {
        for (const c of this.clouds) {
            c.x += c.vx;
            if (c.x > 800) c.x = -800;

            this.ctx.fillStyle = `rgba(255, 255, 255, ${c.opacity})`;
            this.ctx.beginPath();
            this.ctx.arc(c.x, c.y, c.size, 0, Math.PI * 2);
            this.ctx.arc(c.x - c.size * 0.5, c.y + c.size * 0.15, c.size * 0.7, 0, Math.PI * 2);
            this.ctx.arc(c.x + c.size * 0.55, c.y + c.size * 0.1, c.size * 0.6, 0, Math.PI * 2);
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

        if (totalHour >= 20 || totalHour < 5) {
            r = 10; g = 15; b = 45;
            alpha = 0.40; // Soften night slightly to maintain structural visibility
            mixMode = 'multiply';
        }
        else if (totalHour >= 5 && totalHour < 7) {
            const factor = (totalHour - 5) / 2;
            r = Math.round(10 + (235 - 10) * (1 - factor));
            g = Math.round(15 + (120 - 15) * (1 - factor));
            b = Math.round(45 + (80 - 45) * (1 - factor));
            alpha = 0.4 * (1 - factor);
            mixMode = 'source-over';
        }
        else if (totalHour >= 7 && totalHour < 17) {
            alpha = 0;
        }
        else if (totalHour >= 17 && totalHour < 20) {
            const factor = (totalHour - 17) / 3;
            r = Math.round(180 * factor);
            g = Math.round(60 * factor);
            b = Math.round(120 * factor);
            alpha = 0.25 * factor;
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
