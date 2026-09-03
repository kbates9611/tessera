import assert from "node:assert/strict";
import test from "node:test";
import { RevisionStore } from "../server/store.mjs";

const state = {
  schemaVersion: 1,
  activeProjectId: "project-1",
  projects: [],
};

test("the backend store revisions valid state and rejects stale writes", async () => {
  const store = new RevisionStore({
    file: "unused-in-memory.json",
    memoryOnly: true,
  });

  assert.deepEqual(await store.load(), { revision: 0, state: null });
  assert.deepEqual(await store.write(0, state), { revision: 1, state });

  await assert.rejects(
    store.write(0, state),
    (error) =>
      error.code === "REVISION_CONFLICT" && error.current.revision === 1,
  );
});

test("the backend store rejects malformed application state", async () => {
  const store = new RevisionStore({
    file: "unused-in-memory.json",
    memoryOnly: true,
  });

  await assert.rejects(
    store.write(0, { schemaVersion: 2, projects: [] }),
    /does not match the Tessera schema/,
  );
});

test("the in-memory test store can return to a pristine envelope", async () => {
  const store = new RevisionStore({
    file: "unused-in-memory.json",
    memoryOnly: true,
  });

  await store.write(0, state);
  assert.deepEqual(store.resetMemory(), { revision: 0, state: null });
});
