import { destroySceneSubtree } from "../../../game/render/destroySceneSubtree";
import * as PIXI from "pixi.js";
import { placeRoutingLabels } from "../../../game/architecture/routingLabels";
import type { ArchitectureRoutingHole } from "../../../game/architecture/reviewTypes";
import { isoToWorld } from "../../../game/render/iso";
import type { RenderSnapshot } from "../../../game/render/renderSnapshot";
import type { Point } from "../../../game/models/types";
import { translateCurrent as t } from "../../../i18n/core";
import type { MessageKey } from "../../../i18n/catalog";

/** Native Pixi routing spines with screen-space HTML controls for keyboard access. */
export function createRoutingLabelOverlay(snapshot: RenderSnapshot, project: (p: Point) => Point, requestRender: () => void, canvas: () => HTMLCanvasElement | undefined) {
  const container = new PIXI.Container();
  container.label = "route-overlay";
  const routes = snapshot.architectureOverlay?.routing ?? [];
  let selected = snapshot.architectureOverlay?.selectedRoutingHoleId;
  let currentSnapshot = snapshot;
  let currentProject = project;
  const routeSignature = JSON.stringify(routes);
  let active = selected;
  let lastLayout = "";
  let dirty = true;
  let resizeObserver: ResizeObserver | null = null;
  let styleObserver: MutationObserver | null = null;
  const root = typeof document === "undefined" || !canvas() ? null : document.createElement("div");
  if (root) {
    root.className = "cc-routing-map";
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", t("architecture.review.overlay.routing"));
    root.dataset.testid = "architecture-routing-map";
    document.body.append(root);
  }
  const graphics = new Map<string, PIXI.Graphics>();
  const listeners: Array<() => void> = [];
  const listen = (button: HTMLButtonElement, type: string, listener: () => void) => {
    button.addEventListener(type, listener);
    listeners.push(() => button.removeEventListener(type, listener));
  };
  const controls: Array<{ route: ArchitectureRoutingHole; role: "number" | "tee" | "pin"; point: Point; button: HTMLButtonElement }> = [];
  const emphasize = (id: string | undefined) => {
    active = id;
    for (const [holeId, graphic] of graphics) graphic.alpha = id && id !== "all" && id !== holeId ? 0.28 : 1;
    for (const control of controls) {
      control.button.dataset.emphasized = String(id === control.route.holeId);
      control.button.dataset.dimmed = String(!!id && id !== "all" && id !== control.route.holeId);
      control.button.setAttribute("aria-pressed", String(selected === control.route.holeId));
    }
    requestRender();
  };
  for (const route of routes) {
    const graphic = new PIXI.Graphics();
    graphic.label = `routing-spine-${route.holeId}`;
    graphics.set(route.holeId, graphic);
    container.addChild(graphic);
    if (!root) continue;
    const markers = [{ role: "number" as const, point: route.anchor }, ...(route.tee ? [{ role: "tee" as const, point: route.tee }] : []), ...(route.pin ? [{ role: "pin" as const, point: route.pin }] : [])];
    for (const marker of markers) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.role = marker.role;
      button.dataset.holeId = route.holeId;
      button.dataset.testid = `routing-map-${marker.role}-${route.holeId}`;
      button.textContent = marker.role === "number" ? `${route.number}${route.status === "complete" ? "" : " !"}` : `${marker.role === "tee" ? "T" : "G"}${route.number}`;
      const endpoint = marker.role === "number" ? "" : ` · ${t(marker.role === "tee" ? "architecture.routing.start" : "architecture.routing.end")}`;
      const label = `${t("architecture.routing.hole", { number: route.number })} · ${route.name}${endpoint} · ${t(`architecture.routing.status.${route.status}` as MessageKey)} · ${t(`playerPro.play.tee.${route.teeSet}`)} · ${t("architecture.review.pin")} ${route.pinRotation}`;
      button.setAttribute("aria-label", label);
      button.title = label;
      listen(button, "click", () => currentSnapshot.onArchitectureHoleSelect?.(marker.point, route.holeId));
      listen(button, "pointerenter", () => emphasize(route.holeId));
      listen(button, "pointerleave", () => emphasize(selected));
      listen(button, "focus", () => emphasize(route.holeId));
      listen(button, "blur", () => emphasize(selected));
      root.append(button);
      controls.push({ route, ...marker, button });
    }
  }
  const draw = (scale: number) => {
    for (const route of routes) {
      const g = graphics.get(route.holeId)!;
      g.clear();
      if (route.spine.length < 2) continue;
      const points = route.spine.map(currentProject);
      for (const [color, width] of [[0x182f29, 5], [0xfffdf6, 2]] as const) {
        g.moveTo(points[0].x, points[0].y);
        for (const point of points.slice(1)) g.lineTo(point.x, point.y);
        g.stroke({ color, width: width / scale, alpha: 0.92 });
      }
      // Direction is explicit, including when the last segment crosses another hole.
      const end = points.at(-1)!;
      let previous: Point | undefined;
      for (let index = points.length - 2; index >= 0; index--) {
        const candidate = points[index];
        if (candidate.x !== end.x || candidate.y !== end.y) {
          previous = candidate;
          break;
        }
      }
      if (!previous) continue;
      const angle = Math.atan2(end.y - previous.y, end.x - previous.x);
      const tip = { x: end.x - Math.cos(angle) * 22 / scale, y: end.y - Math.sin(angle) * 22 / scale };
      g.poly([tip.x, tip.y, tip.x - Math.cos(angle - 0.55) * 12 / scale, tip.y - Math.sin(angle - 0.55) * 12 / scale, tip.x - Math.cos(angle + 0.55) * 12 / scale, tip.y - Math.sin(angle + 0.55) * 12 / scale]);
      g.fill(0xfffdf6); g.stroke({ color: 0x182f29, width: 2 / scale });
    }
  };
  draw(1);
  if (root) {
    const invalidate = () => { dirty = true; requestRender(); };
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(invalidate);
      resizeObserver.observe(canvas()!);
      resizeObserver.observe(document.documentElement);
      document.querySelectorAll(".cc-architecture-review, .cc-design-dock, .cc-workspace-nav, .cc-live-controls, .cc-news").forEach(panel => resizeObserver!.observe(panel));
    }
    if (typeof MutationObserver !== "undefined") {
      styleObserver = new MutationObserver(invalidate);
      styleObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
    }
  }
  const layout = () => {
    if (!root || !canvas()) return;
    // onRender runs before Pixi refreshes cached world transforms.
    const transform = container.getGlobalTransform();
    const signature = [transform.a, transform.b, transform.c, transform.d, transform.tx, transform.ty].join(":");
    if (signature === lastLayout && !dirty) return;
    lastLayout = signature;
    dirty = false;
    const bounds = canvas()!.getBoundingClientRect();
    const panels = Array.from(document.querySelectorAll<HTMLElement>(".cc-architecture-review, .cc-design-dock, .cc-workspace-nav, .cc-live-controls, .cc-news")).map(panel => panel.getBoundingClientRect()).filter(rect => rect.width && rect.height);
    const scale = Math.max(0.001, Math.hypot(transform.a, transform.b));
    draw(scale);
    const screen = (p: Point) => { const global = transform.apply(currentProject(p)); return { x: global.x + bounds.x, y: global.y + bounds.y }; };
    for (const control of controls) control.button.hidden = false;
    const requests = controls.map(control => {
      const rect = control.button.getBoundingClientRect();
      return { id: `${control.route.holeId}:${control.role}`, center: screen(control.point), width: rect.width, height: rect.height };
    });
    const legal = (p: Point) => {
      const local = transform.applyInverse({ x: p.x - bounds.x, y: p.y - bounds.y });
      const world = isoToWorld(local.x, local.y, snapshot.rotation);
      const x = Math.floor(world.x), y = Math.floor(world.y);
      return x >= 0 && y >= 0 && x < currentSnapshot.course.width && y < currentSnapshot.course.height && !["water", "wetland", "sand", "waste_area"].includes(currentSnapshot.course.tiles[y * currentSnapshot.course.width + x]);
    };
    const placements = placeRoutingLabels(requests, bounds, panels, legal);
    placements.forEach((placement, index) => {
      const control = controls[index];
      control.button.style.left = `${placement.placed.x}px`;
      control.button.style.top = `${placement.placed.y}px`;
      // Offscreen holes remain reachable in the panel's complete text list.
      const offscreen = placement.center.x < bounds.x || placement.center.x > bounds.right || placement.center.y < bounds.y || placement.center.y > bounds.bottom;
      control.button.hidden = offscreen || !placement.fits;
      control.button.dataset.fits = String(placement.fits);
      if (placement.fits && Math.hypot(placement.placed.x - placement.center.x, placement.placed.y - placement.center.y) > 2) {
        const from = transform.applyInverse({ x: placement.center.x - bounds.x, y: placement.center.y - bounds.y });
        const to = transform.applyInverse({ x: placement.placed.x - bounds.x, y: placement.placed.y - bounds.y });
        const g = graphics.get(control.route.holeId)!;
        g.moveTo(from.x, from.y); g.lineTo(to.x, to.y); g.stroke({ width: 1 / scale, color: 0x182f29, alpha: 0.8 });
      }
    });
  };
  // Runs with the existing scene's render traversal; camera pan/zoom changes
  // need no new host listener, ticker, revision, or renderer lifecycle.
  container.onRender = layout;
  emphasize(active);
  return { container,
    matches: (next: RenderSnapshot) => next.rotation === snapshot.rotation && JSON.stringify(next.architectureOverlay?.routing ?? []) === routeSignature,
    update: (next: RenderSnapshot, nextProject: (p: Point) => Point) => {
      dirty ||= next.surfaceHeightAt !== currentSnapshot.surfaceHeightAt;
      currentSnapshot = next;
      currentProject = nextProject;
      selected = next.architectureOverlay?.selectedRoutingHoleId;
      const focused = typeof document === "undefined" ? undefined : controls.find(control => control.button === document.activeElement)?.route.holeId;
      emphasize(focused ?? selected);
    },
    dispose: () => { listeners.forEach(remove => remove()); resizeObserver?.disconnect(); styleObserver?.disconnect(); root?.remove(); container.onRender = null; destroySceneSubtree(container); } };
}
