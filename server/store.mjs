import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export class RevisionStore {
  #file;
  #memoryOnly;
  #envelope = { revision: 0, state: null };

  constructor({ file, memoryOnly = false }) {
    this.#file = file;
    this.#memoryOnly = memoryOnly;
  }

  async load() {
    if (this.#memoryOnly) return this.read();
    try {
      const parsed = JSON.parse(await readFile(this.#file, "utf8"));
      if (
        typeof parsed?.revision === "number" &&
        (parsed.state === null || typeof parsed.state === "object")
      )
        this.#envelope = parsed;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    return this.read();
  }

  read() {
    return structuredClone(this.#envelope);
  }

  resetMemory() {
    if (!this.#memoryOnly)
      throw new TypeError("Only an in-memory test store can be reset.");
    this.#envelope = { revision: 0, state: null };
    return this.read();
  }

  async write(expectedRevision, state) {
    if (expectedRevision !== this.#envelope.revision) {
      const error = new Error("The project changed in another session.");
      error.code = "REVISION_CONFLICT";
      error.current = this.read();
      throw error;
    }
    if (!state || state.schemaVersion !== 1 || !Array.isArray(state.projects))
      throw new TypeError("State does not match the Tessera schema.");
    this.#envelope = {
      revision: this.#envelope.revision + 1,
      state: structuredClone(state),
    };
    if (!this.#memoryOnly) {
      await mkdir(path.dirname(this.#file), { recursive: true });
      await writeFile(
        this.#file,
        JSON.stringify(this.#envelope, null, 2),
        "utf8",
      );
    }
    return this.read();
  }
}
