jest.mock("electron", () => ({ ipcRenderer: { invoke: jest.fn() } }), { virtual: true });
const { runStressTest } = require("./stress-helper");
describe("Stress: t7z", () => { runStressTest("t7z"); });
