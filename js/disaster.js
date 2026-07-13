import { Sound } from './sound.js';
import { GRID_SIZE } from './simulation.js';

export class Particle {
    constructor(x, y, color, vx, vy, maxLife) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.vx = vx;
        this.vy = vy;
        this.life = maxLife;
        this.maxLife = maxLife;
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.life--;
    }

    getAlpha() {
        return Math.max(0, this.life / this.maxLife);
    }
}

export class DisasterManager {
    constructor(simulation) {
        this.sim = simulation;
        
        // Disaster Animations state
        this.shakeTimer = 0;
        this.shakeIntensity = 0;
        
        this.particles = [];
        this.activeMeteors = [];
        
        // Fire spread calendar
        this.fireSpreadTimer = 0;
    }

    update() {
        // 1. Shake Timer
        if (this.shakeTimer > 0) {
            this.shakeTimer--;
        }

        // 2. Meteor Physics & Collisions
        for (let i = this.activeMeteors.length - 1; i >= 0; i--) {
            const m = this.activeMeteors[i];
            m.x += m.vx;
            m.y += m.vy;

            // Spawn smoke tail
            if (Math.random() < 0.4) {
                this.spawnSmoke(m.x, m.y, '#ff4500', 8);
            }

            // Check if arrived at target
            const dist = Math.hypot(m.x - m.targetX, m.y - m.targetY);
            if (dist < 10) {
                this.impactMeteor(m);
                this.activeMeteors.splice(i, 1);
            }
        }

        // 3. Update Particles
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.update();
            if (p.life <= 0) {
                this.particles.splice(i, 1);
            }
        }

        // 4. Fire Spread (runs every ~10 simulation ticks/days)
        this.fireSpreadTimer++;
        if (this.fireSpreadTimer >= 10) {
            this.fireSpreadTimer = 0;
            this.processFireSpreading();
        }

        // 5. Continual smoke spawning for factories and active fires
        this.spawnIndustrialSmoke();
    }

    triggerShake(duration, intensity) {
        this.shakeTimer = duration;
        this.shakeIntensity = intensity;
    }

    getShakeOffsets() {
        if (this.shakeTimer <= 0) return { x: 0, y: 0 };
        const dx = (Math.random() - 0.5) * this.shakeIntensity;
        const dy = (Math.random() - 0.5) * this.shakeIntensity;
        return { x: dx, y: dy };
    }

    // --- Disaster: Fire Outbreak ---
    triggerFire() {
        // Find a random populated building/zone
        const targets = [];
        for (let x = 0; x < GRID_SIZE; x++) {
            for (let y = 0; y < GRID_SIZE; y++) {
                const t = this.sim.grid[x][y];
                if (t.type !== 'empty' && !t.rubble && !t.fireActive) {
                    targets.push(t);
                }
            }
        }

        if (targets.length === 0) return false;
        
        // Pick random and ignite
        const victim = targets[Math.floor(Math.random() * targets.length)];
        victim.fireActive = true;
        
        Sound.playDisaster();
        this.triggerShake(15, 3);
        
        // Spawn sparks
        this.spawnExplosionParticles(victim.x, victim.y, 15);
        return { x: victim.x, y: victim.y };
    }

    processFireSpreading() {
        const fireTiles = [];
        for (let x = 0; x < GRID_SIZE; x++) {
            for (let y = 0; y < GRID_SIZE; y++) {
                if (this.sim.grid[x][y].fireActive) {
                    fireTiles.push(this.sim.grid[x][y]);
                }
            }
        }

        for (const ft of fireTiles) {
            // Chance to spread to neighbors
            const neighbors = this.sim.getNeighbors(ft.x, ft.y);
            for (const n of neighbors) {
                if (n.type !== 'empty' && !n.rubble && !n.fireActive && !n.type.includes('pipe') && !n.type.includes('line')) {
                    // Spread check
                    const spreadProb = n.type === 'park' ? 0.35 : 0.15; // Parks catch fire easier!
                    if (Math.random() < spreadProb) {
                        n.fireActive = true;
                        this.spawnExplosionParticles(n.x, n.y, 5);
                    }
                }
            }

            // Burn down current tile if burning for a while (roll 20% chance to collapse)
            if (Math.random() < 0.2) {
                ft.fireActive = false;
                ft.rubble = true;
                ft.type = 'empty';
                ft.density = 0;
            }
        }
    }

    // --- Disaster: Earthquake ---
    triggerEarthquake() {
        Sound.playDisaster();
        this.triggerShake(120, 10); // Massive long shake

        // Loop grid and damage structures randomly
        for (let x = 0; x < GRID_SIZE; x++) {
            for (let y = 0; y < GRID_SIZE; y++) {
                const t = this.sim.grid[x][y];
                if (t.type !== 'empty' && !t.rubble) {
                    // 15% collapse chance, higher for industrial zones
                    const risk = t.type === 'industrial' ? 0.25 : 0.15;
                    if (Math.random() < risk) {
                        t.rubble = true;
                        t.density = 0;
                        t.fireActive = Math.random() < 0.3; // 30% chance it sparks a fire
                        this.spawnExplosionParticles(x, y, 10);
                    }
                }
            }
        }
        this.sim.updateUtilities();
        this.sim.updateMapMetrics();
    }

    // --- Disaster: Meteor Strike ---
    triggerMeteor(targetGridX, targetGridY) {
        if (!this.sim.isValidCoords(targetGridX, targetGridY)) return;

        // Coordinates in drawing world: we need the renderer's conversion, but we can compute it here:
        // We'll calculate the 3D-ish target coordinates:
        // Let's pass the target world coords from renderer to set up trajectory.
        // We will compute screen coordinates:
        // x_iso = (gridX - gridY) * 32
        // y_iso = (gridX + gridY) * 16
        // Let's compute them relative to grid center to simplify, or pass exact canvas coords.
        // Let's store target tile coords and let the renderer draw it.
        const startX = targetGridX * 64 - 300;
        const startY = targetGridY * 32 - 600; // Come from top-left

        this.activeMeteors.push({
            x: startX,
            y: startY,
            vx: 8,
            vy: 16,
            targetGridX,
            targetGridY,
            targetX: targetGridX, // Hold references for renderer drawing
            targetY: targetGridY
        });
    }

    impactMeteor(m) {
        Sound.playDisaster();
        this.triggerShake(45, 15);

        const tx = m.targetGridX;
        const ty = m.targetGridY;

        // Blast radius of 2
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const nx = tx + dx;
                const ny = ty + dy;
                if (this.sim.isValidCoords(nx, ny)) {
                    const tile = this.sim.grid[nx][ny];
                    tile.type = 'empty';
                    tile.density = 0;
                    tile.rubble = true;
                    tile.fireActive = Math.random() < 0.6; // Heavy fires
                    
                    // Particle explosion in game-space coordinates
                    this.spawnExplosionParticles(nx, ny, 25);
                }
            }
        }
        this.sim.updateUtilities();
        this.sim.updateMapMetrics();
    }

    // --- Particle Spawners ---
    spawnSmoke(x, y, color = 'rgba(150, 150, 150, 0.4)', size = 5) {
        const vx = (Math.random() - 0.5) * 0.4;
        const vy = -Math.random() * 0.8 - 0.2;
        const life = Math.random() * 30 + 20;
        this.particles.push(new Particle(x, y, color, vx, vy, life));
    }

    spawnExplosionParticles(gridX, gridY, count) {
        // Center of the isometric tile in drawing offsets
        const px = (gridX - gridY) * 32;
        const py = (gridX + gridY) * 16;
        
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 2 + 1;
            const vx = Math.cos(angle) * speed;
            const vy = Math.sin(angle) * speed - 0.5; // Upward bias
            const colors = ['#ff3300', '#ffaa00', '#ffff00', '#777777', '#333333'];
            const color = colors[Math.floor(Math.random() * colors.length)];
            const life = Math.random() * 25 + 15;
            this.particles.push(new Particle(px, py - 10, color, vx, vy, life));
        }
    }

    spawnIndustrialSmoke() {
        for (let x = 0; x < GRID_SIZE; x++) {
            for (let y = 0; y < GRID_SIZE; y++) {
                const tile = this.sim.grid[x][y];
                if (tile.rubble) continue;

                // Spawns smoke if active fire
                if (tile.fireActive && Math.random() < 0.3) {
                    const px = (x - y) * 32;
                    const py = (x + y) * 16 - 15;
                    this.spawnSmoke(px, py, '#333333', 12);
                }
                
                // Industrial smoke stack
                if (tile.type === 'industrial' && tile.density > 0 && Math.random() < 0.08) {
                    const px = (x - y) * 32 + (Math.random() - 0.5) * 10;
                    const py = (x + y) * 16 - 10 - tile.density * 6;
                    this.spawnSmoke(px, py, 'rgba(100, 100, 100, 0.5)', 6);
                }

                // Power Plant smoke
                if (tile.type === 'powerplant' && tile.powered && Math.random() < 0.15) {
                    const px = (x - y) * 32 + 5;
                    const py = (x + y) * 16 - 32;
                    this.spawnSmoke(px, py, 'rgba(60, 60, 60, 0.7)', 8);
                }
            }
        }
    }
}
