import type { ReviewController } from "../app/review-controller";

const NS = "http://www.w3.org/2000/svg";
/** DOM-only overlay: never becomes part of a GLB, raycast target or PNG render. */
export class ReviewOverlay {
  readonly element = document.createElement("div");
  readonly #unsubscribe: () => void;
  #signature = "";
  constructor(container: HTMLElement, private readonly controller: ReviewController) {
    this.element.className = "review-overlay";
    this.element.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2";
    container.append(this.element);
    this.#unsubscribe = controller.subscribe(() => this.#render());
  }
  dispose(): void { this.#unsubscribe(); this.element.remove(); }
  #render(): void {
    const viewport = this.controller.viewport;
    const displays = this.controller.displayItems().filter(item => !item.unresolved && !item.anchors?.some(anchor => viewport.isAnchorVisible?.(anchor) === false)).map(item => ({
      item, points: item.points.map(point => viewport.projectPoint(point)),
    })).filter(({ points }) => points.length && points.every(point => point.visible && Number.isFinite(point.x) && Number.isFinite(point.y)));
    const state = this.controller.state;
    const pending = [...state.pending, ...(state.preview ? [state.preview] : [])].flatMap(anchor => {
      const point = viewport.resolveAnchor(anchor); if (!point || viewport.isAnchorVisible?.(anchor) === false) return [];
      const projected = viewport.projectPoint(point); return projected.visible ? [projected] : [];
    });
    const signature = JSON.stringify([displays, pending]); if (signature === this.#signature) return; this.#signature = signature;
    this.element.replaceChildren();
    const svg = document.createElementNS(NS, "svg"); svg.setAttribute("width", "100%"); svg.setAttribute("height", "100%"); svg.setAttribute("aria-hidden", "true");
    svg.style.cssText = "position:absolute;inset:0;overflow:visible"; this.element.append(svg);
    const dot = (x: number, y: number, preview = false) => {
      const circle = document.createElementNS(NS, "circle"); circle.setAttribute("cx", String(x)); circle.setAttribute("cy", String(y));
      circle.setAttribute("r", preview ? "6" : "4"); circle.setAttribute("fill", preview ? "#ffffff" : "#ffd166"); circle.setAttribute("stroke", "#664400"); circle.setAttribute("stroke-width", "1.5"); svg.append(circle);
    };
    for (const { item, points } of displays) {
      if (points.length > 1) {
        const line = document.createElementNS(NS, "polyline"); line.setAttribute("points", points.map(point => `${point.x},${point.y}`).join(" "));
        line.setAttribute("fill", "none"); line.setAttribute("stroke", "#ffd166"); line.setAttribute("stroke-width", "2"); svg.append(line);
      }
      points.forEach(point => dot(point.x, point.y));
      const reference = item.kind === "angle" ? points[1]! : item.kind === "distance" ? { x: (points[0]!.x + points[1]!.x) / 2, y: (points[0]!.y + points[1]!.y) / 2 } : points[0]!;
      const label = document.createElement("div"); label.className = "review-overlay-label";
      label.dataset.reviewId = item.id; label.textContent = `${item.name}: ${item.text}`;
      label.style.cssText = `position:absolute;left:${reference.x + 9}px;top:${reference.y - 9}px;max-width:210px;padding:3px 6px;border-radius:4px;background:#121a2ce8;color:#fff3c0;font:11px/1.35 system-ui;overflow-wrap:anywhere;white-space:pre-wrap;border:1px solid #aa8438`;
      this.element.append(label);
    }
    pending.forEach((point, index) => dot(point.x, point.y, !!state.preview && index === pending.length - 1));
  }
}
