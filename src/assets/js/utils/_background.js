import { Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Vector2, Vector3, WebGLRenderer } from "three";

// pixel grid background: tiles breathe with noise, light up around the pointer and ripple while converting
const CELL = { mobile: 22, desktop: 30 };
const STRENGTH = { dark: 1, light: 1.3 };
const MAX_PIXEL_RATIO = 1.5;
const THEME_FADE = 400;
// how quickly the glow catches up with the pointer, per frame at 60fps
const FOLLOW = 0.08;

const vertexShader = /* glsl */ `
void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const fragmentShader = /* glsl */ `
// everything in css pixels with y down, like the dom
uniform vec2 uResolution;
uniform float uPixelRatio;
uniform float uTime;
uniform float uCell;
uniform vec2 uPointer;
uniform float uPointerOn;
uniform float uEnergy;
uniform float uStrength;
uniform vec3 uBg;
uniform vec3 uAccent;

// hash without sine, https://www.shadertoy.com/view/4djSRW (Dave Hoskins, MIT license)
float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float roundedBox(vec2 p, float size, float radius) {
    vec2 q = abs(p) - vec2(size - radius);
    return length(max(q, 0.0)) - radius;
}

void main() {
    vec2 p = vec2(gl_FragCoord.x, uResolution.y * uPixelRatio - gl_FragCoord.y) / uPixelRatio;

    vec2 id = floor(p / uCell);
    vec2 local = fract(p / uCell) - 0.5;
    vec2 center = (id + 0.5) * uCell;

    // slow drifting noise decides which tiles are lit
    float flow = noise(id * 0.11 + vec2(uTime * 0.05, -uTime * 0.035));
    flow = smoothstep(0.45, 0.95, flow + (hash(id) - 0.5) * 0.25);

    // pointer glow
    float near = exp(-pow(distance(center, uPointer) / 220.0, 2.0)) * uPointerOn;

    // ripple out from the middle while converting
    float fromMiddle = distance(center, uResolution * vec2(0.5, 0.45));
    float ripple = pow(0.5 + 0.5 * sin(fromMiddle * 0.018 - uTime * 4.0), 6.0) * uEnergy;

    float lit = clamp(flow * 0.55 + near * 0.9 + ripple * 0.8, 0.0, 1.0);

    // tile grows with how lit it is
    float size = mix(0.12, 0.42, lit);
    float edge = 1.0 / uCell;
    float tile = 1.0 - smoothstep(-edge, edge, roundedBox(local, size, 0.12));

    // fade the grid out towards the bottom so the content stays calm
    float fade = mix(1.0, 0.35, smoothstep(0.0, 1.0, p.y / uResolution.y));

    float amount = tile * (0.035 + lit * 0.3) * fade * uStrength;
    vec3 color = mix(uBg, uAccent, amount);

    // soft wash of accent behind the pointer
    color = mix(color, uAccent, near * 0.06 * uStrength);

    gl_FragColor = vec4(color, 1.0);
}
`;

// srgb hex -> 0..1 vec3, unmanaged so it matches css
function hexToVec3(hex) {
    let digits = hex.trim().slice(1);
    // the css minifier shortens #ffffff to #fff
    if (digits.length === 3) digits = digits.replace(/./g, "$&$&");
    const value = parseInt(digits, 16);
    return new Vector3(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

function readColors() {
    const style = getComputedStyle(document.documentElement);
    const light = document.documentElement.dataset.theme === "light";
    return {
        bg: hexToVec3(style.getPropertyValue("--color-theme-bg")),
        accent: hexToVec3(style.getPropertyValue("--color-theme-accent")),
        strength: light ? STRENGTH.light : STRENGTH.dark,
    };
}

export class _background {
    constructor(canvas) {
        this.canvas = canvas;

        try {
            this.renderer = new WebGLRenderer({ canvas, powerPreference: "low-power" });
        } catch (e) {
            // no webgl, the plain page background stays
            return;
        }

        this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
        this.pointer = { x: 0, y: 0, on: 0, targetX: 0, targetY: 0, targetOn: 0 };
        this.energy = { value: 0, target: 0 };

        this.init();
    }

    init() {
        const colors = readColors();
        this.uniforms = {
            uResolution: { value: new Vector2(1, 1) },
            uPixelRatio: { value: 1 },
            uTime: { value: 0 },
            uCell: { value: CELL.desktop },
            uPointer: { value: new Vector2(-1000, -1000) },
            uPointerOn: { value: 0 },
            uEnergy: { value: 0 },
            uStrength: { value: colors.strength },
            uBg: { value: colors.bg },
            uAccent: { value: colors.accent },
        };

        this.scene = new Scene();
        this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.scene.add(new Mesh(new PlaneGeometry(2, 2), new ShaderMaterial({ vertexShader, fragmentShader, uniforms: this.uniforms })));

        new ResizeObserver(() => this.resize()).observe(this.canvas);
        new MutationObserver(() => this.onTheme()).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

        if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
            window.addEventListener("pointermove", (e) => {
                if (!this.pointer.targetOn) Object.assign(this.pointer, { x: e.clientX, y: e.clientY });
                Object.assign(this.pointer, { targetX: e.clientX, targetY: e.clientY, targetOn: 1 });
            });
            document.documentElement.addEventListener("pointerleave", () => (this.pointer.targetOn = 0));
        }

        window.addEventListener("converter:busy", (e) => (this.energy.target = e.detail ? 1 : 0));

        this.resize();
        this.start = performance.now();
        this.last = this.start;
        requestAnimationFrame((now) => this.loop(now));
        this.canvas.classList.remove("opacity-0");
    }

    resize() {
        const { clientWidth: width, clientHeight: height } = this.canvas;
        const pixelRatio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);

        this.renderer.setPixelRatio(pixelRatio);
        this.renderer.setSize(width, height, false);
        this.uniforms.uResolution.value.set(width, height);
        this.uniforms.uPixelRatio.value = pixelRatio;
        this.uniforms.uCell.value = width < 768 ? CELL.mobile : CELL.desktop;

        // reduced motion only draws on resize and theme change
        if (this.reducedMotion.matches) this.render();
    }

    onTheme() {
        const next = readColors();
        const from = { bg: this.uniforms.uBg.value.clone(), strength: this.uniforms.uStrength.value };
        const start = performance.now();
        this.uniforms.uAccent.value.copy(next.accent);

        const step = (now) => {
            const t = Math.min((now - start) / THEME_FADE, 1);
            const eased = 1 - (1 - t) * (1 - t);
            this.uniforms.uBg.value.lerpVectors(from.bg, next.bg, eased);
            this.uniforms.uStrength.value = from.strength + (next.strength - from.strength) * eased;
            if (this.reducedMotion.matches) this.render();
            if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }

    loop(now) {
        requestAnimationFrame((time) => this.loop(time));
        if (document.hidden || this.reducedMotion.matches) return;

        // frame-rate independent easing
        const k = 1 - Math.pow(1 - FOLLOW, (now - this.last) / (1000 / 60));
        this.last = now;

        const { pointer, energy } = this;
        pointer.x += (pointer.targetX - pointer.x) * k;
        pointer.y += (pointer.targetY - pointer.y) * k;
        pointer.on += (pointer.targetOn - pointer.on) * k;
        energy.value += (energy.target - energy.value) * k * 0.5;

        this.uniforms.uTime.value = (now - this.start) / 1000;
        this.uniforms.uPointer.value.set(pointer.x, pointer.y);
        this.uniforms.uPointerOn.value = pointer.on;
        this.uniforms.uEnergy.value = energy.value;
        this.render();
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }
}
