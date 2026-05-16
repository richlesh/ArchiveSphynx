jest.mock("electron", () => ({ ipcRenderer: { invoke: jest.fn() } }), { virtual: true });
const { runStressTest } = require("./stress-helper");
const size = process.env.STRESS_SIZE || "small";
describe(`Stress ${size}: zip`, () => { runStressTest("zip", size); });
