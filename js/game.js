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

        // Interaction States
        this.isLeftDown = false;
        this.isRightDown = false;
        this.lastX = 0;
        this.lastY = 0;
        
        // Anti-repetitive double build checks on left-drag
        this.lastBuiltX = null;
        this.lastBuiltY = null;
        
        // Simulation loops
        this.simInterval = null;
        this.simSpeed = 1000; // ms per simulated day
        
        this.initCanvas();
        this.bindEvents();
        this.startSimulation(1000); // Start normal speed
        this.animate();
    }

    initCanvas() {
        const resize = () => {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
            
            if (this.renderer.offsetX === 0 && this.renderer.offsetY === 0) {
                this.renderer.offsetX = this.canvas.width / 2;
                this.renderer.offsetY = this.canvas.height / 3;
            }
        };
        window.addEventListener('resize', resize);
        resize();
        
        this.renderer.offsetX = this.canvas.width / 2;
        this.renderer.offsetY = this.canvas.height / 4;
        this.renderer.zoom = 1.0;
    }

    bindEvents() {
        // Prevent default Right Click context menu on the simulation viewport
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        // --- Mouse Down ---
        this.canvas.addEventListener('mousedown', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const clickY = e.clientY - rect.top;

            // Resolve clicked cell
            const grid = this.renderer.screenToGrid(clickX, clickY);

            if (e.button === 0) {
                // Left Mouse Button: Click to select/build, or start drag paint-building
                this.isLeftDown = true;
                this.lastBuiltX = null;
                this.lastBuiltY = null;
                
                // Build/Select immediately on click down
                this.handleGridAction(grid.x, grid.y, false);
            } 
            else if (e.button === 2 || e.button === 1) {
                // Right or Middle Mouse Button: Start camera panning
                this.isRightDown = true;
                this.lastX = e.clientX;
                this.lastY = e.clientY;
            }
        });

        // --- Mouse Move ---
        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            // Resolve hovered coordinates
            const grid = this.renderer.screenToGrid(mouseX, mouseY);

            // Feed hovered indices to the renderer
            this.renderer.hoverX = grid.x;
            this.renderer.hoverY = grid.y;
            this.renderer.selectedTool = this.ui.selectedTool;
            this.renderer.selectedCost = this.ui.selectedCost;

            // 1. Camera Panning (Right Click Drag)
            if (this.isRightDown) {
                const dx = e.clientX - this.lastX;
                const dy = e.clientY - this.lastY;

                this.renderer.offsetX += dx;
                this.renderer.offsetY += dy;

                this.lastX = e.clientX;
                this.lastY = e.clientY;
            }

            // 2. Drag Paint-Building (Left Click Drag)
            if (this.isLeftDown && this.ui.selectedTool !== 'select') {
                this.handleGridAction(grid.x, grid.y, true); // true = paint-building drag mode
            }
        });

        // --- Mouse Up / Leave ---
        const resetMouseStates = () => {
            this.isLeftDown = false;
            this.isRightDown = false;
            this.lastBuiltX = null;
            this.lastBuiltY = null;
        };

        this.canvas.addEventListener('mouseup', resetMouseStates);
        this.canvas.addEventListener('mouseleave', () => {
            resetMouseStates();
            this.renderer.hoverX = null;
            this.renderer.hoverY = null;
        });

        // --- Scroll Zoom ---
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const zoomIntensity = 0.08;
            const factor = e.deltaY < 0 ? (1 + zoomIntensity) : (1 - zoomIntensity);

            this.renderer.offsetX = mouseX - (mouseX - this.renderer.offsetX) * factor;
            this.renderer.offsetY = mouseY - (mouseY - this.renderer.offsetY) * factor;
            this.renderer.zoom = Math.max(0.4, Math.min(2.5, this.renderer.zoom * factor));
        }, { passive: false });

        // --- Speed Change Custom Event ---
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

    // --- Core Action Executor (Build or Select) ---
    handleGridAction(gridX, gridY, isDragPainting) {
        if (!this.sim.isValidCoords(gridX, gridY)) return;

        const tool = this.ui.selectedTool;

        // Inspect Mode
        if (tool === 'select') {
            if (!isDragPainting) {
                this.ui.updateInspector(gridX, gridY);
            }
            return;
        }

        // Build/Bulldoze Mode
        // Prevent continuous duplicate builds on the exact same tile during drag painting
        if (this.lastBuiltX === gridX && this.lastBuiltY === gridY) return;

        const cost = this.ui.selectedCost;
        const success = this.sim.build(gridX, gridY, tool, cost);

        if (success) {
            this.lastBuiltX = gridX;
            this.lastBuiltY = gridY;
            this.ui.updateHUD();

            // Spawn particles
            this.disasters.spawnExplosionParticles(gridX, gridY, 5);

            // Update details sidebar inspector
            this.ui.updateInspector(gridX, gridY);
        } else {
            // Only trigger low funds alerts on initial click down (not during drag paint)
            if (!isDragPainting && this.sim.funds < cost) {
                this.ui.showNotification(`⚠️ Insufficient funds to construct building ($${cost.toLocaleString()})!`);
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
        this.disasters.update();
        this.renderer.draw();
        requestAnimationFrame(() => this.animate());
    }
}

window.addEventListener('load', () => {
    window.game = new GameController();
});
