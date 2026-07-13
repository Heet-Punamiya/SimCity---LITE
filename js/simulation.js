import { Sound } from './sound.js';

export const GRID_SIZE = 20;

export class Tile {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.type = 'empty'; // 'empty', 'road', 'powerline', 'waterpipe', 'residential', 'commercial', 'industrial', 'powerplant', 'watertower', 'police', 'fire', 'park'
        
        // Utilities
        this.powered = false;
        this.watered = false;
        
        // Metrics
        this.density = 0; // 0 (empty zone) to 4 (high-rise)
        this.pollution = 0; // 0 to 100
        this.landValue = 20; // 0 to 100
        this.crime = 10; // 0 to 100
        this.fireRisk = 5; // 0 to 100
        
        // Status Flags
        this.abandoned = false;
        this.fireActive = false;
        this.rubble = false;
        
        this.abandonedTimer = 0; // Months unpowered/unwatered
    }
}

export class Simulation {
    constructor() {
        this.grid = [];
        this.funds = 100000;
        this.population = 0;
        this.happiness = 100;
        this.taxRate = 9; // percentage (1 to 20)
        
        // Game Clock
        this.date = new Date(2026, 0, 1); // 1 Jan 2026
        
        // RCI Demands
        this.demandRes = 50;
        this.demandCom = 30;
        this.demandInd = 30;
        
        // Financial tracking for current month
        this.monthlyTaxes = 0;
        this.monthlyUpkeep = 0;
        
        this.initGrid();
    }

    initGrid() {
        this.grid = [];
        for (let x = 0; x < GRID_SIZE; x++) {
            this.grid[x] = [];
            for (let y = 0; y < GRID_SIZE; y++) {
                this.grid[x][y] = new Tile(x, y);
            }
        }
    }

    // --- Core Simulation Tick (Executes every game day) ---
    tick() {
        // Increment date by 1 day
        this.date.setDate(this.date.getDate() + 1);
        const day = this.date.getDate();

        // Perform resource grid traversal (electricity & water routing)
        this.updateUtilities();

        // Calculate environmental factors (pollution, crime, land value)
        this.updateMapMetrics();

        // Zone growth and population density changes
        this.updateZoneGrowth();

        // Monthly Financial Reconciliation
        if (day === 1) {
            this.reconcileMonthlyFinances();
        }

        // Keep RCI demands in bounds
        this.updateRCIDemand();
    }

    // --- Utility Routing (BFS Network Traversal) ---
    updateUtilities() {
        // Reset utilities
        for (let x = 0; x < GRID_SIZE; x++) {
            for (let y = 0; y < GRID_SIZE; y++) {
                this.grid[x][y].powered = false;
                this.grid[x][y].watered = false;
            }
        }

        // Conductors that carry electricity
        const conductsPower = (tile) => {
            return ['powerline', 'road', 'powerplant', 'watertower', 'police', 'fire', 'park'].includes(tile.type) && !tile.rubble;
        };

        // Conductors that carry water
        const conductsWater = (tile) => {
            return ['waterpipe', 'road', 'powerplant', 'watertower', 'police', 'fire', 'park'].includes(tile.type) && !tile.rubble;
        };

        // 1. Trace Power
        const powerSources = [];
        for (let x = 0; x < GRID_SIZE; x++) {
            for (let y = 0; y < GRID_SIZE; y++) {
                if (this.grid[x][y].type === 'powerplant' && !this.grid[x][y].rubble) {
                    powerSources.push(this.grid[x][y]);
                    this.grid[x][y].powered = true;
                }
            }
        }

        if (powerSources.length > 0) {
            const queue = [...powerSources];
            const visited = new Set();
            queue.forEach(t => visited.add(`${t.x},${t.y}`));

            while (queue.length > 0) {
                const current = queue.shift();
                const neighbors = this.getNeighbors(current.x, current.y);
                for (const n of neighbors) {
                    const key = `${n.x},${n.y}`;
                    if (!visited.has(key) && conductsPower(n)) {
                        visited.add(key);
                        n.powered = true;
                        queue.push(n);
                    }
                }
            }

            // Power propagates to adjacent tiles (within 2 steps of any powered conductor)
            for (let x = 0; x < GRID_SIZE; x++) {
                for (let y = 0; y < GRID_SIZE; y++) {
                    const tile = this.grid[x][y];
                    if (tile.powered) continue;
                    
                    // Search radius 2 for any powered conductor
                    outerPower:
                    for (let dx = -2; dx <= 2; dx++) {
                        for (let dy = -2; dy <= 2; dy++) {
                            const nx = x + dx;
                            const ny = y + dy;
                            if (this.isValidCoords(nx, ny)) {
                                const cond = this.grid[nx][ny];
                                if (cond.powered && conductsPower(cond)) {
                                    tile.powered = true;
                                    break outerPower;
                                }
                            }
                        }
                    }
                }
            }
        }

        // 2. Trace Water
        const waterSources = [];
        for (let x = 0; x < GRID_SIZE; x++) {
            for (let y = 0; y < GRID_SIZE; y++) {
                if (this.grid[x][y].type === 'watertower' && !this.grid[x][y].rubble) {
                    waterSources.push(this.grid[x][y]);
                    this.grid[x][y].watered = true;
                }
            }
        }

        if (waterSources.length > 0) {
            const queue = [...waterSources];
            const visited = new Set();
            queue.forEach(t => visited.add(`${t.x},${t.y}`));

            while (queue.length > 0) {
                const current = queue.shift();
                const neighbors = this.getNeighbors(current.x, current.y);
                for (const n of neighbors) {
                    const key = `${n.x},${n.y}`;
                    if (!visited.has(key) && conductsWater(n)) {
                        visited.add(key);
                        n.watered = true;
                        queue.push(n);
                    }
                }
            }

            // Water propagates to adjacent tiles (within 2 steps of any watered conductor)
            for (let x = 0; x < GRID_SIZE; x++) {
                for (let y = 0; y < GRID_SIZE; y++) {
                    const tile = this.grid[x][y];
                    if (tile.watered) continue;

                    // Search radius 2 for any watered conductor
                    outerWater:
                    for (let dx = -2; dx <= 2; dx++) {
                        for (let dy = -2; dy <= 2; dy++) {
                            const nx = x + dx;
                            const ny = y + dy;
                            if (this.isValidCoords(nx, ny)) {
                                const cond = this.grid[nx][ny];
                                if (cond.watered && conductsWater(cond)) {
                                    tile.watered = true;
                                    break outerWater;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // --- Calculate Crime, Pollution, and Land Values ---
    updateMapMetrics() {
        // Scan municipal building coverages
        const policeCoverage = [];
        const fireCoverage = [];
        const parkCoverage = [];
        const pollutionSources = [];

        for (let x = 0; x < GRID_SIZE; x++) {
            for (let y = 0; y < GRID_SIZE; y++) {
                const t = this.grid[x][y];
                if (t.rubble) continue;

                if (t.type === 'police' && t.powered) {
                    policeCoverage.push({ x, y, radius: 6 });
                } else if (t.type === 'fire' && t.powered) {
                    fireCoverage.push({ x, y, radius: 6 });
                } else if (t.type === 'park') {
                    parkCoverage.push({ x, y, radius: 4 });
                } else if (t.type === 'powerplant') {
                    pollutionSources.push({ x, y, strength: 80, radius: 6 });
                } else if (t.type === 'industrial' && t.density > 0) {
                    pollutionSources.push({ x, y, strength: 10 * t.density, radius: 3 });
                }
            }
        }

        // Apply grid metric updates
        for (let x = 0; x < GRID_SIZE; x++) {
            for (let y = 0; y < GRID_SIZE; y++) {
                const tile = this.grid[x][y];
                
                // 1. Pollution
                let pollution = 0;
                for (const src of pollutionSources) {
                    const dist = Math.hypot(x - src.x, y - src.y);
                    if (dist <= src.radius) {
                        pollution += src.strength * (1 - dist / src.radius);
                    }
                }
                tile.pollution = Math.min(100, Math.round(pollution));

                // 2. Crime
                let underPolice = false;
                for (const pc of policeCoverage) {
                    const dist = Math.hypot(x - pc.x, y - pc.y);
                    if (dist <= pc.radius) {
                        underPolice = true;
                        break;
                    }
                }
                let crimeBase = 15;
                if (tile.type === 'commercial') crimeBase += 10;
                if (tile.type === 'residential' && tile.density > 2) crimeBase += 15;
                tile.crime = underPolice ? Math.max(5, Math.round(crimeBase * 0.2)) : Math.min(100, crimeBase + 10);

                // 3. Fire Risk
                let underFire = false;
                for (const fc of fireCoverage) {
                    const dist = Math.hypot(x - fc.x, y - fc.y);
                    if (dist <= fc.radius) {
                        underFire = true;
                        break;
                    }
                }
                let fireRiskBase = 10;
                if (tile.type === 'industrial') fireRiskBase += 25;
                if (tile.type === 'powerplant') fireRiskBase += 30;
                tile.fireRisk = underFire ? Math.max(2, Math.round(fireRiskBase * 0.15)) : Math.min(100, fireRiskBase);

                // Extinguish active fires if fire station covers it
                if (tile.fireActive && underFire) {
                    tile.fireActive = false;
                    tile.rubble = true; // Turn it to rubble (player must bulldoze)
                }

                // 4. Land Value
                let parkBonus = 0;
                for (const pk of parkCoverage) {
                    const dist = Math.hypot(x - pk.x, y - pk.y);
                    if (dist <= pk.radius) {
                        parkBonus += 30 * (1 - dist / pk.radius);
                    }
                }
                let value = 25 + parkBonus;
                value -= tile.pollution * 0.4;
                value -= tile.crime * 0.3;
                if (tile.powered) value += 10;
                if (tile.watered) value += 10;

                tile.landValue = Math.max(5, Math.min(100, Math.round(value)));
            }
        }
    }

    // --- Growth Engine ---
    updateZoneGrowth() {
        let currentPopulation = 0;
        let activeJobs = 0;

        for (let x = 0; x < GRID_SIZE; x++) {
            for (let y = 0; y < GRID_SIZE; y++) {
                const tile = this.grid[x][y];
                if (tile.rubble || tile.fireActive) {
                    tile.density = 0;
                    continue;
                }

                const isZoned = ['residential', 'commercial', 'industrial'].includes(tile.type);
                if (!isZoned) continue;

                // Abandonment check
                const missingUtilities = !tile.powered || !tile.watered;
                if (missingUtilities) {
                    tile.abandonedTimer++;
                    // If utility is missing for 30 ticks (approx 1 month), abandon the building
                    if (tile.abandonedTimer > 30 && tile.density > 0) {
                        tile.abandoned = true;
                        tile.density = 0;
                    }
                } else {
                    tile.abandonedTimer = 0;
                    if (tile.abandoned) {
                        tile.abandoned = false; // Re-occupied
                    }
                }

                if (tile.abandoned) continue;

                // Handle Growth Stages
                const roll = Math.random() * 100;
                if (tile.powered && tile.watered) {
                    // Residential Growth
                    if (tile.type === 'residential') {
                        if (this.demandRes > 0 && tile.density < 4 && roll < 5 && tile.landValue > 30 + tile.density * 10) {
                            tile.density++;
                            this.demandRes -= 2;
                        } else if (this.demandRes < -20 && tile.density > 1 && roll < 3) {
                            tile.density--;
                            this.demandRes += 1;
                        }
                    }
                    // Commercial Growth
                    else if (tile.type === 'commercial') {
                        if (this.demandCom > 0 && tile.density < 4 && roll < 5 && tile.landValue > 40 + tile.density * 8) {
                            tile.density++;
                            this.demandCom -= 3;
                        } else if (this.demandCom < -20 && tile.density > 1 && roll < 3) {
                            tile.density--;
                            this.demandCom += 1.5;
                        }
                    }
                    // Industrial Growth
                    else if (tile.type === 'industrial') {
                        if (this.demandInd > 0 && tile.density < 4 && roll < 5 && tile.pollution < 80) {
                            tile.density++;
                            this.demandInd -= 3;
                        } else if (this.demandInd < -20 && tile.density > 1 && roll < 3) {
                            tile.density--;
                            this.demandInd += 1.5;
                        }
                    }
                }

                // Tallies
                if (tile.type === 'residential') {
                    const popMap = [0, 5, 20, 75, 250]; // Population per stage
                    currentPopulation += popMap[tile.density];
                } else if (tile.type === 'commercial') {
                    const jobMap = [0, 4, 15, 60, 200];
                    activeJobs += jobMap[tile.density];
                } else if (tile.type === 'industrial') {
                    const jobMap = [0, 8, 25, 80, 250];
                    activeJobs += jobMap[tile.density];
                }
            }
        }

        // Level up chime if population hits milestones!
        if (currentPopulation > this.population && this.population > 0) {
            const oldMilestone = Math.floor(this.population / 1000);
            const newMilestone = Math.floor(currentPopulation / 1000);
            if (newMilestone > oldMilestone) {
                Sound.playLevelUp();
            }
        }

        this.population = currentPopulation;
    }

    // --- Update Economic Demand ---
    updateRCIDemand() {
        // Calculate employment and economic health
        let totalResTiles = 0;
        let totalComTiles = 0;
        let totalIndTiles = 0;

        for (let x = 0; x < GRID_SIZE; x++) {
            for (let y = 0; y < GRID_SIZE; y++) {
                const t = this.grid[x][y];
                if (t.type === 'residential') totalResTiles++;
                if (t.type === 'commercial') totalComTiles++;
                if (t.type === 'industrial') totalIndTiles++;
            }
        }

        // Formulaic demand balance
        const taxFactor = (10 - this.taxRate) * 4; // Higher taxes = lower demand
        
        // R Demand: Driven by jobs and overall satisfaction
        const jobRatio = (totalComTiles + totalIndTiles * 1.5) / Math.max(1, totalResTiles);
        this.demandRes += (jobRatio - 1) * 2 + taxFactor * 0.2;
        
        // C Demand: Driven by population size and business ratio
        const spendingRatio = totalResTiles / Math.max(1, totalComTiles);
        this.demandCom += (spendingRatio - 1.2) * 1.5 + taxFactor * 0.15;
        
        // I Demand: Driven by work pool and business ratio
        const industrialRatio = (totalResTiles + totalComTiles * 0.5) / Math.max(1, totalIndTiles);
        this.demandInd += (industrialRatio - 1.5) * 1.2 + taxFactor * 0.1;

        // Keep bounds between -100 and 100
        this.demandRes = Math.max(-100, Math.min(100, Math.round(this.demandRes)));
        this.demandCom = Math.max(-100, Math.min(100, Math.round(this.demandCom)));
        this.demandInd = Math.max(-100, Math.min(100, Math.round(this.demandInd)));

        // Update overall City Happiness
        let sumHappiness = 0;
        let countedTiles = 0;

        for (let x = 0; x < GRID_SIZE; x++) {
            for (let y = 0; y < GRID_SIZE; y++) {
                const tile = this.grid[x][y];
                if (tile.type === 'residential' && tile.density > 0) {
                    let tileHapp = 100;
                    tileHapp -= tile.crime * 0.5;
                    tileHapp -= tile.pollution * 0.3;
                    if (!tile.powered) tileHapp -= 30;
                    if (!tile.watered) tileHapp -= 20;
                    tileHapp -= (this.taxRate - 8) * 4; // Citizens hate tax rates above 8%
                    sumHappiness += Math.max(0, Math.min(100, tileHapp));
                    countedTiles++;
                }
            }
        }

        this.happiness = countedTiles > 0 ? Math.round(sumHappiness / countedTiles) : 100;
    }

    // --- Monthly Finances (Upkeep & Tax Collection) ---
    reconcileMonthlyFinances() {
        this.monthlyTaxes = 0;
        this.monthlyUpkeep = 0;

        for (let x = 0; x < GRID_SIZE; x++) {
            for (let y = 0; y < GRID_SIZE; y++) {
                const tile = this.grid[x][y];
                if (tile.rubble) continue;

                // 1. Taxes
                if (tile.powered && tile.watered && !tile.abandoned) {
                    if (tile.type === 'residential') {
                        this.monthlyTaxes += tile.density * 5 * (this.taxRate / 10);
                    } else if (tile.type === 'commercial') {
                        this.monthlyTaxes += tile.density * 10 * (this.taxRate / 10);
                    } else if (tile.type === 'industrial') {
                        this.monthlyTaxes += tile.density * 15 * (this.taxRate / 10);
                    }
                }

                // 2. Upkeep
                switch (tile.type) {
                    case 'road':
                        this.monthlyUpkeep += 1;
                        break;
                    case 'powerline':
                    case 'waterpipe':
                        this.monthlyUpkeep += 0.2;
                        break;
                    case 'powerplant':
                        this.monthlyUpkeep += 100;
                        break;
                    case 'watertower':
                        this.monthlyUpkeep += 50;
                        break;
                    case 'police':
                    case 'fire':
                        this.monthlyUpkeep += 80;
                        break;
                    case 'park':
                        this.monthlyUpkeep += 20;
                        break;
                }
            }
        }

        this.monthlyTaxes = Math.round(this.monthlyTaxes);
        this.monthlyUpkeep = Math.round(this.monthlyUpkeep);
        
        // Update total bankroll
        this.funds += (this.monthlyTaxes - this.monthlyUpkeep);
    }

    // --- Place Building Tool ---
    build(x, y, type, cost) {
        if (!this.isValidCoords(x, y)) return false;

        const tile = this.grid[x][y];

        // Bulldozer clears anything
        if (type === 'bulldoze') {
            if (tile.type === 'empty' && !tile.rubble && !tile.fireActive) return false;
            if (this.funds < cost) return false;
            
            tile.type = 'empty';
            tile.density = 0;
            tile.rubble = false;
            tile.fireActive = false;
            tile.abandoned = false;
            this.funds -= cost;
            Sound.playBulldoze();
            this.updateUtilities();
            return true;
        }

        // Regular build placement
        if (tile.type !== 'empty' || tile.rubble || tile.fireActive) return false;
        if (this.funds < cost) return false;

        tile.type = type;
        tile.density = 0;
        tile.rubble = false;
        tile.abandoned = false;
        this.funds -= cost;
        Sound.playBuild();
        
        this.updateUtilities();
        return true;
    }

    // --- Helpers ---
    isValidCoords(x, y) {
        return x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE;
    }

    getNeighbors(x, y) {
        const neighbors = [];
        const dirs = [
            { x: -1, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: -1 },
            { x: 0, y: 1 }
        ];
        for (const d of dirs) {
            const nx = x + d.x;
            const ny = y + d.y;
            if (this.isValidCoords(nx, ny)) {
                neighbors.push(this.grid[nx][ny]);
            }
        }
        return neighbors;
    }

    // --- Save/Load Serializers ---
    save() {
        const saveData = {
            funds: this.funds,
            population: this.population,
            happiness: this.happiness,
            taxRate: this.taxRate,
            dateString: this.date.toISOString(),
            demandRes: this.demandRes,
            demandCom: this.demandCom,
            demandInd: this.demandInd,
            grid: []
        };

        for (let x = 0; x < GRID_SIZE; x++) {
            saveData.grid[x] = [];
            for (let y = 0; y < GRID_SIZE; y++) {
                const t = this.grid[x][y];
                saveData.grid[x][y] = {
                    type: t.type,
                    density: t.density,
                    abandoned: t.abandoned,
                    rubble: t.rubble,
                    fireActive: t.fireActive
                };
            }
        }

        localStorage.setItem('simcity_lite_save', JSON.stringify(saveData));
    }

    load() {
        const raw = localStorage.getItem('simcity_lite_save');
        if (!raw) return false;

        try {
            const data = JSON.parse(raw);
            this.funds = data.funds;
            this.population = data.population;
            this.happiness = data.happiness;
            this.taxRate = data.taxRate;
            this.date = new Date(data.dateString);
            this.demandRes = data.demandRes;
            this.demandCom = data.demandCom;
            this.demandInd = data.demandInd;

            this.initGrid();
            for (let x = 0; x < GRID_SIZE; x++) {
                for (let y = 0; y < GRID_SIZE; y++) {
                    const savedTile = data.grid[x][y];
                    const t = this.grid[x][y];
                    t.type = savedTile.type;
                    t.density = savedTile.density;
                    t.abandoned = savedTile.abandoned;
                    t.rubble = savedTile.rubble;
                    t.fireActive = savedTile.fireActive;
                }
            }

            this.updateUtilities();
            this.updateMapMetrics();
            return true;
        } catch (e) {
            console.error('Failed to parse save game data', e);
            return false;
        }
    }
}
