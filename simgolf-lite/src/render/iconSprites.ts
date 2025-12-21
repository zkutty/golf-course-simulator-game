import React from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ComponentType } from "react";
import { IconTree, IconBush, IconRock } from "../assets/icons";
import type { ObstacleType } from "../game/models/types";

interface IconProps {
  size?: number;
  className?: string;
}

const ICON_COMPONENTS: Record<ObstacleType, ComponentType<IconProps>> = {
  tree: IconTree,
  bush: IconBush,
  rock: IconRock,
};

const spriteCache = new Map<string, HTMLImageElement | Promise<HTMLImageElement>>();

/**
 * Renders a React SVG icon component to an HTMLImageElement
 */
function renderIconToImage(
  IconComponent: ComponentType<IconProps>,
  sizePx: number,
  cacheKey: string
): Promise<HTMLImageElement> {
  // Check cache first
  const cached = spriteCache.get(cacheKey);
  if (cached instanceof HTMLImageElement) {
    return Promise.resolve(cached);
  }
  if (cached instanceof Promise) {
    return cached;
  }

  // Create promise to load the icon
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    try {
      // Create a temporary DOM element to render the SVG
      const tempDiv = document.createElement("div");
      tempDiv.style.position = "absolute";
      tempDiv.style.left = "-9999px";
      tempDiv.style.top = "-9999px";
      tempDiv.style.visibility = "hidden";
      document.body.appendChild(tempDiv);

      // Render React component to DOM
      const root: Root = createRoot(tempDiv);
      root.render(React.createElement(IconComponent, { size: sizePx }));

      // Wait for React to render using requestAnimationFrame (more reliable than setTimeout)
      const checkForSVG = () => {
        const svgElement = tempDiv.querySelector("svg");
        if (svgElement) {
          try {
            // Get SVG string from the rendered element
            const svgString = svgElement.outerHTML;

            // Clean up
            root.unmount();
            document.body.removeChild(tempDiv);

            // Ensure it's a valid SVG string
            if (!svgString.trim().startsWith("<svg")) {
              reject(new Error("Icon component did not render valid SVG"));
              return;
            }

            // Create blob URL
            const blob = new Blob([svgString], { type: "image/svg+xml" });
            const url = URL.createObjectURL(blob);

            // Load into Image
            const img = new Image();
            img.onload = () => {
              // Store loaded image in cache (replacing the promise)
              spriteCache.set(cacheKey, img);
              URL.revokeObjectURL(url);
              resolve(img);
            };
            img.onerror = (err) => {
              URL.revokeObjectURL(url);
              reject(new Error(`Failed to load icon sprite: ${err}`));
            };
            img.src = url;
          } catch (err) {
            if (document.body.contains(tempDiv)) {
              document.body.removeChild(tempDiv);
            }
            root.unmount();
            reject(err);
          }
        } else {
          // Not ready yet, check again on next frame
          requestAnimationFrame(checkForSVG);
        }
      };

      // Start checking after React has a chance to render
      requestAnimationFrame(() => {
        requestAnimationFrame(checkForSVG);
      });

      // Timeout fallback after 2 seconds
      setTimeout(() => {
        const svgElement = tempDiv.querySelector("svg");
        if (!svgElement) {
          if (document.body.contains(tempDiv)) {
            document.body.removeChild(tempDiv);
          }
          root.unmount();
          reject(new Error("Icon component did not render SVG element within timeout"));
        }
      }, 2000);
    } catch (err) {
      reject(err);
    }
  });

  // Store promise in cache while loading
  spriteCache.set(cacheKey, promise);

  return promise;
}

/**
 * Get an obstacle sprite image, loading it if necessary
 * Returns null if not loaded yet (caller should fallback to primitive drawing)
 */
export function getObstacleSprite(
  type: ObstacleType,
  sizePx: number
): HTMLImageElement | Promise<HTMLImageElement> | null {
  const IconComponent = ICON_COMPONENTS[type];
  if (!IconComponent) return null;

  const cacheKey = `${type}-${sizePx}`;
  const cached = spriteCache.get(cacheKey);

  if (cached instanceof HTMLImageElement) {
    return cached;
  }
  if (cached instanceof Promise) {
    return cached;
  }

  // Start loading
  return renderIconToImage(IconComponent, sizePx, cacheKey);
}

/**
 * Preload all obstacle sprites for common sizes
 */
export function preloadObstacleSprites(sizes: number[]): Promise<void[]> {
  const promises: Promise<void>[] = [];
  const types: ObstacleType[] = ["tree", "bush", "rock"];

  for (const type of types) {
    for (const size of sizes) {
      const spriteOrPromise = getObstacleSprite(type, size);
      if (spriteOrPromise instanceof Promise) {
        promises.push(
          spriteOrPromise.then(() => {
            // Loaded successfully
          })
        );
      }
    }
  }

  return Promise.all(promises);
}

