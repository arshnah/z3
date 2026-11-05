import type { Action } from "svelte/action";

/**
 * Liquid glass: a material that refracts what's behind it, rather than just
 * blurring it. Chromium can run an SVG filter on the *backdrop* (not only on
 * the element's own pixels), so a rounded-rect lens displacement map makes the
 * background bend as it passes under the rim — the effect Apple calls Liquid
 * Glass. On top of that the surface gets a specular rim and a highlight that
 * follows the pointer.
 *
 * The map is a small canvas (one per surface, rebuilt on resize) fed to
 * `feDisplacementMap`; the CSS filter list is `blur(...) url(#…) saturate(...)`,
 * so the backdrop is softened first and then lensed at the edges.
 */

interface Options {
    /** Toggle the material without unmounting the surface. */
    enabled?: boolean;
    /** Backdrop softness, in CSS px. */
    blur?: number;
    /** How far the rim bends the backdrop, in CSS px. */
    depth?: number;
}

/** Rounded-rectangle signed distance: negative inside, 0 on the edge. */
function roundedRect(x: number, y: number, halfW: number, halfH: number, radius: number): number {
    const qx = Math.abs(x) - (halfW - radius);
    const qy = Math.abs(y) - (halfH - radius);
    return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius;
}

/** A displacement map that pulls the backdrop inward over the element's rim. */
function lensMap(width: number, height: number, radius: number, depth: number): { href: string; scale: number } {
    // Cap the map's resolution: it's a smooth field, so a small canvas is plenty.
    const step = Math.max(width, height) / 160;
    const w = Math.max(12, Math.round(width / step));
    const h = Math.max(12, Math.round(height / step));
    const data = new Uint8ClampedArray(w * h * 4);
    const halfW = width / 2;
    const halfH = height / 2;
    const r = Math.min(radius, halfW, halfH);
    // Keep the lens to a rim: on a short pill the band must not reach the middle.
    const band = Math.min(depth * 2, Math.min(halfW, halfH) * 0.34);
    const raw = new Float32Array(w * h * 2);
    let max = 0;

    for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
            const x = ((px + 0.5) / w) * width - halfW;
            const y = ((py + 0.5) / h) * height - halfH;
            const d = roundedRect(x, y, halfW, halfH, r);
            // 0 in the middle, 1 right at the rim.
            const t = Math.min(1, Math.max(0, 1 + d / band));
            const bend = t * t * depth;
            // Inward normal of the ellipse through this point.
            const nx = x / (halfW * halfW);
            const ny = y / (halfH * halfH);
            const len = Math.hypot(nx, ny) || 1;
            const dx = (-nx / len) * bend;
            const dy = (-ny / len) * bend;
            const i = (py * w + px) * 2;
            raw[i] = dx;
            raw[i + 1] = dy;
            max = Math.max(max, Math.abs(dx), Math.abs(dy));
        }
    }

    const scale = Math.max(0.01, max);
    for (let i = 0, p = 0; i < raw.length; i += 2, p += 4) {
        data[p] = (raw[i] / scale) * 127.5 + 127.5;
        data[p + 1] = (raw[i + 1] / scale) * 127.5 + 127.5;
        data[p + 3] = 255;
    }

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { href: "", scale: 0 };
    ctx.putImageData(new ImageData(data, w, h), 0, 0);
    return { href: canvas.toDataURL(), scale: scale * 2 };
}

let nextId = 0;

/** Chromium can filter the backdrop through an SVG filter (the lens); if it can't, fall back to plain blur. */
const SUPPORTS_LENS = typeof CSS === "undefined" || CSS.supports("backdrop-filter", "url(#x)");

interface Surface {
    svg: SVGSVGElement;
}

export const liquidGlass: Action<HTMLElement, Options | undefined> = (node, options) => {
    let enabled = options?.enabled ?? true;
    let blur = options?.blur ?? 10;
    let depth = options?.depth ?? 10;

    const id = `zeta-glass-${++nextId}`;
    let surface: Surface | null = null;
    let saved: {
        backdrop: string;
        webkit: string;
        image: string;
        shadow: string;
        border: string;
        color: string;
        tint: string;
    } | null = null;
    let frame = 0;

    function build() {
        const width = node.clientWidth;
        const height = node.clientHeight;
        if (!width || !height) return;

        const style = getComputedStyle(node);
        const rawRadius = style.borderTopLeftRadius || "16px";
        const radius = rawRadius.endsWith("%")
            ? (Math.min(width, height) * parseFloat(rawRadius)) / 100
            : parseFloat(rawRadius) || 16;
        const map = lensMap(width, height, radius, depth);
        if (!map.href) return;

        const NS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(NS, "svg");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("width", "0");
        svg.setAttribute("height", "0");
        svg.style.cssText = "position:fixed;left:0;top:0;pointer-events:none;";

        const defs = document.createElementNS(NS, "defs");
        const filter = document.createElementNS(NS, "filter");
        filter.setAttribute("id", id);
        filter.setAttribute("filterUnits", "userSpaceOnUse");
        filter.setAttribute("color-interpolation-filters", "sRGB");
        filter.setAttribute("x", "0");
        filter.setAttribute("y", "0");
        filter.setAttribute("width", String(width));
        filter.setAttribute("height", String(height));

        const image = document.createElementNS(NS, "feImage");
        image.setAttribute("x", "0");
        image.setAttribute("y", "0");
        image.setAttribute("width", String(width));
        image.setAttribute("height", String(height));
        image.setAttribute("preserveAspectRatio", "none");
        image.setAttribute("href", map.href);

        const displace = document.createElementNS(NS, "feDisplacementMap");
        displace.setAttribute("in", "SourceGraphic");
        displace.setAttribute("in2", "map");
        displace.setAttribute("xChannelSelector", "R");
        displace.setAttribute("yChannelSelector", "G");
        displace.setAttribute("scale", String(map.scale));
        image.setAttribute("result", "map");

        filter.append(image, displace);
        defs.append(filter);
        svg.append(defs);
        document.body.append(svg);
        surface = { svg };
    }

    function apply() {
        if (!saved) {
            saved = {
                backdrop: node.style.getPropertyValue("backdrop-filter"),
                webkit: node.style.getPropertyValue("-webkit-backdrop-filter"),
                image: node.style.backgroundImage,
                shadow: node.style.boxShadow,
                border: node.style.borderColor,
                color: node.style.backgroundColor,
                tint: "",
            };
            // A clearer tint than the app's frosted surfaces, so the refraction shows.
            const tint = getComputedStyle(node).backgroundColor.match(/rgba?\(([^)]+)\)/);
            if (tint) {
                const parts = tint[1].split(/[\s,/]+/).filter(Boolean).map(Number);
                const alpha = parts.length > 3 ? parts[3] : 1;
                saved.tint = `rgb(${parts[0]} ${parts[1]} ${parts[2]} / ${Math.max(0.2, alpha * 0.6)})`;
            }
        }
        if (!surface) build();
        if (!surface) return;

        node.style.setProperty(
            "backdrop-filter",
            `blur(${blur}px) ${SUPPORTS_LENS ? `url(#${id}) ` : ""}saturate(1.6) brightness(1.04)`,
        );
        // The gradient paints over the refracted backdrop; the component's own
        // background colour and any background image stay untouched.
        node.style.backgroundImage = [
            `radial-gradient(120% 90% at 50% -20%, rgb(255 255 255 / 0.16), transparent 58%)`,
            `radial-gradient(46% 60% at var(--glass-gx, 50%) var(--glass-gy, 0%), rgb(255 255 255 / 0.1), transparent 70%)`,
        ]
            .join(", ");
        if (saved.tint) node.style.backgroundColor = saved.tint;
        node.style.boxShadow = [
            saved.shadow,
            "inset 0 1px 0 rgb(255 255 255 / 0.18)",
            "inset 0 0 0 1px rgb(255 255 255 / 0.05)",
            "inset 0 -18px 30px -24px rgb(255 255 255 / 0.25)",
        ]
            .filter(Boolean)
            .join(", ");
        node.style.borderColor = "rgb(255 255 255 / 0.14)";
    }

    function restore() {
        if (!saved) return;
        if (saved.backdrop) node.style.setProperty("backdrop-filter", saved.backdrop);
        else node.style.removeProperty("backdrop-filter");
        if (saved.webkit) node.style.setProperty("-webkit-backdrop-filter", saved.webkit);
        else node.style.removeProperty("-webkit-backdrop-filter");
        node.style.backgroundImage = saved.image;
        node.style.backgroundColor = saved.color;
        node.style.boxShadow = saved.shadow;
        node.style.borderColor = saved.border;
        node.style.removeProperty("--glass-gx");
        node.style.removeProperty("--glass-gy");
        saved = null;
        surface?.svg.remove();
        surface = null;
    }

    function point(e: PointerEvent) {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
            const rect = node.getBoundingClientRect();
            node.style.setProperty("--glass-gx", `${((e.clientX - rect.left) / rect.width) * 100}%`);
            node.style.setProperty("--glass-gy", `${((e.clientY - rect.top) / rect.height) * 100}%`);
        });
    }

    function resetPoint() {
        cancelAnimationFrame(frame);
        node.style.setProperty("--glass-gx", "50%");
        node.style.setProperty("--glass-gy", "0%");
    }

    // Rebuild the lens when the surface's size or corner radius changes. Debounced:
    // the dock animates its width, and a map per animation frame would be wasteful.
    let rebuild: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
        if (!enabled) return;
        clearTimeout(rebuild);
        rebuild = setTimeout(() => {
            surface?.svg.remove();
            surface = null;
            apply();
        }, 140);
    });
    observer.observe(node);

    if (enabled) {
        apply();
        node.addEventListener("pointermove", point);
        node.addEventListener("pointerleave", resetPoint);
    }

    return {
        update(next) {
            enabled = next?.enabled ?? true;
            blur = next?.blur ?? 10;
            depth = next?.depth ?? 10;
            if (enabled) {
                apply();
                node.addEventListener("pointermove", point);
                node.addEventListener("pointerleave", resetPoint);
            } else {
                node.removeEventListener("pointermove", point);
                node.removeEventListener("pointerleave", resetPoint);
                restore();
            }
        },
        destroy() {
            cancelAnimationFrame(frame);
            clearTimeout(rebuild);
            observer.disconnect();
            node.removeEventListener("pointermove", point);
            node.removeEventListener("pointerleave", resetPoint);
            restore();
        },
    };
};
