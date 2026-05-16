jest.mock("electron", () => ({ ipcRenderer: { invoke: jest.fn() } }), { virtual: true });
const { runStressTest } = require("./stress-helper");
const size = process.env.STRESS_SIZE || "small";
const run = process.env.EXHAUSTIVE === "true" ? describe : describe.skip;
run(`Stress ${size}: tzst`, () => { runStressTest("tzst", size); });
