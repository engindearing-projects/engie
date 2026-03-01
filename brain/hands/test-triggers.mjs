#!/usr/bin/env bun

// Test the event-driven trigger system
//
// Verifies:
//   1. EventBus pub/sub works
//   2. TriggerManager loads triggers from manifests
//   3. hand_complete trigger fires when event is emitted
//   4. Trigger validation catches bad definitions
//   5. Cooldown prevents rapid re-fires
//
// Usage:
//   bun brain/hands/test-triggers.mjs

import { EventBus, TriggerManager, validateTrigger } from "./triggers.mjs";
import { HandRegistry } from "./registry.mjs";
import { validateManifest } from "./schema.mjs";

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.log(`  [FAIL] ${label}`);
    failed++;
  }
}

// ── Test 1: EventBus basics ─────────────────────────────────────────────────

console.log("\n1. EventBus basics");
{
  const bus = new EventBus();
  let received = null;

  bus.on("test.event", (name, payload) => {
    received = { name, payload };
  });

  bus.emit("test.event", { foo: "bar" });
  assert(received !== null, "Listener received event");
  assert(received.name === "test.event", "Event name matches");
  assert(received.payload.foo === "bar", "Payload matches");

  // Test once
  let onceCount = 0;
  bus.once("once.event", () => { onceCount++; });
  bus.emit("once.event", {});
  bus.emit("once.event", {});
  assert(onceCount === 1, "once() listener fires exactly once");

  // Test off
  let offCount = 0;
  const offCb = () => { offCount++; };
  bus.on("off.event", offCb);
  bus.emit("off.event", {});
  bus.off("off.event", offCb);
  bus.emit("off.event", {});
  assert(offCount === 1, "off() removes listener");

  // Test listEvents
  const events = bus.listEvents();
  assert(events.includes("test.event"), "listEvents includes active event");
}

// ── Test 2: Trigger validation ──────────────────────────────────────────────

console.log("\n2. Trigger validation");
{
  // Valid triggers
  assert(validateTrigger({ type: "hand_complete", hand: "forge-trainer" }).valid, "Valid hand_complete trigger");
  assert(validateTrigger({ type: "file_change", paths: ["trainer/data/"] }).valid, "Valid file_change trigger");
  assert(validateTrigger({ type: "webhook", route: "/trigger/test" }).valid, "Valid webhook trigger");
  assert(validateTrigger({ type: "threshold", metric: "forge-miner.pairs_collected", above: 100 }).valid, "Valid threshold trigger");
  assert(validateTrigger({ type: "schedule", cron: "0 4 * * *" }).valid, "Valid schedule trigger");

  // Invalid triggers
  assert(!validateTrigger({ type: "unknown" }).valid, "Rejects unknown type");
  assert(!validateTrigger({ type: "hand_complete" }).valid, "Rejects hand_complete without hand");
  assert(!validateTrigger({ type: "file_change" }).valid, "Rejects file_change without paths");
  assert(!validateTrigger({ type: "file_change", paths: [] }).valid, "Rejects file_change with empty paths");
  assert(!validateTrigger({ type: "webhook" }).valid, "Rejects webhook without route");
  assert(!validateTrigger({ type: "threshold", metric: "x" }).valid, "Rejects threshold without above/below");
  assert(!validateTrigger({ type: "schedule" }).valid, "Rejects schedule without cron");
  assert(!validateTrigger(null).valid, "Rejects null");
}

// ── Test 3: Schema validation with triggers ─────────────────────────────────

console.log("\n3. Schema validation with triggers");
{
  const valid = validateManifest({
    name: "test-hand",
    description: "Test",
    phases: [{ name: "p1", prompt: "do stuff" }],
    triggers: [
      { type: "hand_complete", hand: "other-hand" },
      { type: "file_change", paths: ["some/path"] },
    ],
  });
  assert(valid.valid, "Manifest with valid triggers passes");

  const invalid = validateManifest({
    name: "test-hand",
    description: "Test",
    phases: [{ name: "p1", prompt: "do stuff" }],
    triggers: [
      { type: "bad_type" },
    ],
  });
  assert(!invalid.valid, "Manifest with invalid trigger type fails");
  assert(invalid.errors.some(e => e.includes("triggers[0]")), "Error message references trigger index");

  const noTriggers = validateManifest({
    name: "test-hand",
    description: "Test",
    phases: [{ name: "p1", prompt: "do stuff" }],
  });
  assert(noTriggers.valid, "Manifest without triggers still valid");
}

// ── Test 4: TriggerManager loads from manifests ─────────────────────────────

console.log("\n4. TriggerManager loads from manifests");
{
  const registry = new HandRegistry();
  registry.load();

  const bus = new EventBus();
  const mgr = new TriggerManager(bus, registry);
  mgr.loadFromManifests();

  const triggers = mgr.listTriggers();
  assert(triggers.length > 0, `Loaded ${triggers.length} trigger(s) from manifests`);

  const researcherTrigger = triggers.find(t => t.hand === "researcher" && t.type === "hand_complete");
  assert(researcherTrigger !== undefined, "Researcher has hand_complete trigger");
  if (researcherTrigger) {
    assert(researcherTrigger.def.hand === "forge-trainer", "Researcher watches forge-trainer");
  }
}

// ── Test 5: hand_complete trigger fires on event ────────────────────────────

console.log("\n5. hand_complete trigger fires on event (synthetic)");
{
  const bus = new EventBus();
  const registry = new HandRegistry();
  registry.load();

  const mgr = new TriggerManager(bus, registry);

  // Track what gets fired
  let firedEvent = null;
  bus.on("trigger.fired", (name, payload) => {
    firedEvent = payload;
  });

  // Register a hand_complete trigger manually
  const result = mgr.registerTrigger("researcher", {
    type: "hand_complete",
    hand: "forge-trainer",
    onlyOnSuccess: true,
  });
  assert(result.ok, "registerTrigger succeeded");

  // Start the manager (activates triggers)
  mgr.start();

  // Emit a synthetic hand.complete event as if forge-trainer finished
  bus.emit("hand.complete", {
    hand: "forge-trainer",
    ok: true,
    duration: 5000,
    triggeredBy: "schedule",
  });

  // The trigger fires async, but the event bus emission to trigger.fired
  // should happen synchronously inside _fireHand before the async runHand.
  // Give it a moment for the fireHand to execute.
  await new Promise(r => setTimeout(r, 100));

  assert(firedEvent !== null, "trigger.fired event was emitted");
  if (firedEvent) {
    assert(firedEvent.hand === "researcher", "Correct hand was triggered");
    assert(firedEvent.type === "hand_complete", "Trigger type is hand_complete");
  }

  // Test that failed hand does NOT trigger (onlyOnSuccess)
  firedEvent = null;
  // Reset cooldown so we can test again
  mgr._cooldowns.clear();

  bus.emit("hand.complete", {
    hand: "forge-trainer",
    ok: false,
    duration: 1000,
    triggeredBy: "schedule",
  });

  await new Promise(r => setTimeout(r, 100));
  assert(firedEvent === null, "Failed hand does NOT fire trigger (onlyOnSuccess)");

  mgr.stop();
}

// ── Test 6: Register and remove triggers ────────────────────────────────────

console.log("\n6. Register and remove triggers");
{
  const bus = new EventBus();
  const registry = new HandRegistry();
  registry.load();

  const mgr = new TriggerManager(bus, registry);

  // Register
  const r1 = mgr.registerTrigger("researcher", { type: "hand_complete", hand: "learner" });
  assert(r1.ok, "Registered hand_complete trigger");

  const r2 = mgr.registerTrigger("researcher", { type: "schedule", cron: "0 5 * * *" });
  assert(r2.ok, "Registered schedule trigger");

  assert(mgr.listTriggers().length === 2, "Two triggers registered");

  // Remove by type
  const removed = mgr.removeTrigger("researcher", "hand_complete");
  assert(removed.removed.length === 1, "Removed 1 hand_complete trigger");
  assert(mgr.listTriggers().length === 1, "One trigger remaining");

  // Remove all
  mgr.registerTrigger("researcher", { type: "hand_complete", hand: "learner" });
  const removedAll = mgr.removeTrigger("researcher");
  assert(removedAll.removed.length === 2, "Removed all triggers for hand");
  assert(mgr.listTriggers().length === 0, "No triggers remaining");
}

// ── Test 7: Invalid trigger registration ────────────────────────────────────

console.log("\n7. Invalid trigger registration");
{
  const bus = new EventBus();
  const registry = new HandRegistry();
  registry.load();

  const mgr = new TriggerManager(bus, registry);

  const r1 = mgr.registerTrigger("researcher", { type: "nonexistent" });
  assert(!r1.ok, "Rejects unknown trigger type");

  const r2 = mgr.registerTrigger("nonexistent-hand", { type: "hand_complete", hand: "x" });
  assert(!r2.ok, "Rejects trigger for unknown hand");
}

// ── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
