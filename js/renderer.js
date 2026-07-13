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
        this.tileW = 64; 
        this.tileH = 32; 
        this.halfW = 32;
        this.halfH = 16;
        
        // Overlay view state: 'normal', 'power', 'water', 'pollution', 'landvalue'
        this.overlayMode = 'normal';

        // Hover & Preview state
        this.hoverX = null;
        this.hoverY = null;
        this.selectedTool = 'select';
        this.selectedCost = 0;

        // Dynamic cloud layer
        this.clouds = [];
        this.initClouds();

        // Track static car placements on roads to make the city feel alive
        this.cars = [];
        this.initCars();
    }

    initClouds() {
        for (let i = 0; i < 5; i++) {
            this.clouds.push({
                x: Math.random() * 1200 - 600,
                y: Math.random() * 600 - 300,
                vx: Math.random() * 0.12 + 0.05,
                size: Math.random() * 80 + 50,
                opacity: Math.random() * 0.15 + 0.05
            });
        }
    }

    initCars() {
        // Cars will be drawn dynamically based on roads rather than a static list,
        // which keeps them moving and updating seamlessly.
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

    // --- Convert Grid indexes to Screen coordinates ---
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
        // Dark blue-grey sky background
        this.ctx.fillStyle = '#1e2430'; 
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        const shake = this.disasters.getShakeOffsets();

        this.ctx.save();
        this.ctx.translate(this.offsetX + shake.x, this.offsetY + shake.y);
        this.ctx.scale(this.zoom, this.zoom);

        // 1. Draw Terrain Grass
        this.drawGround();

        // 2. Draw Pipes Grid underlay (Only in water overlay mode)
        if (this.overlayMode === 'water') {
            this.drawWaterPipesGrid();
        }

        // 3. Draw Buildings, Roads, & Objects (Sorted Depth Order)
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

        // 5. Draw Particles
        this.drawParticles();

        // 6. Draw Flying Meteors
        this.drawMeteors();

        // 7. Draw Clouds
        this.drawClouds();

        this.ctx.restore();

        // 8. Apply Fullscreen Day/Night Shading Overlay
        this.drawDayNightOverlay();
    }

    // --- Draw Terrain Grass with Realistic Shading ---
    drawGround() {
        // High visibility grid line styling
        this.ctx.strokeStyle = 'rgba(34, 76, 36, 0.3)'; 
        this.ctx.lineWidth = 1;

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
                
                // Color ground by value/pollution overlays or standard grass gradient
                if (this.overlayMode === 'pollution') {
                    const pol = this.sim.grid[x][y].pollution;
                    this.ctx.fillStyle = `rgba(185, 28, 28, ${pol / 120})`;
                } else if (this.overlayMode === 'landvalue') {
                    const val = this.sim.grid[x][y].landValue;
                    this.ctx.fillStyle = `rgba(16, 185, 129, ${val / 200})`;
                } else {
                    // Soft grass green gradient with realistic top-to-bottom shading
                    const grassGrad = this.ctx.createLinearGradient(px, py - this.halfH, px, py + this.halfH);
                    grassGrad.addColorStop(0, '#55a659');
                    grassGrad.addColorStop(1, '#438a46');
                    this.ctx.fillStyle = grassGrad;
                }
                
                this.ctx.fill();
                this.ctx.stroke();
            }
        }

        // Draw a realistic wooden fence or brick border around the active grid boundary
        this.ctx.strokeStyle = '#5d4037'; // Wood brown
        this.ctx.lineWidth = 3;
        this.ctx.beginPath();
        this.ctx.moveTo(0, -this.halfH);
        this.ctx.lineTo(GRID_SIZE * this.halfW, (GRID_SIZE - 1) * this.halfH);
        this.ctx.lineTo(0, (2 * GRID_SIZE - 1) * this.halfH);
        this.ctx.lineTo(-GRID_SIZE * this.halfW, (GRID_SIZE - 1) * this.halfH);
        this.ctx.closePath();
        this.ctx.stroke();
    }

    // --- Draw Underground Water Pipes ---
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
                            
                            // Realistic metallic utility pipe
                            this.ctx.strokeStyle = '#0284c7'; // dark blue
                            this.ctx.lineWidth = 4;
                            this.ctx.beginPath();
                            this.ctx.moveTo(px, py);
                            this.ctx.lineTo(npx, npy);
                            this.ctx.stroke();
                            
                            // Glowing water core
                            this.ctx.strokeStyle = '#38bdf8'; // light cyan
                            this.ctx.lineWidth = 1.5;
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

    // --- Render Individual Tile Assets & 2D Vector Sprites ---
    drawTile(x, y) {
        const tile = this.sim.grid[x][y];
        const px = (x - y) * this.halfW;
        const py = (x + y) * this.halfH;

        if (tile.type === 'empty' && !tile.rubble) return;

        // 1. Draw Rubble (Burnt down ruins)
        if (tile.rubble) {
            // Draw collapsed grey stones
            this.ctx.fillStyle = '#78716c';
            this.ctx.beginPath();
            this.ctx.arc(px - 6, py + 2, 4, 0, Math.PI * 2);
            this.ctx.arc(px + 8, py - 4, 5, 0, Math.PI * 2);
            this.ctx.arc(px, py - 2, 6, 0, Math.PI * 2);
            this.ctx.fill();

            // Draw charred wood beams (dark brown lines)
            this.ctx.strokeStyle = '#292524';
            this.ctx.lineWidth = 2.5;
            this.ctx.beginPath();
            this.ctx.moveTo(px - 12, py - 6); this.ctx.lineTo(px + 12, py + 4);
            this.ctx.moveTo(px - 4, py + 8); this.ctx.lineTo(px + 6, py - 10);
            this.ctx.stroke();
            return;
        }

        // 2. Draw Realistic Roads (Asphalt textures, lane markings, zebra crossings, and tiny cars!)
        if (tile.type === 'road') {
            // Draw asphalt base diamond
            this.ctx.fillStyle = '#4b5563'; 
            this.ctx.beginPath();
            this.ctx.moveTo(px, py - this.halfH);
            this.ctx.lineTo(px + this.halfW, py);
            this.ctx.lineTo(px, py + this.halfH);
            this.ctx.lineTo(px - this.halfW, py);
            this.ctx.closePath();
            this.ctx.fill();

            // Concrete road borders/gutters
            this.ctx.strokeStyle = '#9ca3af';
            this.ctx.lineWidth = 1.5;
            this.ctx.beginPath();
            this.ctx.moveTo(px - this.halfW, py);
            this.ctx.lineTo(px, py - this.halfH);
            this.ctx.lineTo(px + this.halfW, py);
            this.ctx.moveTo(px - this.halfW, py);
            this.ctx.lineTo(px, py + this.halfH);
            this.ctx.lineTo(px + this.halfW, py);
            this.ctx.stroke();

            // Check connection directions
            const nRoad = (x > 0 && ['road', 'powerplant', 'watertower', 'police', 'fire'].includes(this.sim.grid[x-1][y].type));
            const sRoad = (x < GRID_SIZE - 1 && ['road', 'powerplant', 'watertower', 'police', 'fire'].includes(this.sim.grid[x+1][y].type));
            const eRoad = (y > 0 && ['road', 'powerplant', 'watertower', 'police', 'fire'].includes(this.sim.grid[x][y-1].type));
            const wRoad = (y < GRID_SIZE - 1 && ['road', 'powerplant', 'watertower', 'police', 'fire'].includes(this.sim.grid[x][y+1].type));

            this.ctx.strokeStyle = '#f59e0b'; // Yellow lane markers
            this.ctx.lineWidth = 1;
            this.ctx.setLineDash([4, 4]); // Dashed road lane lines

            if (nRoad) {
                this.ctx.beginPath(); this.ctx.moveTo(px, py); this.ctx.lineTo(px - this.halfW/2, py - this.halfH/2); this.ctx.stroke();
            }
            if (sRoad) {
                this.ctx.beginPath(); this.ctx.moveTo(px, py); this.ctx.lineTo(px + this.halfW/2, py + this.halfH/2); this.ctx.stroke();
            }
            if (eRoad) {
                this.ctx.beginPath(); this.ctx.moveTo(px, py); this.ctx.lineTo(px + this.halfW/2, py - this.halfH/2); this.ctx.stroke();
            }
            if (wRoad) {
                this.ctx.beginPath(); this.ctx.moveTo(px, py); this.ctx.lineTo(px - this.halfW/2, py + this.halfH/2); this.ctx.stroke();
            }
            this.ctx.setLineDash([]); // Reset dash

            // Draw Zebra crossing crosswalk if it is a 3-way or 4-way intersection
            const intersectionsCount = (nRoad ? 1 : 0) + (sRoad ? 1 : 0) + (eRoad ? 1 : 0) + (wRoad ? 1 : 0);
            if (intersectionsCount >= 3) {
                this.ctx.strokeStyle = '#ffffff';
                this.ctx.lineWidth = 2;
                this.ctx.beginPath();
                // Draw 3 small crosswalk stripes in the center of the road
                this.ctx.moveTo(px - 4, py - 2); this.ctx.lineTo(px - 4, py + 2);
                this.ctx.moveTo(px, py - 2); this.ctx.lineTo(px, py + 2);
                this.ctx.moveTo(px + 4, py - 2); this.ctx.lineTo(px + 4, py + 2);
                this.ctx.stroke();
            }

            // Draw Tiny Cars dynamically moving on the road lanes
            // To animate, we use Date.now() to shift car offsets along the road
            const seed = (x * 7 + y * 13) % 100;
            if (seed < 40) { // 40% chance of car presence on this road tile
                const speed = 0.002;
                const progress = (Date.now() * speed + seed) % 1.0;
                
                // Determine direction
                let sx = px, sy = py;
                if (nRoad && sRoad) {
                    // Vertical axis lane offsets
                    sx = px - this.halfW/2 + progress * this.halfW;
                    sy = py - this.halfH/2 + progress * this.halfH;
                } else if (eRoad && wRoad) {
                    // Horizontal axis lane offsets
                    sx = px + this.halfW/2 - progress * this.halfW;
                    sy = py - this.halfH/2 + progress * this.halfH;
                }

                // Render tiny 2.5D car rectangle
                const carColors = ['#dc2626', '#2563eb', '#16a34a', '#d97706', '#ffffff', '#1f2937'];
                const carColor = carColors[seed % carColors.length];
                
                this.ctx.fillStyle = carColor;
                this.ctx.fillRect(sx - 3, sy - 4, 6, 4); // body
                this.ctx.fillStyle = '#000000';
                this.ctx.fillRect(sx - 2, sy - 6, 4, 2); // windshield glass roof
            }
            return;
        }

        // 3. Draw Realistic Power Lines (Wooden utility poles with sagging copper wires)
        if (tile.type === 'powerline') {
            // Draw wooden utility pole structure
            this.ctx.strokeStyle = '#5c4033'; // Dark wood brown
            this.ctx.lineWidth = 2.5;
            this.ctx.beginPath();
            this.ctx.moveTo(px, py + 2);
            this.ctx.lineTo(px, py - 20); // vertical pole
            this.ctx.stroke();

            // Cross beam
            this.ctx.beginPath();
            this.ctx.moveTo(px - 7, py - 17);
            this.ctx.lineTo(px + 7, py - 17);
            this.ctx.stroke();

            // Small glass insulators on cross beam
            this.ctx.fillStyle = '#60a5fa';
            this.ctx.fillRect(px - 7, py - 19, 2, 2);
            this.ctx.fillRect(px + 5, py - 19, 2, 2);

            // Draw copper cable wire vectors with sagging catenary curves
            this.ctx.strokeStyle = '#78350f'; // Copper wire color
            this.ctx.lineWidth = 1;
            
            const neighbors = this.sim.getNeighbors(x, y);
            for (const n of neighbors) {
                if (n.type === 'powerline' || n.type === 'powerplant') {
                    const npx = (n.x - n.y) * this.halfW;
                    const npy = (n.x + n.y) * this.halfH;
                    
                    const midX = (px + npx) / 2;
                    const midY = (py - 17 + npy - 17) / 2 + 4; // Catenary sag offset (+4px)

                    this.ctx.beginPath();
                    this.ctx.moveTo(px, py - 17);
                    this.ctx.quadraticCurveTo(midX, midY, npx, npy - 17);
                    this.ctx.stroke();
                }
            }
            return;
        }

        // 4. Draw Water Pipe valve (only marker, actual pipes drawn in water grid overlay)
        if (tile.type === 'waterpipe') {
            this.ctx.fillStyle = '#0284c7';
            this.ctx.beginPath();
            this.ctx.arc(px, py, 3, 0, Math.PI * 2);
            this.ctx.fill();
            return;
        }

        // 5. Draw Realistic Parks (Walkways, Fountains, Flowerbeds, Benches, and Trees)
        if (tile.type === 'park') {
            // Textured grass
            this.ctx.fillStyle = '#347a38'; 
            this.ctx.beginPath();
            this.ctx.moveTo(px, py - this.halfH);
            this.ctx.lineTo(px + this.halfW, py);
            this.ctx.lineTo(px, py + this.halfH);
            this.ctx.lineTo(px - this.halfW, py);
            this.ctx.closePath();
            this.ctx.fill();

            // Cobblestone walkways
            this.ctx.strokeStyle = '#9ca3af';
            this.ctx.lineWidth = 1.5;
            this.ctx.beginPath();
            this.ctx.moveTo(px - this.halfW, py);
            this.ctx.lineTo(px + this.halfW, py);
            this.ctx.moveTo(px, py - this.halfH);
            this.ctx.lineTo(px, py + this.halfH);
            this.ctx.stroke();

            // Circular water fountain in center
            this.ctx.fillStyle = '#60a5fa';
            this.ctx.strokeStyle = '#d1d5db';
            this.ctx.lineWidth = 1.5;
            this.ctx.beginPath();
            this.ctx.arc(px, py, 5, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.stroke();

            // Flowerbeds (Red/Yellow small dots)
            this.ctx.fillStyle = '#ef4444'; // Red
            this.ctx.fillRect(px - 14, py - 6, 2, 2);
            this.ctx.fillRect(px - 12, py - 8, 2, 2);
            this.ctx.fillStyle = '#f59e0b'; // Yellow
            this.ctx.fillRect(px + 10, py + 4, 2, 2);
            this.ctx.fillRect(px + 12, py + 6, 2, 2);

            // Benches (tiny brown rectangles)
            this.ctx.fillStyle = '#78350f';
            this.ctx.fillRect(px - 6, py + 8, 4, 2);
            this.ctx.fillRect(px + 2, py - 10, 4, 2);

            // Realistic Oak Tree
            this.drawRealisticTree(px - 15, py - 12);
            this.drawRealisticTree(px + 16, py - 10);
            this.drawRealisticTree(px + 5, py + 12);
            return;
        }

        // 6. Draw Coal Power Plant (Real factory structure with concrete cooling tower and coal pile)
        if (tile.type === 'powerplant') {
            // Main brick boiler house
            this.drawIsometricBox(px - 10, py + 4, 18, 22, '#991b1b', '#7f1d1d', '#5c1010');
            // Boiler roof details
            this.ctx.fillStyle = '#374151';
            this.ctx.fillRect(px - 18, py - 14, 12, 3);
            
            // Coal Storage Yard (dark grey pile)
            this.ctx.fillStyle = '#1c1917'; // Coal black
            this.ctx.beginPath();
            this.ctx.arc(px - 18, py + 8, 7, 0, Math.PI * 2);
            this.ctx.fill();

            // Hyperbolic concrete Cooling Tower
            const cx = px + 10;
            const cy = py - 6;
            this.drawCoolingTower(cx, cy, 32, 16);
            return;
        }

        // 7. Draw Water Tower (Metallic water storage sphere with truss framework)
        if (tile.type === 'watertower') {
            const tx = px;
            const ty = py - 4;

            // Scaffolding legs
            this.ctx.strokeStyle = '#6b7280';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(tx - 6, ty + 6); this.ctx.lineTo(tx, ty - 22);
            this.ctx.moveTo(tx + 6, ty + 6); this.ctx.lineTo(tx, ty - 22);
            this.ctx.moveTo(tx, ty + 8); this.ctx.lineTo(tx, ty - 22);
            this.ctx.stroke();

            // Diagonal bracing wires
            this.ctx.strokeStyle = '#9ca3af';
            this.ctx.lineWidth = 0.8;
            this.ctx.beginPath();
            this.ctx.moveTo(tx - 6, ty + 6); this.ctx.lineTo(tx + 6, ty - 10);
            this.ctx.moveTo(tx + 6, ty + 6); this.ctx.lineTo(tx - 6, ty - 10);
            this.ctx.stroke();

            // Water Tank Spherical Vessel
            const grad = this.ctx.createRadialGradient(tx - 3, ty - 25, 2, tx, ty - 22, 10);
            grad.addColorStop(0, '#e0f2fe'); // metal sheen reflection
            grad.addColorStop(0.4, '#0ea5e9'); // steel blue
            grad.addColorStop(1, '#0369a1'); // shadow
            this.ctx.fillStyle = grad;
            this.ctx.beginPath();
            this.ctx.arc(tx, ty - 22, 10, 0, Math.PI * 2);
            this.ctx.fill();

            // Top safety beacon light
            this.ctx.fillStyle = '#ef4444';
            this.ctx.beginPath();
            this.ctx.arc(tx, ty - 32, 1.5, 0, Math.PI * 2);
            this.ctx.fill();
            return;
        }

        // 8. Draw Police Station (Realistic blue brick station house with badge emblem and squad car)
        if (tile.type === 'police') {
            this.drawIsometricBox(px, py + 2, 22, 34, '#1e3a8a', '#172554', '#1d4ed8');
            // Shield emblem drawing
            this.ctx.fillStyle = '#eab308'; // Gold badge
            this.ctx.beginPath();
            this.ctx.moveTo(px, py - 15);
            this.ctx.lineTo(px + 3, py - 18);
            this.ctx.lineTo(px + 3, py - 11);
            this.ctx.lineTo(px, py - 8);
            this.ctx.lineTo(px - 3, py - 11);
            this.ctx.lineTo(px - 3, py - 18);
            this.ctx.closePath();
            this.ctx.fill();

            // Siren beacon on roof
            const flasher = (Date.now() % 400 < 200) ? '#2563eb' : '#dc2626';
            this.ctx.fillStyle = flasher;
            this.ctx.beginPath();
            this.ctx.arc(px, py - 23, 3, 0, Math.PI * 2);
            this.ctx.fill();
            return;
        }

        // 9. Draw Fire Station (Red brick building with red garage gate doors)
        if (tile.type === 'fire') {
            this.drawIsometricBox(px, py + 2, 20, 36, '#991b1b', '#7f1d1d', '#b91c1c');
            // Red roll-up garage gates
            this.ctx.fillStyle = '#dc2626';
            this.ctx.beginPath();
            this.ctx.moveTo(px - 10, py - 2);
            this.ctx.lineTo(px - 2, py);
            this.ctx.lineTo(px - 2, py - 12);
            this.ctx.lineTo(px - 10, py - 14);
            this.ctx.closePath();
            this.ctx.fill();
            return;
        }

        // 10. Draw Development Zones
        const isZone = ['residential', 'commercial', 'industrial'].includes(tile.type);
        if (isZone) {
            // Draw empty zones flat borders
            if (tile.density === 0) {
                let borderCol = 'rgba(76, 175, 80, 0.7)'; 
                if (tile.type === 'commercial') borderCol = 'rgba(33, 150, 243, 0.7)'; 
                if (tile.type === 'industrial') borderCol = 'rgba(255, 152, 0, 0.7)'; 
                if (tile.abandoned) borderCol = 'rgba(158, 158, 158, 0.5)';

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

            // Draw realistic houses & buildings based on growth density stages
            if (tile.type === 'residential') {
                this.drawResidentialBuilding(px, py, tile.density, tile.abandoned);
            } else if (tile.type === 'commercial') {
                this.drawCommercialBuilding(px, py, tile.density, tile.abandoned);
            } else if (tile.type === 'industrial') {
                this.drawIndustrialBuilding(px, py, tile.density, tile.abandoned);
            }
        }

        // 11. Active Fire Outbreak Indicators
        if (tile.fireActive) {
            const timeVal = Date.now() % 400;
            this.ctx.fillStyle = timeVal < 200 ? '#ef4444' : '#f97316';
            this.ctx.beginPath();
            this.ctx.arc(px, py - 10, 8 + Math.sin(Date.now() / 40) * 3, 0, Math.PI * 2);
            this.ctx.fill();
        }

        // 12. Utilities overlays indicator icons
        if (this.overlayMode === 'power' && !tile.powered) {
            if (Date.now() % 1000 < 500) {
                this.ctx.fillStyle = '#ef4444';
                this.ctx.font = '11px sans-serif';
                this.ctx.fillText('⚡', px - 5, py - 20);
            }
        }
        if (this.overlayMode === 'water' && !tile.watered) {
            if (Date.now() % 1000 < 500) {
                this.ctx.fillStyle = '#0ea5e9';
                this.ctx.font = '11px sans-serif';
                this.ctx.fillText('💧', px - 5, py - 30);
            }
        }
    }

    // --- Draw Mathematical 3D Isometric Prism ---
    drawIsometricBox(cx, cy, h, w, colorLeft, colorRight, colorTop) {
        const halfw = w / 2;
        const halfh = w / 4;

        const bBottom = { x: cx, y: cy };
        const bRight = { x: cx + halfw, y: cy - halfh };
        const bTop = { x: cx, y: cy - 2 * halfh };
        const bLeft = { x: cx - halfw, y: cy - halfh };

        const tBottom = { x: cx, y: cy - h };
        const tRight = { x: cx + halfw, y: cy - halfh - h };
        const tTop = { x: cx, y: cy - 2 * halfh - h };
        const tLeft = { x: cx - halfw, y: cy - halfh - h };

        // Left Face
        this.ctx.fillStyle = colorLeft;
        this.ctx.beginPath();
        this.ctx.moveTo(bBottom.x, bBottom.y);
        this.ctx.lineTo(bLeft.x, bLeft.y);
        this.ctx.lineTo(tLeft.x, tLeft.y);
        this.ctx.lineTo(tBottom.x, tBottom.y);
        this.ctx.closePath();
        this.ctx.fill();

        // Right Face
        this.ctx.fillStyle = colorRight;
        this.ctx.beginPath();
        this.ctx.moveTo(bBottom.x, bBottom.y);
        this.ctx.lineTo(bRight.x, bRight.y);
        this.ctx.lineTo(tRight.x, tRight.y);
        this.ctx.lineTo(tBottom.x, tBottom.y);
        this.ctx.closePath();
        this.ctx.fill();

        // Top Face
        this.ctx.fillStyle = colorTop;
        this.ctx.beginPath();
        this.ctx.moveTo(tBottom.x, tBottom.y);
        this.ctx.lineTo(tRight.x, tRight.y);
        this.ctx.lineTo(tTop.x, tTop.y);
        this.ctx.lineTo(tLeft.x, tLeft.y);
        this.ctx.closePath();
        this.ctx.fill();
    }

    // --- Draw Real-life Hyperbolic Chimney Cooling Tower ---
    drawCoolingTower(cx, cy, h, w) {
        const halfw = w / 2;
        const halfh = w / 4;
        
        // Render 3D concrete hyperboloid using curves
        this.ctx.fillStyle = '#9ca3af'; // light concrete grey
        this.ctx.beginPath();
        this.ctx.moveTo(cx - halfw, cy); // bottom-left
        this.ctx.quadraticCurveTo(cx - halfw * 0.5, cy - h * 0.5, cx - halfw * 0.6, cy - h); // left waist curve
        this.ctx.lineTo(cx + halfw * 0.6, cy - h); // top-right
        this.ctx.quadraticCurveTo(cx + halfw * 0.5, cy - h * 0.5, cx + halfw, cy); // right waist curve
        this.ctx.lineTo(cx, cy + halfh);
        this.ctx.closePath();
        this.ctx.fill();

        // Highlight shade on left
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        this.ctx.beginPath();
        this.ctx.moveTo(cx - halfw, cy);
        this.ctx.quadraticCurveTo(cx - halfw * 0.5, cy - h * 0.5, cx - halfw * 0.6, cy - h);
        this.ctx.lineTo(cx, cy - h);
        this.ctx.lineTo(cx, cy + halfh);
        this.ctx.closePath();
        this.ctx.fill();

        // Dark hollow center at top opening
        this.ctx.fillStyle = '#1f2937';
        this.ctx.beginPath();
        this.ctx.ellipse(cx, cy - h, halfw * 0.6, halfh * 0.6, 0, 0, Math.PI * 2);
        this.ctx.fill();
    }

    // --- Draw Real-life Tree (Wooden trunk + green foliage) ---
    drawRealisticTree(tx, ty) {
        // Trunk
        this.ctx.strokeStyle = '#4e342e'; // dark brown trunk
        this.ctx.lineWidth = 2.5;
        this.ctx.beginPath();
        this.ctx.moveTo(tx, ty);
        this.ctx.lineTo(tx, ty - 8);
        this.ctx.stroke();

        // Foliage layers
        this.ctx.fillStyle = '#2e7d32'; // dark leaf green
        this.ctx.beginPath();
        this.ctx.arc(tx, ty - 12, 6, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.fillStyle = '#4caf50'; // light leaf green highlight
        this.ctx.beginPath();
        this.ctx.arc(tx - 2, ty - 14, 4, 0, Math.PI * 2);
        this.ctx.fill();
    }

    // --- Draw Detailed Residential Cottages, Apartments, & Skyscrapers ---
    drawResidentialBuilding(px, py, density, abandoned) {
        const wallColor = abandoned ? '#78716c' : '#fef08a'; // beige walls
        const roofColor = abandoned ? '#44403c' : '#dc2626'; // red clay shingles
        
        // Stage 1: Small Suburban Cottage with Pitched Roof
        if (density === 1) {
            // Walls box
            this.drawIsometricBox(px, py + 2, 10, 16, wallColor, this.shadeColor(wallColor, -15), '#fef08a');
            // Pitched Roof (Triangular Prism)
            this.drawPitchedRoof(px, py - 8, 8, 18, roofColor, this.shadeColor(roofColor, -20));
            // Small brown door
            this.ctx.fillStyle = '#78350f';
            this.ctx.fillRect(px - 2, py + 1, 3, 5);
        }
        // Stage 2: Two-story Suburban Duplex with dual gables
        else if (density === 2) {
            this.drawIsometricBox(px - 5, py + 2, 15, 14, wallColor, this.shadeColor(wallColor, -15), '#fef08a');
            this.drawPitchedRoof(px - 5, py - 13, 9, 16, roofColor, this.shadeColor(roofColor, -20));

            this.drawIsometricBox(px + 6, py + 4, 12, 12, wallColor, this.shadeColor(wallColor, -15), '#fef08a');
            this.drawPitchedRoof(px + 6, py - 8, 7, 14, roofColor, this.shadeColor(roofColor, -20));
        }
        // Stage 3: Three-story brick apartment block
        else if (density === 3) {
            const brickColor = abandoned ? '#57534e' : '#b91c1c';
            this.drawIsometricBox(px, py + 3, 26, 26, brickColor, this.shadeColor(brickColor, -15), '#f3f4f6');
            
            // Rooftop elevator box
            this.drawIsometricBox(px - 3, py - 23, 6, 8, '#9ca3af', '#6b7280', '#e5e7eb');
            
            // Window details
            this.ctx.fillStyle = '#60a5fa'; // Blue glass windows
            for (let wh = 2; wh < 22; wh += 8) {
                this.ctx.fillRect(px - 9, py - wh, 3, 4);
                this.ctx.fillRect(px + 4, py - wh, 3, 4);
            }
        }
        // Stage 4: High-rise apartment building skyscraper with window grids
        else if (density === 4) {
            const tallColor = abandoned ? '#44403c' : '#0891b2'; // teal/cyan concrete
            this.drawIsometricBox(px, py + 4, 52, 24, tallColor, this.shadeColor(tallColor, -15), '#e5e7eb');

            // Rooftop antenna tower
            this.ctx.strokeStyle = '#4b5563';
            this.ctx.lineWidth = 1.5;
            this.ctx.beginPath();
            this.ctx.moveTo(px, py - 48);
            this.ctx.lineTo(px, py - 62);
            this.ctx.stroke();

            // Glass window panes columns
            this.ctx.fillStyle = '#e0f2fe';
            for (let wh = 4; wh < 48; wh += 7) {
                this.ctx.fillRect(px - 8, py - wh, 2, 3);
                this.ctx.fillRect(px - 4, py - wh, 2, 3);
                this.ctx.fillRect(px + 3, py - wh, 2, 3);
                this.ctx.fillRect(px + 7, py - wh, 2, 3);
            }
        }
    }

    // --- Draw Detailed Commercial Shops & Office Towers ---
    drawCommercialBuilding(px, py, density, abandoned) {
        const wallColor = abandoned ? '#78716c' : '#e2e8f0'; // white/grey concrete
        const roofColor = '#374151'; // dark gravel flat roof

        // Stage 1: Small retail shop with awning stripes
        if (density === 1) {
            this.drawIsometricBox(px, py + 1, 10, 18, wallColor, this.shadeColor(wallColor, -15), roofColor);
            
            // Striped retail awning (blue & white)
            this.ctx.fillStyle = '#2563eb';
            this.ctx.fillRect(px - 7, py - 5, 14, 3);
            this.ctx.fillStyle = '#ffffff';
            this.ctx.fillRect(px - 4, py - 5, 8, 3);
        }
        // Stage 2: Modern supermarket store with parking lot details
        else if (density === 2) {
            this.drawIsometricBox(px, py + 2, 14, 24, wallColor, this.shadeColor(wallColor, -15), roofColor);
            
            // Glass window front door facade
            this.ctx.fillStyle = '#e0f2fe';
            this.ctx.fillRect(px - 6, py - 3, 12, 6);
        }
        // Stage 3: Mid-rise glass office block
        else if (density === 3) {
            const blockColor = abandoned ? '#57534e' : '#1e3a8a';
            this.drawIsometricBox(px, py + 3, 30, 26, blockColor, this.shadeColor(blockColor, -15), '#cbd5e1');
            
            // Windows
            this.ctx.fillStyle = '#93c5fd';
            for (let wh = 4; wh < 26; wh += 6) {
                this.ctx.fillRect(px - 9, py - wh, 3, 3);
                this.ctx.fillRect(px - 4, py - wh, 3, 3);
                this.ctx.fillRect(px + 2, py - wh, 3, 3);
                this.ctx.fillRect(px + 7, py - wh, 3, 3);
            }
        }
        // Stage 4: Majestic high-rise steel skyscraper
        else if (density === 4) {
            const skyscraperColor = abandoned ? '#44403c' : '#3b82f6';
            this.drawIsometricBox(px, py + 4, 60, 22, skyscraperColor, this.shadeColor(skyscraperColor, -20), '#f1f5f9');
            
            // Central glass elevator shaft columns
            this.ctx.fillStyle = '#e0f2fe';
            this.ctx.fillRect(px - 2, py - 56, 4, 52);
        }
    }

    // --- Draw Detailed Corrugated Warehouses & Factories ---
    drawIndustrialBuilding(px, py, density, abandoned) {
        const metalColor = abandoned ? '#78716c' : '#94a3b8'; // slate steel
        const brickColor = '#7c2d12'; // dark industrial clay brick

        // Stage 1: Small storage metal warehouse
        if (density === 1) {
            this.drawIsometricBox(px, py + 1, 10, 18, metalColor, this.shadeColor(metalColor, -15), '#475569');
            // Large grey shutter cargo bay door
            this.ctx.fillStyle = '#e2e8f0';
            this.ctx.fillRect(px - 4, py + 1, 8, 6);
        }
        // Stage 2: Factory with saw-tooth roofing
        else if (density === 2) {
            this.drawIsometricBox(px, py + 2, 14, 22, brickColor, this.shadeColor(brickColor, -15), '#475569');
            // Sawtooth roof triangles
            this.ctx.fillStyle = '#374151';
            this.ctx.beginPath();
            this.ctx.moveTo(px - 10, py - 12);
            this.ctx.lineTo(px - 5, py - 18);
            this.ctx.lineTo(px, py - 12);
            this.ctx.lineTo(px + 5, py - 18);
            this.ctx.lineTo(px + 10, py - 12);
            this.ctx.closePath();
            this.ctx.fill();
        }
        // Stage 3: Heavy manufacturing plant with metal silos
        else if (density === 3) {
            this.drawIsometricBox(px - 5, py + 3, 20, 18, metalColor, this.shadeColor(metalColor, -15), '#374151');
            
            // Cylindrical storage silos beside factory
            const sx = px + 8;
            const sy = py + 4;
            this.ctx.fillStyle = '#cbd5e1';
            this.ctx.fillRect(sx - 4, sy - 18, 8, 16); // silo cylinder
            this.ctx.fillStyle = '#475569';
            this.ctx.beginPath();
            this.ctx.arc(sx, sy - 18, 4, 0, Math.PI * 2); // rounded cap dome
            this.ctx.fill();
        }
        // Stage 4: Mega industrial refinery complex with tall chimneys
        else if (density === 4) {
            this.drawIsometricBox(px - 6, py + 4, 26, 20, brickColor, this.shadeColor(brickColor, -15), '#1f2937');

            // Storage gas tank sphere
            const gx = px + 8;
            const gy = py + 6;
            this.ctx.fillStyle = '#e2e8f0';
            this.ctx.beginPath();
            this.ctx.arc(gx, gy - 12, 6, 0, Math.PI * 2);
            this.ctx.fill();

            // Heavy industrial smoke stack brick chimney
            this.drawIsometricBox(px - 12, py - 8, 38, 8, '#7c2d12', '#431407', '#111827');
        }
    }

    // --- Draw Pitched Roof for Cottage Houses ---
    drawPitchedRoof(cx, cy, h, w, colorLeft, colorRight) {
        const halfw = w / 2;
        const halfh = w / 4;

        // Peak point
        const peak = { x: cx, y: cy - h };

        // Left base corner
        const leftBase = { x: cx - halfw, y: cy + halfh };
        const rightBase = { x: cx + halfw, y: cy + halfh };
        const bottomBase = { x: cx, y: cy + 2 * halfh };
        const topBase = { x: cx, y: cy };

        // Draw Left Pitched Face
        this.ctx.fillStyle = colorLeft;
        this.ctx.beginPath();
        this.ctx.moveTo(leftBase.x, leftBase.y);
        this.ctx.lineTo(bottomBase.x, bottomBase.y);
        this.ctx.lineTo(peak.x, peak.y);
        this.ctx.closePath();
        this.ctx.fill();

        // Draw Right Pitched Face
        this.ctx.fillStyle = colorRight;
        this.ctx.beginPath();
        this.ctx.moveTo(rightBase.x, rightBase.y);
        this.ctx.lineTo(bottomBase.x, bottomBase.y);
        this.ctx.lineTo(peak.x, peak.y);
        this.ctx.closePath();
        this.ctx.fill();
    }

    // --- Helper to shade hex colors ---
    shadeColor(color, percent) {
        let num = parseInt(color.replace("#",""), 16),
        amt = Math.round(2.55 * percent),
        R = (num >> 16) + amt,
        G = (num >> 8 & 0x00FF) + amt,
        B = (num & 0x0000FF) + amt;
        return "#" + (0x1000000 + (R<255?R<0?0:R:255)*0x10000 + (G<255?G<0?0:G:255)*0x100 + (B<255?B<0?0:B:255)).toString(16).slice(1);
    }

    // --- Draw Hover Outline Preview ---
    drawHoverPreview() {
        if (this.hoverX === null || this.hoverY === null) return;
        if (this.hoverX < 0 || this.hoverX >= GRID_SIZE || this.hoverY < 0 || this.hoverY >= GRID_SIZE) return;

        const px = (this.hoverX - this.hoverY) * this.halfW;
        const py = (this.hoverX + this.hoverY) * this.halfH;

        const tile = this.sim.grid[this.hoverX][this.hoverY];

        let canBuild = true;
        if (this.selectedTool !== 'select' && this.selectedTool !== 'bulldoze') {
            if (tile.type !== 'empty' || tile.rubble || tile.fireActive || this.sim.funds < this.selectedCost) {
                canBuild = false;
            }
        } else if (this.selectedTool === 'bulldoze') {
            if (tile.type === 'empty' && !tile.rubble && !tile.fireActive) {
                canBuild = false; 
            }
        }

        // Draw selection highlight bounding diamond outline
        this.ctx.save();
        this.ctx.strokeStyle = canBuild ? '#3b82f6' : '#ef4444';
        this.ctx.lineWidth = 2.5;
        this.ctx.fillStyle = canBuild ? 'rgba(59, 130, 246, 0.25)' : 'rgba(239, 68, 68, 0.25)';

        this.ctx.beginPath();
        this.ctx.moveTo(px, py - this.halfH);
        this.ctx.lineTo(px + this.halfW, py);
        this.ctx.lineTo(px, py + this.halfH);
        this.ctx.lineTo(px - this.halfW, py);
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.stroke();
        this.ctx.restore();

        // Outline Blueprint Wireframe Previews
        if (canBuild && this.selectedTool !== 'select' && this.selectedTool !== 'bulldoze') {
            this.ctx.globalAlpha = 0.55;
            
            if (this.selectedTool === 'road') {
                this.ctx.fillStyle = '#6b7280';
                this.ctx.beginPath();
                this.ctx.moveTo(px, py - this.halfH + 1);
                this.ctx.lineTo(px + this.halfW - 1, py);
                this.ctx.lineTo(px, py + this.halfH - 1);
                this.ctx.lineTo(px - this.halfW + 1, py);
                this.ctx.closePath();
                this.ctx.fill();
            } else if (this.selectedTool === 'powerplant') {
                this.drawIsometricBox(px - 10, py + 4, 18, 22, '#ef4444', '#b91c1c', '#f87171');
            } else if (this.selectedTool === 'watertower') {
                this.ctx.strokeStyle = '#9ca3af';
                this.ctx.lineWidth = 1.5;
                this.ctx.beginPath();
                this.ctx.moveTo(px - 6, py + 6); this.ctx.lineTo(px, py - 22);
                this.ctx.moveTo(px + 6, py + 6); this.ctx.lineTo(px, py - 22);
                this.ctx.stroke();
            } else if (['residential', 'commercial', 'industrial'].includes(this.selectedTool)) {
                let borderCol = 'rgba(76, 175, 80, 0.6)';
                if (this.selectedTool === 'commercial') borderCol = 'rgba(33, 150, 243, 0.6)';
                if (this.selectedTool === 'industrial') borderCol = 'rgba(255, 152, 0, 0.6)';

                this.ctx.strokeStyle = borderCol;
                this.ctx.lineWidth = 2;
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
            this.ctx.arc(p.x, p.y, Math.max(1, p.life / 6), 0, Math.PI * 2);
            this.ctx.fill();
        }
        this.ctx.globalAlpha = 1.0;
    }

    // --- Draw Meteors ---
    drawMeteors() {
        for (const m of this.disasters.activeMeteors) {
            this.ctx.fillStyle = '#ef4444';
            this.ctx.beginPath();
            this.ctx.arc(m.x, m.y, 8, 0, Math.PI * 2);
            this.ctx.fill();
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
            this.ctx.arc(c.x + c.size * 0.5, c.y + c.size * 0.1, c.size * 0.6, 0, Math.PI * 2);
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
            r = 10; g = 12; b = 35;
            alpha = 0.35; // Soft night
            mixMode = 'multiply';
        }
        else if (totalHour >= 5 && totalHour < 7) {
            const factor = (totalHour - 5) / 2;
            r = Math.round(10 + (220 - 10) * (1 - factor));
            g = Math.round(12 + (110 - 12) * (1 - factor));
            b = Math.round(35 + (70 - 35) * (1 - factor));
            alpha = 0.35 * (1 - factor);
            mixMode = 'source-over';
        }
        else if (totalHour >= 7 && totalHour < 17) {
            alpha = 0;
        }
        else if (totalHour >= 17 && totalHour < 20) {
            const factor = (totalHour - 17) / 3;
            r = Math.round(170 * factor);
            g = Math.round(55 * factor);
            b = Math.round(110 * factor);
            alpha = 0.22 * factor;
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
