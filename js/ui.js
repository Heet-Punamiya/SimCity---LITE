import { Sound } from './sound.js';
import { GRID_SIZE } from './simulation.js';

export class UIManager {
    constructor(simulation, renderer, disasters) {
        this.sim = simulation;
        this.renderer = renderer;
        this.disasters = disasters;

        // Current Selected Tool state
        this.selectedTool = 'select'; // inspect is default
        this.selectedCost = 0;

        // Inspections state
        this.selectedGridCell = null;

        // Bind DOM elements
        this.bindElements();
        this.bindEvents();
    }

    bindElements() {
        this.elDate = document.getElementById('stat-date').querySelector('.value');
        this.elPopulation = document.getElementById('stat-population').querySelector('.value');
        this.elFunds = document.getElementById('stat-funds').querySelector('.value');
        this.elHappiness = document.getElementById('stat-happiness').querySelector('.value');
        this.elHappinessBar = document.getElementById('happiness-bar');

        // RCI Demand bars
        this.elRciRes = document.getElementById('rci-res');
        this.elRciCom = document.getElementById('rci-com');
        this.elRciInd = document.getElementById('rci-ind');

        // Speed buttons
        this.speedButtons = {
            pause: document.getElementById('speed-pause'),
            '1x': document.getElementById('speed-1x'),
            '2x': document.getElementById('speed-2x'),
            '5x': document.getElementById('speed-5x'),
        };

        // Tool buttons
        this.toolButtons = document.querySelectorAll('.tool-btn');

        // Overlay buttons
        this.overlayButtons = document.querySelectorAll('.overlay-btn');

        // Disaster buttons
        this.disasterFire = document.getElementById('disaster-fire');
        this.disasterMeteor = document.getElementById('disaster-meteor');
        this.disasterEarthquake = document.getElementById('disaster-earthquake');

        // Inspector elements
        this.inspectorEmpty = document.querySelector('.inspector-empty');
        this.inspectorData = document.querySelector('.inspector-data');
        this.inspType = document.getElementById('insp-type');
        this.inspLoc = document.getElementById('insp-loc');
        this.inspPower = document.getElementById('insp-power');
        this.inspWater = document.getElementById('insp-water');
        this.inspValue = document.getElementById('insp-val');
        this.inspPollution = document.getElementById('insp-pollution');
        this.inspCrime = document.getElementById('insp-crime');
        this.inspStatus = document.getElementById('insp-status');

        // Sound Toggle
        this.soundBtn = document.getElementById('sound-btn');

        // Storage buttons
        this.saveBtn = document.getElementById('save-btn');
        this.loadBtn = document.getElementById('load-btn');
        this.resetBtn = document.getElementById('reset-btn');

        // Modal
        this.introModal = document.getElementById('intro-modal');
        this.startGameBtn = document.getElementById('start-game-btn');
    }

    bindEvents() {
        // 1. Tool Selection
        this.toolButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                this.toolButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                this.selectedTool = btn.getAttribute('data-tool');
                const costAttr = btn.getAttribute('data-cost');
                this.selectedCost = costAttr ? parseInt(costAttr, 10) : 0;
            });
        });

        // 2. Map Overlay modes
        this.overlayButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                this.overlayButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                const overlay = btn.getAttribute('data-overlay');
                this.renderer.overlayMode = overlay;
            });
        });

        // 3. Disaster Triggers
        this.disasterFire.addEventListener('click', () => {
            const loc = this.disasters.triggerFire();
            if (loc) {
                this.showNotification(`🔥 Fire Outbreak reported at [X: ${loc.x}, Y: ${loc.y}]!`);
                // Pan camera to fire
                const screen = this.renderer.gridToScreen(loc.x, loc.y);
                this.renderer.offsetX = this.renderer.canvas.width / 2 - (loc.x - loc.y) * this.renderer.halfW * this.renderer.zoom;
                this.renderer.offsetY = this.renderer.canvas.height / 2 - (loc.x + loc.y) * this.renderer.halfH * this.renderer.zoom;
            }
        });

        this.disasterMeteor.addEventListener('click', () => {
            // Pick a random grid coordinate
            const tx = Math.floor(Math.random() * GRID_SIZE);
            const ty = Math.floor(Math.random() * GRID_SIZE);
            this.disasters.triggerMeteor(tx, ty);
            this.showNotification(`☄️ Meteor strike detected heading for [X: ${tx}, Y: ${ty}]!`);
        });

        this.disasterEarthquake.addEventListener('click', () => {
            this.disasters.triggerEarthquake();
            this.showNotification(`🫨 Tectonic shockwaves! Earthquake hits the city!`);
        });

        // 4. Game Speed Controller Hooks
        Object.keys(this.speedButtons).forEach(key => {
            this.speedButtons[key].addEventListener('click', () => {
                Object.values(this.speedButtons).forEach(b => b.classList.remove('active'));
                this.speedButtons[key].classList.add('active');

                // Trigger game loops update interval
                let multiplier = 1;
                switch (key) {
                    case 'pause': multiplier = 0; break;
                    case '1x': multiplier = 1; break;
                    case '2x': multiplier = 2; break;
                    case '5x': multiplier = 5; break;
                }
                
                // Dispatch event to main game manager
                const speedEvent = new CustomEvent('changeSpeed', { detail: { multiplier } });
                window.dispatchEvent(speedEvent);
            });
        });

        // 5. Sound system toggle
        this.soundBtn.addEventListener('click', () => {
            const state = Sound.toggle();
            this.soundBtn.textContent = state ? '🔊 Sound: On' : '🔇 Sound: Off';
        });

        // 6. Save, Load, and Reset Hooks
        this.saveBtn.addEventListener('click', () => {
            this.sim.save();
            this.showNotification('💾 City successfully saved to browser local storage!');
        });

        this.loadBtn.addEventListener('click', () => {
            const success = this.sim.load();
            if (success) {
                this.showNotification('📂 Saved data loaded successfully!');
                this.updateHUD();
                if (this.selectedGridCell) {
                    this.updateInspector(this.selectedGridCell.x, this.selectedGridCell.y);
                }
            } else {
                this.showNotification('⚠️ No previous save files located in this browser.');
            }
        });

        this.resetBtn.addEventListener('click', () => {
            if (confirm('Are you sure you want to demolish your current city and start fresh?')) {
                this.sim.initGrid();
                this.sim.funds = 100000;
                this.sim.population = 0;
                this.sim.happiness = 100;
                this.sim.date = new Date(2026, 0, 1);
                this.sim.demandRes = 50;
                this.sim.demandCom = 30;
                this.sim.demandInd = 30;
                this.sim.updateUtilities();
                this.sim.updateMapMetrics();
                
                this.showNotification('🚜 City reset. Construct a new metropolis!');
                this.updateHUD();
                this.clearInspector();
            }
        });

        // 7. Tutorial Start button
        this.startGameBtn.addEventListener('click', () => {
            this.introModal.style.opacity = '0';
            setTimeout(() => {
                this.introModal.classList.add('hidden');
                Sound.init(); // Warm up AudioContext on click
            }, 400);
        });
    }

    // --- Update stats shown in HUD ---
    updateHUD() {
        // Date
        const options = { day: '2-digit', month: 'short', year: 'numeric' };
        this.elDate.textContent = this.sim.date.toLocaleDateString('en-GB', options);

        // Stats
        this.elPopulation.textContent = this.sim.population.toLocaleString();
        
        // Finances color and indicator
        this.elFunds.textContent = (this.sim.funds < 0 ? '-' : '') + '$' + Math.abs(this.sim.funds).toLocaleString();
        if (this.sim.funds < 0) {
            this.elFunds.style.color = 'var(--neon-danger)';
            this.elFunds.style.textShadow = '0 0 8px var(--neon-danger)';
        } else {
            this.elFunds.style.color = 'var(--neon-cyan)';
            this.elFunds.style.textShadow = '0 0 8px rgba(0, 242, 254, 0.3)';
        }

        // Happiness
        this.elHappiness.textContent = `${this.sim.happiness}%`;
        this.elHappinessBar.style.width = `${this.sim.happiness}%`;
        if (this.sim.happiness > 70) {
            this.elHappinessBar.style.backgroundColor = 'var(--neon-success)';
            this.elHappinessBar.style.boxShadow = '0 0 6px var(--neon-success)';
        } else if (this.sim.happiness > 40) {
            this.elHappinessBar.style.backgroundColor = 'var(--neon-yellow)';
            this.elHappinessBar.style.boxShadow = '0 0 6px var(--neon-yellow)';
        } else {
            this.elHappinessBar.style.backgroundColor = 'var(--neon-danger)';
            this.elHappinessBar.style.boxShadow = '0 0 6px var(--neon-danger)';
        }

        // Demand bars: map -100...100 -> 0%...100%
        const setBarHeight = (bar, demand) => {
            const h = Math.round((demand + 100) / 2);
            bar.style.height = `${h}%`;
        };
        setBarHeight(this.elRciRes, this.sim.demandRes);
        setBarHeight(this.elRciCom, this.sim.demandCom);
        setBarHeight(this.elRciInd, this.sim.demandInd);

        // Update inspector on active details panel if open
        if (this.selectedGridCell) {
            this.updateInspector(this.selectedGridCell.x, this.selectedGridCell.y);
        }
    }

    // --- Inspector Panel details controller ---
    updateInspector(x, y) {
        if (!this.sim.isValidCoords(x, y)) return;
        const tile = this.sim.grid[x][y];

        this.selectedGridCell = { x, y };

        this.inspectorEmpty.classList.add('hidden');
        this.inspectorData.classList.remove('hidden');

        // Formats
        let typeStr = tile.type.toUpperCase();
        if (tile.rubble) typeStr = 'RUINS / RUBBLE';
        else if (tile.fireActive) typeStr = '🔥 ON FIRE';
        else if (tile.abandoned) typeStr = `ABANDONED ${typeStr}`;
        else if (['residential', 'commercial', 'industrial'].includes(tile.type) && tile.density > 0) {
            const size = ['Empty', 'Low Density', 'Medium Density', 'High Density', 'Skyscraper'][tile.density];
            typeStr = `${size} (${typeStr})`;
        }

        this.inspType.textContent = typeStr;
        this.inspLoc.textContent = `X: ${x}, Y: ${y}`;
        
        // Power/Water
        const isMunicipalConductor = ['powerline', 'waterpipe', 'road', 'powerplant', 'watertower', 'police', 'fire', 'park'].includes(tile.type);
        if (isMunicipalConductor) {
            this.inspPower.textContent = tile.powered ? 'Conducting' : 'Disconnected';
            this.inspWater.textContent = tile.watered ? 'Conducting' : 'Disconnected';
        } else {
            this.inspPower.textContent = tile.powered ? 'Yes' : 'No electricity';
            this.inspWater.textContent = tile.watered ? 'Yes' : 'No water';
        }

        this.inspPower.style.color = tile.powered ? 'var(--neon-green)' : 'var(--neon-danger)';
        this.inspWater.style.color = tile.watered ? 'var(--neon-green)' : 'var(--neon-danger)';

        this.inspValue.textContent = `${tile.landValue} / 100`;
        this.inspPollution.textContent = `${tile.pollution} ppm`;
        this.inspCrime.textContent = `${tile.crime}%`;

        // Status messages
        let status = 'Normal';
        if (tile.rubble) status = 'Demolish to build new';
        else if (tile.fireActive) status = 'Immediate fire hazard!';
        else if (tile.abandoned) status = 'Neglected. Supply utilities to attract occupants';
        else if (tile.type.includes('zone') || ['residential', 'commercial', 'industrial'].includes(tile.type)) {
            if (!tile.powered || !tile.watered) {
                status = 'Growth stunted - Lack of resources';
            } else if (tile.density === 0) {
                status = 'Zoned. Awaiting development demand';
            } else if (tile.density === 4) {
                status = 'Fully Developed Skyscraper';
            } else {
                status = 'Developing / Healthy';
            }
        } else if (tile.type === 'powerplant') {
            status = 'Supplying power grid';
        } else if (tile.type === 'watertower') {
            status = 'Supplying water conduits';
        }

        this.inspStatus.textContent = status;
    }

    clearInspector() {
        this.selectedGridCell = null;
        this.inspectorEmpty.classList.remove('hidden');
        this.inspectorData.classList.add('hidden');
    }

    // --- Floating HUD Alert messages ---
    showNotification(message) {
        // Create dynamic message banner
        const notif = document.createElement('div');
        notif.className = 'hud-notification glass';
        notif.style.position = 'absolute';
        notif.style.bottom = '80px';
        notif.style.right = '15px';
        notif.style.padding = '12px 20px';
        notif.style.fontSize = '14px';
        notif.style.fontWeight = '600';
        notif.style.color = '#ffffff';
        notif.style.borderLeft = '4px solid var(--neon-cyan)';
        notif.style.zIndex = '50';
        notif.style.animation = 'slideInRight 0.3s ease-out';
        notif.textContent = message;

        // Slide animation injection
        if (!document.getElementById('notif-style')) {
            const style = document.createElement('style');
            style.id = 'notif-style';
            style.innerHTML = `
                @keyframes slideInRight {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                @keyframes fadeOut {
                    to { opacity: 0; transform: translateY(10px); }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(notif);

        // Fade and delete
        setTimeout(() => {
            notif.style.animation = 'fadeOut 0.4s ease-in forwards';
            setTimeout(() => notif.remove(), 400);
        }, 4000);
    }
}
