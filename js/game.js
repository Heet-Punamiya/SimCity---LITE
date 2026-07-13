import { Simulation, GRID_SIZE } from './simulation.js';
import { Renderer } from './renderer.js';
import { DisasterManager } from './disaster.js';
import { UIManager } from './ui.js';

class GameController {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        
        // Initialize Core Engines
        this.sim = new Simulation();
        this.disasters = new DisasterManager(this.sim);
        this.renderer = new Renderer(this.canvas, this.sim, this.disasters);
        this.ui = new UIManager(this.sim, this.renderer, this.disasters);

        // Interaction state
        this.isDragging = false;
        this.dragged = false;
        this.lastX = 0;
        this.lastY = 0;
        
        // Simulation loops
        this.simInterval = null;
        this.simSpeed = 1000; // ms per simulated day (Normal speed = 1x)
        
        this.initCanvas();
        this.bindEvents();
        this.startSimulation(1000); // Start normal speed
        this.animate();
    }

    initCanvas() {
        const resize = () => {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
            
            // Adjust camera defaults if not set
            if (this.renderer.offsetX === 0 && this.renderer.offsetY === 0) {
                this.renderer.offsetX = this.canvas.width / 2;
                this.renderer.offsetY = this.canvas.height / 3;
            }
        };
        window.addEventListener('resize', resize);
        resize();
        
        // Center the camera on grid start
        this.renderer.offsetX = this.canvas.width / 2;
        this.renderer.offsetY = this.canvas.height / 4;
        this.renderer.zoom = 1.0;
    }

    bindEvents() {
        // --- Drag & Click Mouse Events ---
        this.canvas.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            this.dragged = false;
            this.lastX = e.clientX;
            this.lastY = e.clientY;
        });

        this.canvas.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;

            const dx = e.clientX - this.lastX;
            const dy = e.clientY - this.lastY;

            if (Math.hypot(dx, dy) > 2) {
                this.dragged = true;
            }

            this.renderer.offsetX += dx;
            this.renderer.offsetY += dy;

            this.lastX = e.clientX;
            this.lastY = e.clientY;
        });

        this.canvas.addEventListener('mouseup', (e) => {
            this.isDragging = false;

            // If mouse didn't drag, count it as a click action
            if (!this.dragged) {
                this.handleGridClick(e.clientX, e.clientY);
            }
        });

        // --- Zoom Event ---
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const zoomIntensity = 0.08;
            const factor = e.deltaY < 0 ? (1 + zoomIntensity) : (1 - zoomIntensity);

            // Zoom centered towards mouse cursor
            this.renderer.offsetX = mouseX - (mouseX - this.renderer.offsetX) * factor;
            this.renderer.offsetY = mouseY - (mouseY - this.renderer.offsetY) * factor;
            this.renderer.zoom = Math.max(0.4, Math.min(2.5, this.renderer.zoom * factor));
        }, { passive: false });

        // --- Speed Change Handler ---
        window.addEventListener('changeSpeed', (e) => {
            const mult = e.detail.multiplier;
            if (mult === 0) {
                this.stopSimulation();
            } else {
                let speedMs = 1000;
                if (mult === 2) speedMs = 400; // 2x speed
                if (mult === 5) speedMs = 120; // 5x speed
                this.startSimulation(speedMs);
            }
        });
    }

    // --- Resolve Tile Click Action ---
    handleGridClick(screenX, screenY) {
        const rect = this.canvas.getBoundingClientRect();
        const clientX = screenX - rect.left;
        const clientY = screenY - rect.top;

        // Convert coordinates back to isometric math grid indices
        const grid = this.renderer.screenToGrid(clientX, clientY);

        if (!this.sim.isValidCoords(grid.x, grid.y)) {
            // Clicked outside active grid
            this.ui.clearInspector();
            return;
        }

        const tool = this.ui.selectedTool;

        if (tool === 'select') {
            // Inspect mode
            this.ui.updateInspector(grid.x, grid.y);
        } else {
            // Construction Mode
            const cost = this.ui.selectedCost;
            const success = this.sim.build(grid.x, grid.y, tool, cost);
            
            if (success) {
                this.ui.updateHUD();
                
                // Spawn small dust particles
                this.disasters.spawnExplosionParticles(grid.x, grid.y, 6);
                
                // Keep inspector updated
                this.ui.updateInspector(grid.x, grid.y);
            } else {
                // Flash notification if funds low
                if (this.sim.funds < cost) {
                    this.ui.showNotification(`⚠️ Insufficient funds to construct building ($${cost.toLocaleString()})!`);
                }
            }
        }
    }

    // --- Simulation Intervals Control ---
    startSimulation(speedMs) {
        this.stopSimulation();
        this.simSpeed = speedMs;
        
        this.simInterval = setInterval(() => {
            const oldMonth = this.sim.date.getMonth();

            this.sim.tick();
            this.ui.updateHUD();

            // Auto-save city every game month
            const newMonth = this.sim.date.getMonth();
            if (newMonth !== oldMonth) {
                this.sim.save();
                this.ui.showNotification('💾 Auto-save complete.');
            }
        }, this.simSpeed);
    }

    stopSimulation() {
        if (this.simInterval) {
            clearInterval(this.simInterval);
            this.simInterval = null;
        }
    }

    // --- 60fps Animation Loop ---
    animate() {
        // Tick disaster and particle physics
        this.disasters.update();

        // Render Canvas
        this.renderer.draw();

        requestAnimationFrame(() => this.animate());
    }
}

// Instantiate game controller on load
window.addEventListener('load', () => {
    window.game = new GameController();
});
