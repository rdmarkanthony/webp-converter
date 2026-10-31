import { Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Vector2, Vector3, Vector4, WebGLRenderer } from "three";

const CELL = { mobile: 22, desktop: 30 };
const STRENGTH = { dark: 1, light: 1.3 };
const MAX_PIXEL_RATIO = 1.5;
const THEME_FADE = 400;
const FOLLOW = 0.08;
const MAX_QUIET = 6;

const vertexShader = /* glsl */ `
void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const fragmentShader = /* glsl */ `
#define MAX_QUIET ${MAX_QUIET}

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
uniform vec4 uQuiet[MAX_QUIET];

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

float box(vec2 p, vec2 halfSize) {
    vec2 q = abs(p) - halfSize;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}

float quietness(vec2 p) {
    float quiet = 0.0;
    for (int i = 0; i < MAX_QUIET; i++) {
        vec4 r = uQuiet[i];
        if (r.z <= 0.0) continue;
        float d = box(p - (r.xy + r.zw * 0.5), r.zw * 0.5);
        quiet = max(quiet, 1.0 - smoothstep(0.0, 48.0, d));
    }
    return quiet;
}

void main() {
    vec2 p = vec2(gl_FragCoord.x, uResolution.y * uPixelRatio - gl_FragCoord.y) / uPixelRatio;

    vec2 id = floor(p / uCell);
    vec2 local = fract(p / uCell) - 0.5;
    vec2 center = (id + 0.5) * uCell;

    float flow = noise(id * 0.11 + vec2(uTime * 0.05, -uTime * 0.035));
    flow = smoothstep(0.45, 0.95, flow + (hash(id) - 0.5) * 0.25);

    float near = exp(-pow(distance(center, uPointer) / 160.0, 2.0)) * uPointerOn;

    float fromMiddle = distance(center, uResolution * vec2(0.5, 0.45));
    float ripple = pow(0.5 + 0.5 * sin(fromMiddle * 0.018 - uTime * 4.0), 6.0) * uEnergy;

    float calm = 1.0 - quietness(center) * 0.85;
    near *= calm;
    ripple *= calm;
    flow *= mix(1.0, calm, 0.5);

    float lit = clamp(flow * 0.55 + near * 0.6 + ripple * 0.8, 0.0, 1.0);

    float size = mix(0.12, 0.36, lit);
    float edge = 1.0 / uCell;
    float tile = 1.0 - smoothstep(-edge, edge, roundedBox(local, size, 0.12));

    float fade = mix(1.0, 0.35, smoothstep(0.0, 1.0, p.y / uResolution.y));

    float amount = tile * (0.035 + lit * 0.3) * fade * uStrength;
    vec3 color = mix(uBg, uAccent, amount);

    color = mix(color, uAccent, near * 0.035 * uStrength);

    gl_FragColor = vec4(color, 1.0);
}
`;

function hexToVec3(hex) {
    let digits = hex.trim().slice(1);
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
            return;
        }

        this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
        this.quiet = [...document.querySelectorAll("[data-bg-quiet]")].slice(0, MAX_QUIET);
        this.range = document.createRange();
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
            uQuiet: { value: Array.from({ length: MAX_QUIET }, () => new Vector4()) },
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
        window.addEventListener("scroll", () => this.reducedMotion.matches && this.render(), { passive: true });

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

    updateQuiet() {
        this.uniforms.uQuiet.value.forEach((rect, i) => {
            const el = this.quiet[i];
            if (!el) return;
            this.range.selectNodeContents(el);
            const { x, y, width, height } = this.range.getBoundingClientRect();
            rect.set(x, y, width, height);
        });
    }

    render() {
        this.updateQuiet();
        this.renderer.render(this.scene, this.camera);
    }
}
