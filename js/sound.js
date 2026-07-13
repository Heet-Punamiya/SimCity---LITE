// Sound Engine utilizing HTML5 Web Audio API for procedural sound synthesis
class SoundManager {
    constructor() {
        this.ctx = null;
        this.enabled = true;
        this.ambientOsc = null;
        this.ambientGain = null;
        this.musicInterval = null;
    }

    init() {
        if (this.ctx) return;
        // Initialize AudioContext on first user interaction
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
            this.ctx = new AudioContextClass();
            this.startAmbientMusic();
        }
    }

    toggle() {
        this.enabled = !this.enabled;
        if (!this.enabled) {
            this.stopAmbientMusic();
        } else {
            this.init();
            this.startAmbientMusic();
        }
        return this.enabled;
    }

    playBuild() {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.15);

        gain.gain.setValueAtTime(0.15, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.15);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.16);
    }

    playBulldoze() {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(100, now);
        osc.frequency.linearRampToValueAtTime(30, now + 0.3);

        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

        // Lowpass filter for deep rumble
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(150, now);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.31);
    }

    playDisaster() {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const bufferSize = this.ctx.sampleRate * 1.5; // 1.5 seconds of noise
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);

        // Fill buffer with white noise
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(800, now);
        filter.frequency.exponentialRampToValueAtTime(50, now + 1.2);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 1.4);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);

        noise.start(now);
        noise.stop(now + 1.5);
    }

    playLevelUp() {
        if (!this.enabled) return;
        this.init();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const notes = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99]; // C major pentatonic
        notes.forEach((freq, i) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + i * 0.08);

            gain.gain.setValueAtTime(0.08, now + i * 0.08);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.25);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.start(now + i * 0.08);
            osc.stop(now + i * 0.08 + 0.26);
        });
    }

    startAmbientMusic() {
        if (!this.enabled || this.musicInterval) return;
        this.init();
        if (!this.ctx) return;

        // Ambient chord generator playing soft cyberpunk/space pad chords
        const chords = [
            [130.81, 164.81, 196.00, 246.94], // Cmaj7
            [146.83, 174.61, 220.00, 261.63], // Dm7
            [110.00, 130.81, 164.81, 196.00], // Am7
            [116.54, 146.83, 174.61, 220.00]  // Bbmaj7
        ];

        let chordIndex = 0;

        const playChord = () => {
            if (!this.enabled || !this.ctx) return;
            const now = this.ctx.currentTime;
            const chord = chords[chordIndex];
            chordIndex = (chordIndex + 1) % chords.length;

            chord.forEach(freq => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();

                osc.type = 'triangle';
                // Slight frequency detune for warm chorus effect
                osc.frequency.setValueAtTime(freq + (Math.random() - 0.5) * 1.5, now);

                // Slow attack and release for pad sound
                gain.gain.setValueAtTime(0, now);
                gain.gain.linearRampToValueAtTime(0.02, now + 1.5);
                gain.gain.setValueAtTime(0.02, now + 4.5);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 7.5);

                const filter = this.ctx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(400, now);

                osc.connect(filter);
                filter.connect(gain);
                gain.connect(this.ctx.destination);

                osc.start(now);
                osc.stop(now + 8);
            });
        };

        playChord();
        this.musicInterval = setInterval(playChord, 8000);
    }

    stopAmbientMusic() {
        if (this.musicInterval) {
            clearInterval(this.musicInterval);
            this.musicInterval = null;
        }
    }
}

export const Sound = new SoundManager();
