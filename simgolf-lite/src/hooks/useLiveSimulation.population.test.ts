import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { GolferRenderData } from "../game/live/types";
import { createLivePopulationPublisher } from "./useLiveSimulation";

const data = (id: number) => Object.freeze([{ id } as GolferRenderData]);

describe("ZK-1498 coherent render population publication", () => {
  it("changes opaque generation only with actual authority identity and atomically pairs matching data", () => {
    const publisher = createLivePopulationPublisher();
    const a = {}, b = {}, first = data(6), second = data(7);
    const empty = publisher.read();
    publisher.publish(a, first);
    const one = publisher.read();
    expect(one.generation).not.toBe(empty.generation);
    expect(one.golfers).toBe(first);
    expect(Object.isFrozen(one)).toBe(true);
    publisher.publish(a, second);
    expect(publisher.read().generation).toBe(one.generation);
    expect(publisher.read().golfers).toBe(second);
    // Authority preparation cannot publish a new generation until its matching data is supplied.
    expect(publisher.read().generation).toBe(one.generation);
    publisher.publish(b, first);
    expect(publisher.read().generation).not.toBe(one.generation);
    expect(publisher.read().golfers).toBe(first);
    expect(first[0].id).toBe(6);
  });

  it("publishes empty paused/zero-step creation, restoration and clearing without needing a normal tick", () => {
    const publisher = createLivePopulationPublisher();
    const initial = publisher.read().generation;
    const created = {};
    publisher.publish(created, []);
    const paused = publisher.read().generation;
    expect(paused).not.toBe(initial);
    expect(publisher.read().golfers).toEqual([]);
    publisher.publish(created, []);
    expect(publisher.read().generation).toBe(paused);
    publisher.publish({}, data(6));
    const restored = publisher.read().generation;
    expect(restored).not.toBe(paused);
    expect(publisher.read().golfers[0].id).toBe(6);
    publisher.publish(null, []);
    const cleared = publisher.read().generation;
    expect(cleared).not.toBe(restored);
    publisher.publish(null, []);
    expect(publisher.read().generation).toBe(cleared);
  });

  it("keeps new-generation data coherent while a compatibility ref remains delayed", () => {
    const publisher = createLivePopulationPublisher();
    const compatibility = { current: data(6) };
    publisher.publish({}, compatibility.current);
    const previous = publisher.read().generation;
    const matching = data(7);
    publisher.publish({}, matching);
    expect(publisher.read().generation).not.toBe(previous);
    expect(publisher.read().golfers).toBe(matching);
    expect(compatibility.current[0].id).toBe(6);
  });

  it("publishes every authoritative replacement/render write through the guarded hook boundary", () => {
    const source = readFileSync(new URL("./useLiveSimulation.ts", import.meta.url), "utf8");
    expect(source.match(/liveRef\.current = /g)).toHaveLength(5);
    expect(source.match(/golfersRef\.current = /g)).toHaveLength(1);
    for (const pair of [
      "liveRef.current = next;\n    publishRenderPopulation(next, []);",
      "liveRef.current = initial;\n      publishRenderPopulation(initial, []);",
      "liveRef.current = null;\n      publishRenderPopulation(null, []);",
      "liveRef.current = restored.state;\n    publishRenderPopulation(restored.state, buildRenderData(restored.state));",
      "liveRef.current = live;\n    if (created) publishRenderPopulation(live, []);",
    ]) expect(source).toContain(pair);
    expect(source).toContain("const created = liveRef.current !== live;");
    expect(source).toContain("publishRenderPopulation(live, buildRenderData(live));");
    expect(source).toContain("publishRenderPopulation(live, nextRender);");
  });
});
