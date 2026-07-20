import type { Course, World } from "../game/models/types";
import type { CourseRecords } from "../game/retention/types";

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG capture failed")), "image/png"));
}

export async function captureCourseCanvas(source: HTMLCanvasElement, scale = 2): Promise<Blob> {
  const max = 8192;
  const target = document.createElement("canvas");
  const resolved = Math.min(scale, max / Math.max(source.width, source.height));
  target.width = Math.max(1, Math.floor(source.width * resolved));
  target.height = Math.max(1, Math.floor(source.height * resolved));
  const context = target.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, target.width, target.height);
  return canvasBlob(target);
}

export async function createCourseCard(source: HTMLCanvasElement, course: Course, world: World, records: CourseRecords, rating: number): Promise<Blob> {
  const width = 1600, height = 1000;
  const card = document.createElement("canvas"); card.width = width; card.height = height;
  const context = card.getContext("2d"); if (!context) throw new Error("Canvas unavailable");
  context.fillStyle = "#263b2d"; context.fillRect(0, 0, width, height);
  context.fillStyle = "#ead9b6"; context.fillRect(28, 28, width - 56, height - 56);
  context.drawImage(source, 70, 70, 1460, 700);
  context.fillStyle = "rgba(20,35,24,.88)"; context.fillRect(70, 690, 1460, 80);
  context.fillStyle = "white"; context.font = "bold 42px Georgia,serif";
  const name = course.name.length > 38 ? `${course.name.slice(0, 35)}…` : course.name;
  context.fillText(name, 100, 745);
  const complete = course.holes.filter((hole) => hole.tee && hole.green);
  const par = complete.reduce((sum, hole) => sum + (hole.parManual ?? 4), 0);
  context.fillStyle = "#263b2d"; context.font = "bold 30px Arial,sans-serif";
  context.fillText(`CourseCraft  •  ${complete.length} holes  •  Par ${par}  •  Rating ${rating.toFixed(1)}`, 80, 835);
  context.font = "25px Arial,sans-serif";
  context.fillText(`Week ${world.week}  •  Founded by ${world.founderName || "The Player"}  •  ${records.totalRounds.toLocaleString()} rounds hosted`, 80, 890);
  return canvasBlob(card);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function shareBlob(blob: Blob, filename: string, title: string): Promise<"shared" | "copied" | "downloaded"> {
  const file = new File([blob], filename, { type: "image/png" });
  if (navigator.share && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title }); return "shared"; }
  if (navigator.clipboard && typeof ClipboardItem !== "undefined") { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); return "copied"; }
  downloadBlob(blob, filename); return "downloaded";
}
